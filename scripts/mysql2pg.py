#!/usr/bin/env python3
"""
Convert the phpMyAdmin/MariaDB dump of u325388367_intellicare into PostgreSQL.

Emits four files, meant to be applied in this order:
  1_schema.sql   CREATE TABLEs (types mapped; tinyint(1) left as smallint)
  2_data.sql     INSERTs (string literals re-encoded for standard PG strings)
  3_keys.sql     primary keys, unique constraints, indexes, foreign keys
  4_fixups.sql   identity columns + sequence values, tinyint(1) -> boolean

Data loads before keys/indexes so foreign keys can't fail on table ordering,
and the tinyint->boolean switch happens last via
`ALTER ... TYPE boolean USING col::int::boolean`, which avoids rewriting
0/1 literals inside several thousand rows of INSERT data by hand.
"""
import re
import sys
from pathlib import Path

# ─────────────────────────── statement splitting ───────────────────────────

def split_statements(sql: str):
    """Yield statements, respecting single-quoted strings and MySQL backslash escapes."""
    buf, i, n = [], 0, len(sql)
    in_str = False
    while i < n:
        ch = sql[i]
        if in_str:
            if ch == '\\' and i + 1 < n:      # MySQL escape: take both chars
                buf.append(sql[i:i + 2]); i += 2; continue
            if ch == "'":
                if i + 1 < n and sql[i + 1] == "'":  # doubled quote inside string
                    buf.append("''"); i += 2; continue
                in_str = False
            buf.append(ch); i += 1; continue
        if ch == "'":
            in_str = True; buf.append(ch); i += 1; continue
        if ch == ';':
            stmt = ''.join(buf).strip()
            if stmt:
                yield stmt
            buf = []; i += 1; continue
        buf.append(ch); i += 1
    tail = ''.join(buf).strip()
    if tail:
        yield tail


def strip_noise(sql: str) -> str:
    sql = re.sub(r'/\*!.*?\*/', '', sql, flags=re.S)   # MySQL conditional directives
    sql = re.sub(r'^--.*$', '', sql, flags=re.M)       # comments
    return sql


# ───────────────────────────── string literals ─────────────────────────────

MYSQL_ESCAPES = {'0': '\0', 'b': '\b', 'n': '\n', 'r': '\r', 't': '\t',
                 'Z': '\x1a', '\\': '\\', "'": "'", '"': '"', '%': '\\%', '_': '\\_'}


def decode_mysql_string(body: str) -> str:
    """Decode the inside of a MySQL '...' literal to its real value."""
    out, i, n = [], 0, len(body)
    while i < n:
        c = body[i]
        if c == '\\' and i + 1 < n:
            out.append(MYSQL_ESCAPES.get(body[i + 1], body[i + 1])); i += 2; continue
        if c == "'" and i + 1 < n and body[i + 1] == "'":
            out.append("'"); i += 2; continue
        out.append(c); i += 1
    return ''.join(out)


def encode_pg_string(value: str) -> str:
    """Re-encode a real value as a standard-conforming PG literal."""
    if '\\' in value or '\0' in value:
        # E'' so backslashes stay literal and NULs can be dropped safely
        v = value.replace('\0', '').replace('\\', '\\\\').replace("'", "''")
        return "E'" + v + "'"
    return "'" + value.replace("'", "''") + "'"


ZERO_DATES = ('0000-00-00 00:00:00', '0000-00-00')


def requote_strings(stmt: str):
    """Rewrite every MySQL string literal in `stmt` as a PG literal.

    Returns (new_stmt, saw_zero_date). Zero dates become NULL — PostgreSQL has
    no equivalent of MySQL's all-zero date and rejects it outright.
    """
    out, i, n, zero = [], 0, len(stmt), False
    while i < n:
        ch = stmt[i]
        if ch != "'":
            out.append(ch); i += 1; continue
        j, body = i + 1, []
        while j < n:
            c = stmt[j]
            if c == '\\' and j + 1 < n:
                body.append(stmt[j:j + 2]); j += 2; continue
            if c == "'":
                if j + 1 < n and stmt[j + 1] == "'":
                    body.append("''"); j += 2; continue
                break
            body.append(c); j += 1
        raw = decode_mysql_string(''.join(body))
        if raw in ZERO_DATES:
            # MySQL's all-zero date has no Postgres equivalent. NULL would be the
            # honest reading, but several of these sit in NOT NULL columns, so use
            # the epoch as an unmistakable "no real date" sentinel instead.
            out.append("'1970-01-01 00:00:00+00'"); zero = True
        else:
            out.append(encode_pg_string(raw))
        i = j + 1
    return ''.join(out), zero


# ──────────────────────────────── types ────────────────────────────────────

def map_type(mysql_type: str) -> str:
    t = mysql_type.strip()
    low = t.lower()
    low = re.sub(r'\s+(unsigned|zerofill)\b', '', low).strip()
    m = re.match(r'^(\w+)\s*(\(([^)]*)\))?', low)
    base, args = m.group(1), (m.group(3) or '')
    if base == 'tinyint':
        return 'smallint'            # widened to boolean later when (1)
    if base in ('int', 'mediumint', 'integer'):
        return 'integer'
    if base == 'bigint':
        return 'bigint'
    if base == 'smallint':
        return 'smallint'
    if base in ('decimal', 'numeric'):
        return f'numeric({args})' if args else 'numeric'
    if base in ('double', 'float', 'real'):
        return 'double precision'
    if base == 'varchar':
        return f'varchar({args})' if args else 'text'
    if base == 'char':
        return f'char({args})' if args else 'char(1)'
    if base in ('text', 'tinytext', 'mediumtext', 'longtext'):
        return 'text'
    if base == 'json':
        return 'jsonb'
    if base == 'date':
        return 'date'
    if base == 'datetime' or base == 'timestamp':
        # Sequelize's DataTypes.DATE maps to timestamptz on Postgres.
        return 'timestamptz'
    if base == 'time':
        return 'time'
    if base in ('enum', 'set'):
        return 'text'
    return low


def convert_column(line: str, table: str, bool_cols: list, checks: list, auto_ts: list):
    m = re.match(r'^\s*`(?P<name>[^`]+)`\s+(?P<rest>.*?),?\s*$', line)
    if not m:
        return None
    name, rest = m.group('name'), m.group('rest')

    tm = re.match(r'^(?P<type>\w+(\s*\([^)]*\))?(\s+unsigned)?(\s+zerofill)?)(?P<tail>.*)$', rest, re.I)
    mysql_type, tail = tm.group('type'), tm.group('tail')

    if re.match(r'^\s*tinyint\s*\(\s*1\s*\)', mysql_type, re.I):
        bool_cols.append((table, name))

    em = re.match(r'^\s*(enum|set)\s*\((?P<vals>.*)\)\s*$', mysql_type, re.I | re.S)
    if em:
        checks.append((table, name, em.group('vals')))

    pg_type = map_type(mysql_type)

    # MariaDB validates JSON columns with an inline CHECK (json_valid(`c`));
    # Postgres has no json_valid, and these columns hold plain text here.
    tail = re.sub(r'\s*CHECK\s*\(\s*json_valid\s*\(\s*`[^`]+`\s*\)\s*\)', '', tail, flags=re.I)
    # MySQL refreshes these columns automatically on every UPDATE. Postgres has
    # no such column option, so the clause is dropped here and reproduced as a
    # BEFORE UPDATE trigger in 4_fixups.sql — without that, any raw-SQL UPDATE
    # silently leaves the timestamp stale (or NULL), which is enough to make
    # date-filtered history screens show nothing at all.
    if re.search(r'ON\s+UPDATE\s+current_timestamp\(\)', tail, re.I):
        auto_ts.append((table, name))
    tail = re.sub(r'\s+ON\s+UPDATE\s+current_timestamp\(\)', '', tail, flags=re.I)
    tail = re.sub(r'\bcurrent_timestamp\(\)', 'now()', tail, flags=re.I)
    tail = re.sub(r'\bCURRENT_TIMESTAMP\b(?!\()', 'now()', tail)
    tail = re.sub(r'\s+AUTO_INCREMENT\b', '', tail, flags=re.I)
    tail = re.sub(r"\s+CHARACTER SET \w+", '', tail, flags=re.I)
    tail = re.sub(r"\s+COLLATE [\w]+", '', tail, flags=re.I)
    tail = re.sub(r"\s+COMMENT\s+'(?:[^']|'')*'", '', tail, flags=re.I)
    tail, _ = requote_strings(tail)
    return f'  "{name}" {pg_type}{tail.rstrip().rstrip(",")}'


def convert_create_table(stmt: str, bool_cols: list, checks: list, auto_ts: list):
    m = re.match(r'^CREATE TABLE\s+`(?P<t>[^`]+)`\s*\((?P<body>.*)\)\s*ENGINE=.*$', stmt, re.S | re.I)
    if not m:
        m = re.match(r'^CREATE TABLE\s+`(?P<t>[^`]+)`\s*\((?P<body>.*)\)\s*$', stmt, re.S | re.I)
        if not m:
            return None, None
    table, body = m.group('t'), m.group('body')

    cols, depth, cur = [], 0, []
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            cols.append(''.join(cur)); cur = []; continue
        cur.append(ch)
    if ''.join(cur).strip():
        cols.append(''.join(cur))

    out = []
    for c in cols:
        cs = c.strip()
        if re.match(r'^(PRIMARY\s+KEY|UNIQUE\s+KEY|KEY|INDEX|CONSTRAINT|FULLTEXT)', cs, re.I):
            continue          # phpMyAdmin emits these as trailing ALTER TABLEs
        conv = convert_column(cs, table, bool_cols, checks, auto_ts)
        if conv:
            out.append(conv)
    if not out:
        return None, None
    return table, f'CREATE TABLE "{table}" (\n' + ',\n'.join(out) + '\n);'


# ──────────────────────────────── keys ─────────────────────────────────────

def convert_alter(stmt: str, seen_index: set):
    """Split a phpMyAdmin ALTER TABLE into PG-compatible pieces."""
    m = re.match(r'^ALTER TABLE\s+`(?P<t>[^`]+)`\s+(?P<body>.*)$', stmt, re.S | re.I)
    if not m:
        return [], []
    table, body = m.group('t'), m.group('body')
    keys, fixups = [], []

    parts, depth, cur = [], 0, []
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(cur)); cur = []; continue
        cur.append(ch)
    if ''.join(cur).strip():
        parts.append(''.join(cur))

    for p in parts:
        p = p.strip()
        if not p:
            continue
        # Quote the backticked identifier but keep any trailing modifier
        # (`created_at` DESC) intact, rather than swallowing it into the name.
        def cols_q(s):
            return ', '.join(
                re.sub(r'`([^`]+)`', r'"\1"', c.strip()) for c in s.split(','))

        mm = re.match(r'^ADD\s+PRIMARY\s+KEY\s*\((?P<c>[^)]*)\)$', p, re.I)
        if mm:
            keys.append(f'ALTER TABLE "{table}" ADD PRIMARY KEY ({cols_q(mm.group("c"))});')
            continue
        mm = re.match(r'^ADD\s+UNIQUE\s+KEY\s+`(?P<n>[^`]+)`\s*\((?P<c>[^)]*)\)$', p, re.I)
        if mm:
            name = f'{table}_{mm.group("n")}'[:63]
            keys.append(f'CREATE UNIQUE INDEX "{name}" ON "{table}" ({cols_q(mm.group("c"))});')
            continue
        mm = re.match(r'^ADD\s+(?:KEY|INDEX)\s+`(?P<n>[^`]+)`\s*\((?P<c>[^)]*)\)$', p, re.I)
        if mm:
            name = f'{table}_{mm.group("n")}'[:63]
            if name in seen_index:
                continue
            seen_index.add(name)
            cols = re.sub(r'\(\d+\)', '', mm.group('c'))   # drop prefix lengths
            keys.append(f'CREATE INDEX "{name}" ON "{table}" ({cols_q(cols)});')
            continue
        mm = re.match(
            r'^ADD\s+CONSTRAINT\s+`(?P<n>[^`]+)`\s+FOREIGN KEY\s*\((?P<c>[^)]*)\)\s*'
            r'REFERENCES\s+`(?P<rt>[^`]+)`\s*\((?P<rc>[^)]*)\)(?P<act>.*)$', p, re.I | re.S)
        if mm:
            act = re.sub(r'\s+', ' ', mm.group('act')).strip()
            keys.append(
                f'ALTER TABLE "{table}" ADD CONSTRAINT "{mm.group("n")[:63]}" '
                f'FOREIGN KEY ({cols_q(mm.group("c"))}) REFERENCES "{mm.group("rt")}" '
                f'({cols_q(mm.group("rc"))}) {act};'.replace('  ', ' '))
            continue
        mm = re.match(r'^MODIFY\s+`(?P<c>[^`]+)`\s+.*AUTO_INCREMENT(?:\s*=\s*(?P<v>\d+))?$', p, re.I)
        if mm:
            col, nxt = mm.group('c'), mm.group('v')
            fixups.append(f'ALTER TABLE "{table}" ALTER COLUMN "{col}" '
                          f'ADD GENERATED BY DEFAULT AS IDENTITY;')
            if nxt:
                fixups.append(
                    f"SELECT setval(pg_get_serial_sequence('\"{table}\"', '{col}'), "
                    f"GREATEST({nxt}, COALESCE((SELECT MAX(\"{col}\") FROM \"{table}\"), 1)));")
            continue
        mm = re.match(r'^AUTO_INCREMENT\s*=\s*\d+$', p, re.I)
        if mm:
            continue
    return keys, fixups


# ──────────────────────────────── main ─────────────────────────────────────

def main():
    src = Path(sys.argv[1])
    outdir = Path(sys.argv[2]); outdir.mkdir(parents=True, exist_ok=True)
    sql = strip_noise(src.read_text(encoding='utf-8', errors='replace'))

    schema, data, keys, fixups = [], [], [], []
    bool_cols, checks, seen_index, auto_ts = [], [], set(), []
    tables, n_insert, zero_dates = [], 0, 0

    for stmt in split_statements(sql):
        head = stmt.lstrip()[:60].upper()
        if head.startswith('CREATE TABLE'):
            t, ddl = convert_create_table(stmt, bool_cols, checks, auto_ts)
            if ddl:
                tables.append(t); schema.append(ddl)
        elif head.startswith('INSERT INTO'):
            s = re.sub(r'`([^`]+)`', r'"\1"', stmt)
            s, zero = requote_strings(s)
            if zero:
                zero_dates += 1
            data.append(s + ';'); n_insert += 1
        elif head.startswith('ALTER TABLE'):
            k, f = convert_alter(stmt, seen_index)
            keys.extend(k); fixups.extend(f)

    # tinyint(1) -> boolean, once the 0/1 data is already in place
    for t, c in bool_cols:
        fixups.append(f'ALTER TABLE "{t}" ALTER COLUMN "{c}" DROP DEFAULT;')
        fixups.append(f'ALTER TABLE "{t}" ALTER COLUMN "{c}" TYPE boolean '
                      f'USING ("{c}"::int::boolean);')
    for t, c, vals in checks:
        fixups.append(f'ALTER TABLE "{t}" ADD CONSTRAINT "{t}_{c}_check"[:63] '
                      f'CHECK ("{c}" IN ({vals}));'.replace('"[:63] ', '" '))

    if auto_ts:
        fixups.append(
            "CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$\n"
            "BEGIN NEW.updated_at = now(); RETURN NEW; END;\n"
            "$$ LANGUAGE plpgsql;")
        for t, c in auto_ts:
            if c == 'updated_at':
                fn = 'set_updated_at'
            else:
                fn = f'set_{t}_{c}_ts'
                fixups.append(
                    f'CREATE OR REPLACE FUNCTION "{fn}"() RETURNS trigger AS $$\n'
                    f'BEGIN NEW."{c}" = now(); RETURN NEW; END;\n'
                    f'$$ LANGUAGE plpgsql;')
            fixups.append(f'DROP TRIGGER IF EXISTS "trg_{t}_{c}_ts" ON "{t}";')
            fixups.append(
                f'CREATE TRIGGER "trg_{t}_{c}_ts" BEFORE UPDATE ON "{t}" '
                f'FOR EACH ROW EXECUTE FUNCTION "{fn}"();')

    hdr = '-- Generated by scripts/mysql2pg.py — do not edit by hand.\n'
    (outdir / '1_schema.sql').write_text(hdr + '\n\n'.join(schema) + '\n')
    (outdir / '2_data.sql').write_text(hdr + '\n'.join(data) + '\n')
    (outdir / '3_keys.sql').write_text(hdr + '\n'.join(keys) + '\n')
    (outdir / '4_fixups.sql').write_text(hdr + '\n'.join(fixups) + '\n')

    print(f'tables         : {len(tables)}')
    print(f'insert stmts   : {n_insert}')
    print(f'key statements : {len(keys)}')
    print(f'fixups         : {len(fixups)}')
    print(f'bool columns   : {len(bool_cols)}')
    print(f'enum checks    : {len(checks)}')
    print(f'auto-timestamp triggers: {len(auto_ts)}')
    print(f'zero dates -> epoch in {zero_dates} statement(s)')


if __name__ == '__main__':
    main()

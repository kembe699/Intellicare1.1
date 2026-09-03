#!/usr/bin/env python3
"""
Rewrite 0/1 into TRUE/FALSE for columns that are already boolean in the target.

scripts/mysql2pg.py builds its tables as smallint and flips them to boolean
afterwards (4_fixups.sql), so its data file writes integers. When the data is
instead loaded into a schema that ALREADY has boolean columns — a tenant cloned
from the template — those integers are rejected outright:

    column "is_posted" is of type boolean but expression is of type integer

This walks each INSERT's value tuples, respecting quotes and escapes so a comma
inside a string is never mistaken for a separator, and converts only the
positions that correspond to a boolean column.

    python3 scripts/pg_bool_values.py <data.sql> <bool-columns.txt> <out.sql>

bool-columns.txt is one "table.column" per line.
"""
import re
import sys


def split_tuple(body: str):
    """Split one VALUES tuple into its top-level items."""
    items, depth, cur, i, n = [], 0, [], 0, len(body)
    in_str = False
    while i < n:
        ch = body[i]
        if in_str:
            cur.append(ch)
            if ch == '\\' and i + 1 < n:      # escaped char inside a string
                cur.append(body[i + 1]); i += 2; continue
            if ch == "'":
                if i + 1 < n and body[i + 1] == "'":   # doubled quote
                    cur.append("'"); i += 2; continue
                in_str = False
            i += 1
            continue
        if ch == "'":
            in_str = True; cur.append(ch); i += 1; continue
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == ',' and depth == 0:
            items.append(''.join(cur)); cur = []; i += 1; continue
        cur.append(ch); i += 1
    items.append(''.join(cur))
    return items


def main():
    src, boolfile, out = sys.argv[1], sys.argv[2], sys.argv[3]
    bools = {line.strip() for line in open(boolfile) if line.strip()}
    text = open(src, encoding='utf-8', errors='replace').read()

    converted = 0
    stmt_re = re.compile(r'(INSERT INTO "([^"]+)" \(([^)]*)\) VALUES\s*)(.*?);\n', re.S)

    def fix(m):
        nonlocal converted
        head, table, collist, values = m.group(1), m.group(2), m.group(3), m.group(4)
        cols = re.findall(r'"([^"]+)"', collist)
        idx = [i for i, c in enumerate(cols) if f'{table}.{c}' in bools]
        if not idx:
            return m.group(0)

        # Split the VALUES list into its individual (...) tuples.
        out_tuples, depth, cur, in_str, i, n = [], 0, [], False, 0, len(values)
        while i < n:
            ch = values[i]
            cur.append(ch)
            if in_str:
                if ch == '\\' and i + 1 < n:
                    cur.append(values[i + 1]); i += 2; continue
                if ch == "'":
                    if i + 1 < n and values[i + 1] == "'":
                        cur.append("'"); i += 2; continue
                    in_str = False
                i += 1; continue
            if ch == "'":
                in_str = True
            elif ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    out_tuples.append(''.join(cur)); cur = []
                    while i + 1 < n and values[i + 1] in ', \n':
                        i += 1
            i += 1

        rebuilt = []
        for t in out_tuples:
            inner = t.strip()[1:-1]
            parts = split_tuple(inner)
            for j in idx:
                if j < len(parts):
                    v = parts[j].strip()
                    if v == '0':
                        parts[j] = 'FALSE'; converted += 1
                    elif v == '1':
                        parts[j] = 'TRUE'; converted += 1
            rebuilt.append('(' + ','.join(parts) + ')')
        return head + ',\n'.join(rebuilt) + ';\n'

    open(out, 'w', encoding='utf-8').write(stmt_re.sub(fix, text))
    print(f'boolean values converted: {converted}')


if __name__ == '__main__':
    main()

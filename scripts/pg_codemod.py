#!/usr/bin/env python3
"""
Mechanical MySQL -> PostgreSQL rewrites across the server source.

Only patterns that are unambiguous and safe to apply globally live here.
Anything needing judgement (ON DUPLICATE KEY UPDATE, ALTER ... MODIFY, boolean
comparisons) is reported at the end for a human pass instead of being guessed at.

Usage:  python3 scripts/pg_codemod.py [--apply]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'src' / 'server'
APPLY = '--apply' in sys.argv

# ── safe, global rewrites ──────────────────────────────────────────────────
SUBS = [
    # Current database/schema.
    (r'\bDATABASE\(\)', 'current_schema()', 'DATABASE() -> current_schema()'),

    # MySQL exposes indexes via information_schema.statistics; Postgres uses
    # pg_indexes, whose columns are named differently.
    (r'information_schema\.statistics', 'pg_indexes', 'information_schema.statistics -> pg_indexes'),

    # Date/time helpers.
    (r'\bCURDATE\(\)', 'CURRENT_DATE', 'CURDATE() -> CURRENT_DATE'),
    (r'\bIFNULL\s*\(', 'COALESCE(', 'IFNULL -> COALESCE'),
    (r'\bUNIX_TIMESTAMP\s*\(\s*\)', 'EXTRACT(EPOCH FROM now())', 'UNIX_TIMESTAMP()'),
    (r'\bGROUP_CONCAT\s*\(', 'STRING_AGG(', 'GROUP_CONCAT -> STRING_AGG'),

    # `INSERT IGNORE` has a direct Postgres equivalent.
    (r'\bINSERT\s+IGNORE\s+INTO\b', 'INSERT INTO', 'INSERT IGNORE -> INSERT (see ON CONFLICT note)'),
]

# Applied only inside a pg_indexes query, where the column names differ.
PG_INDEX_COLS = [
    (r'\btable_schema\s*=\s*current_schema\(\)', 'schemaname = current_schema()'),
    (r'\btable_name\s*=', 'tablename ='),
    (r'\bindex_name\s*=', 'indexname ='),
]

# ── patterns that need a human ─────────────────────────────────────────────
NEEDS_REVIEW = [
    (r'ON\s+DUPLICATE\s+KEY\s+UPDATE', 'ON DUPLICATE KEY UPDATE -> ON CONFLICT ... DO UPDATE'),
    (r'ALTER\s+TABLE[^;`\'"]*\bMODIFY\b', 'ALTER TABLE ... MODIFY -> ALTER COLUMN ... TYPE'),
    (r'\bAUTO_INCREMENT\b', 'AUTO_INCREMENT -> GENERATED ... AS IDENTITY / serial'),
    (r'\bADD\s+COLUMN[^;]*\bAFTER\s+`?\w+`?', 'ADD COLUMN ... AFTER x (Postgres has no column ordering)'),
    (r'\bDATE_FORMAT\s*\(', 'DATE_FORMAT -> to_char'),
    (r'\bSHOW\s+(CREATE\s+TABLE|COLUMNS|TABLES)', 'SHOW ... -> information_schema / pg_catalog'),
    (r'\bLAST_INSERT_ID\s*\(', 'LAST_INSERT_ID -> RETURNING id'),
    (r'\bENGINE\s*=\s*InnoDB', 'ENGINE=InnoDB (drop it)'),
]


def convert(text: str):
    hits = {}
    for pat, repl, label in SUBS:
        text, n = re.subn(pat, repl, text, flags=re.I)
        if n:
            hits[label] = hits.get(label, 0) + n

    # Fix column names only within statements that now target pg_indexes.
    def fix_pg_indexes(m):
        seg = m.group(0)
        for p, r in PG_INDEX_COLS:
            seg = re.sub(p, r, seg, flags=re.I)
        return seg

    text, n = re.subn(r'FROM\s+pg_indexes\b.*?(?=`|\'|"|\)\s*;|$)', fix_pg_indexes,
                      text, flags=re.I | re.S)
    return text, hits


def main():
    total, per_file = {}, {}
    review = {}
    for f in sorted(ROOT.rglob('*.js')):
        if 'node_modules' in f.parts:
            continue
        src = f.read_text(encoding='utf-8', errors='replace')
        out, hits = convert(src)
        rel = str(f.relative_to(ROOT.parent.parent))
        if hits:
            per_file[rel] = hits
            for k, v in hits.items():
                total[k] = total.get(k, 0) + v
            if APPLY and out != src:
                f.write_text(out, encoding='utf-8')
        for pat, label in NEEDS_REVIEW:
            n = len(re.findall(pat, out, flags=re.I))
            if n:
                review.setdefault(label, []).append((rel, n))

    print('APPLIED' if APPLY else 'DRY RUN — rerun with --apply')
    print('\n── automatic rewrites ──')
    for k, v in sorted(total.items(), key=lambda x: -x[1]):
        print(f'  {v:4d}  {k}')
    print(f'  files touched: {len(per_file)}')

    print('\n── needs a human pass ──')
    for label, files in sorted(review.items(), key=lambda x: -sum(n for _, n in x[1])):
        tot = sum(n for _, n in files)
        print(f'  {tot:4d}  {label}')
        for rel, n in sorted(files, key=lambda x: -x[1])[:4]:
            print(f'          {n:3d}  {rel}')


if __name__ == '__main__':
    main()

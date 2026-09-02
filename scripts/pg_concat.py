#!/usr/bin/env python3
"""
MySQL CONCAT(a,b,c) -> Postgres (a || b || c).

Not cosmetic: MySQL's CONCAT returns NULL when any argument is NULL, while
Postgres's CONCAT ignores NULLs and returns the rest. Code that leans on the
MySQL behaviour — COALESCE(CONCAT(p.first, ' ', p.last), CONCAT(lp.first, ...))
— silently gets ' ' from the first branch and never reaches the fallback.
The `||` operator is null-propagating in Postgres, matching MySQL exactly.

Usage: python3 scripts/pg_concat.py [--apply]
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'src' / 'server'
APPLY = '--apply' in sys.argv


def split_args(s):
    args, depth, cur = [], 0, []
    for ch in s:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ',' and depth == 0:
            args.append(''.join(cur).strip()); cur = []; continue
        cur.append(ch)
    if ''.join(cur).strip(): args.append(''.join(cur).strip())
    return args


def convert(text):
    n = 0
    while True:
        m = re.search(r'\bCONCAT\s*\(', text)
        if not m: break
        i = m.end() - 1
        depth, end = 0, None
        for j in range(i, len(text)):
            if text[j] == '(': depth += 1
            elif text[j] == ')':
                depth -= 1
                if depth == 0: end = j; break
        if end is None: break
        args = split_args(text[i+1:end])
        if len(args) < 2:
            # Leave a single-arg CONCAT alone rather than guess.
            text = text[:m.start()] + 'CONCAT_KEEP(' + text[i+1:end] + ')' + text[end+1:]
            continue
        text = text[:m.start()] + '(' + ' || '.join(args) + ')' + text[end+1:]
        n += 1
    return text.replace('CONCAT_KEEP(', 'CONCAT('), n


total = files = 0
for f in sorted(ROOT.rglob('*.js')):
    if 'node_modules' in f.parts: continue
    s = f.read_text(encoding='utf-8', errors='replace')
    if not re.search(r'\bCONCAT\s*\(', s): continue
    out, n = convert(s)
    if n:
        total += n; files += 1
        if APPLY: f.write_text(out, encoding='utf-8')
print(('APPLIED' if APPLY else 'DRY RUN') + f': {total} CONCAT() -> || across {files} files')

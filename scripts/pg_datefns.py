#!/usr/bin/env python3
"""
Convert MySQL date/time functions to PostgreSQL across the server source.

Uses balanced-paren argument splitting rather than a flat regex, because the
arguments are frequently nested calls (DATEDIFF(CURRENT_DATE, COALESCE(a, b))).

Usage: python3 scripts/pg_datefns.py [--apply]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'src' / 'server'
APPLY = '--apply' in sys.argv


def split_args(s: str):
    """Split a call's argument list on top-level commas."""
    args, depth, cur = [], 0, []
    for ch in s:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            args.append(''.join(cur).strip()); cur = []; continue
        cur.append(ch)
    if ''.join(cur).strip():
        args.append(''.join(cur).strip())
    return args


def find_calls(text: str, name: str):
    """Yield (start, end, args_string) for each `name(...)` call, outermost first."""
    out = []
    for m in re.finditer(r'\b' + name + r'\s*\(', text, re.I):
        i = m.end() - 1           # at the '('
        depth = 0
        for j in range(i, len(text)):
            if text[j] == '(':
                depth += 1
            elif text[j] == ')':
                depth -= 1
                if depth == 0:
                    out.append((m.start(), j + 1, text[i + 1:j]))
                    break
    return out


def replace_calls(text: str, name: str, builder):
    """Rewrite every `name(...)` using builder(args) -> str, right to left."""
    n = 0
    for start, end, argstr in reversed(find_calls(text, name)):
        args = split_args(argstr)
        repl = builder(args)
        if repl is None:
            continue
        text = text[:start] + repl + text[end:]
        n += 1
    return text, n


INTERVAL_RE = re.compile(r'^INTERVAL\s+(?P<qty>[^\s]+)\s+(?P<unit>\w+)$', re.I)


def build_datediff(args):
    # MySQL DATEDIFF(a, b) = whole days between; Postgres date subtraction
    # already yields an integer number of days.
    if len(args) != 2:
        return None
    return f'(({args[0]})::date - ({args[1]})::date)'


def build_interval(op):
    def build(args):
        if len(args) != 2:
            return None
        m = INTERVAL_RE.match(args[1].strip())
        if not m:
            return None
        qty, unit = m.group('qty'), m.group('unit').lower()
        if qty in ('?',) or qty.startswith(':') or qty.startswith('$'):
            # Bind parameter: build the interval at runtime from the value.
            return f"(({args[0]}) {op} (({qty})::text || ' {unit}')::interval)"
        return f"(({args[0]}) {op} INTERVAL '{qty} {unit}')"
    return build


def build_timestampdiff(args):
    # TIMESTAMPDIFF(unit, start, end) -> whole units between start and end.
    if len(args) != 3:
        return None
    unit, start, end = args[0].strip().lower(), args[1], args[2]
    if unit in ('year', 'month'):
        return f"(EXTRACT({unit.upper()} FROM AGE(({end})::timestamp, ({start})::timestamp)))::int"
    if unit == 'day':
        return f'((({end})::date - ({start})::date))'
    if unit in ('hour', 'minute', 'second'):
        per = {'hour': 3600, 'minute': 60, 'second': 1}[unit]
        return f"(EXTRACT(EPOCH FROM (({end})::timestamp - ({start})::timestamp)) / {per})::int"
    return None


def main():
    totals, touched = {}, 0
    for f in sorted(ROOT.rglob('*.js')):
        if 'node_modules' in f.parts:
            continue
        src = f.read_text(encoding='utf-8', errors='replace')
        out = src
        for name, builder in (('DATEDIFF', build_datediff),
                              ('DATE_ADD', build_interval('+')),
                              ('DATE_SUB', build_interval('-')),
                              ('TIMESTAMPDIFF', build_timestampdiff)):
            out, n = replace_calls(out, name, builder)
            if n:
                totals[name] = totals.get(name, 0) + n
        out, n = re.subn(r'\bUTC_TIMESTAMP\s*\(\s*\)', "(now() AT TIME ZONE 'utc')", out, flags=re.I)
        if n:
            totals['UTC_TIMESTAMP'] = totals.get('UTC_TIMESTAMP', 0) + n
        if out != src:
            touched += 1
            if APPLY:
                f.write_text(out, encoding='utf-8')

    print('APPLIED' if APPLY else 'DRY RUN — rerun with --apply')
    for k, v in sorted(totals.items(), key=lambda x: -x[1]):
        print(f'  {v:4d}  {k}')
    print(f'  files touched: {touched}')

    # Anything left unconverted is a shape the builders refused — surface it.
    leftovers = []
    for f in ROOT.rglob('*.js'):
        if 'node_modules' in f.parts:
            continue
        t = f.read_text(encoding='utf-8', errors='replace')
        if APPLY:
            for name in ('DATEDIFF', 'DATE_ADD', 'DATE_SUB', 'TIMESTAMPDIFF'):
                if re.search(r'\b' + name + r'\s*\(', t, re.I):
                    leftovers.append((str(f.relative_to(ROOT.parent.parent)), name))
    if leftovers:
        print('\n  STILL PRESENT (needs manual review):')
        for rel, name in leftovers:
            print(f'    {name:15s} {rel}')


if __name__ == '__main__':
    main()

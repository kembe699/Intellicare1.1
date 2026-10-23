# Batch 1 before/after tests

Each `tNN_*.mjs` proves one item from `docs/client-requests/REPORT.md`: the bug on a
backend running the baseline code (`BEFORE_API`, default `http://localhost:3002/api`)
and the fix on a backend running this branch (`AFTER_API`, default `http://localhost:3013/api`).

Both backends must point at the local preview database (never production). Tests create
their own patients/bills/etc. and only read the ledger directly.

    node tests/batch1/t01_receivables.mjs

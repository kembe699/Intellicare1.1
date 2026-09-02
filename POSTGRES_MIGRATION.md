# PostgreSQL Migration

This app was migrated from MySQL/MariaDB (Hostinger) to PostgreSQL, targeting Render.

## Migrating the data

`scripts/mysql2pg.py` converts a phpMyAdmin/MariaDB dump into PostgreSQL. It is
re-runnable and emits four files, applied **in this order**:

```bash
python3 scripts/mysql2pg.py "<dump>.sql" ./pgout
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f pgout/1_schema.sql   # tables
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f pgout/2_data.sql     # rows
psql "$DATABASE_URL"                    -f pgout/3_keys.sql     # PKs, indexes, FKs
psql "$DATABASE_URL"                    -f pgout/4_fixups.sql   # identity, booleans, triggers
```

Data loads before keys so foreign keys can't fail on table ordering, and the
`tinyint(1) → boolean` switch happens last via `ALTER … USING col::int::boolean`
rather than rewriting 0/1 literals across thousands of rows.

Verify the load by comparing row counts per table against the dump — the last
run matched all 130 populated tables exactly (5,019 rows).

## Behaviour differences that mattered

MySQL is permissive where PostgreSQL is strict. These bit us; keep them in mind
when writing new queries.

| MySQL | PostgreSQL | Why it mattered |
|---|---|---|
| `CONCAT(a,b)` returns NULL if any arg is NULL | `CONCAT` **ignores** NULLs | `COALESCE(CONCAT(...), CONCAT(fallback))` silently returned `' '` and never reached the fallback. Use `\|\|`, which propagates NULL. |
| `ON UPDATE current_timestamp()` column option | no equivalent | Raw `UPDATE`s left `updated_at` NULL, so date-filtered history screens showed nothing. Reproduced with `BEFORE UPDATE` triggers (emitted into `4_fixups.sql`). |
| `'5' = 5` coerces | type error | varchar FK columns joined to integer PKs had to be converted; columns holding display names were deliberately left as varchar. |
| `tinyint(1)` is 0/1 | real `boolean` | `WHERE is_active = 1` no longer type-checks. |
| `DATE_FORMAT`, `DATEDIFF`, `IFNULL`, `IF()`, `DATABASE()` | `to_char`, date subtraction, `COALESCE`, `CASE WHEN`, `current_schema()` | converted by `scripts/pg_codemod.py`, `pg_datefns.py`, `pg_concat.py` |
| non-numeric id in a numeric column coerces to 0 | hard error | `/route/:id` with a non-numeric id now 500s instead of returning empty. Worth validating ids at the route layer. |

## Known remaining work

- **16 `ON DUPLICATE KEY UPDATE` statements** still need `ON CONFLICT … DO UPDATE`
  (schemes, roles, procurement, exchangeRates, patientDeposits, approvals).
  Reads work; those specific writes will fail.
- **Tenant provisioning** (`scripts/provisionTenant.js`) still uses
  `CREATE DATABASE` and `SHOW CREATE TABLE`. Worth deciding between
  database-per-tenant and schema-per-tenant before converting — schema-per-tenant
  is usually the better fit on managed Postgres.
- Boot migrations still emit ~17 harmless warnings (`ALTER … MODIFY`,
  `AUTO_INCREMENT`, `ADD COLUMN … AFTER`) — idempotent patches the migrated
  schema already satisfies.

## Configuration

Copy `src/server/.env.example` to `src/server/.env`. On Render set `DB_SSL=true`.
Never commit a real `.env`; database dumps are gitignored because they contain
patient records and password hashes.

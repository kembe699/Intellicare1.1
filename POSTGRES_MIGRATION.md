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
| unquoted `AS camelCase` keeps its case | folds to **lowercase** | 96 aliases across the reports-v2 routers came back as `totalamount`, so `row.totalAmount` read `undefined` and every total rendered as **0** while still returning HTTP 200. Aliases are now quoted (`AS "totalAmount"`) — and a quoted alias must also be quoted where GROUP BY / ORDER BY references it. |
| `HAVING` may reference a SELECT alias | only GROUP BY / ORDER BY may | The income statement failed outright with `column "amount" does not exist`. Repeat the aggregate expression in HAVING. |
| `CHAR(n)` strips trailing blanks on read | `bpchar` returns the padding | 92 CHAR columns, mostly CHAR(36) ids. Real ids are exactly 36 chars so live data is unaffected, but anything shorter comes back space-padded and fails a JS `===`. Comparisons in SQL still ignore the padding, which is what hides it. |

## Multi-tenancy: one database, one schema per tenant

Everything lives in a single database:

| Schema | Contents |
|---|---|
| `public` | control plane — `clients`, `platform_admins`, `subscription_plans`, `invoices`, `db_usage_snapshots` |
| `tenant_<code>` | one hospital's data (~202 tables) |
| `tenant_template` | empty structure + reference data; new tenants are cloned from it |

Isolation comes from `search_path`: `buildSequelize(schema)` pins it in an
`afterConnect` hook, so every query on that pool — model or raw SQL — is scoped
to one schema and cannot reach another. `tenantDb.js` caches one such connection
per tenant; the JWT carries `schemaName`.

Creating a tenant from **/platform-admin** runs `scripts/provisionTenant.js`,
which does `CREATE SCHEMA`, clones every table from the template with
`LIKE ... INCLUDING ALL`, replays the foreign keys, copies the reference
catalogues, then seeds the facility, main branch, first admin and chart of
accounts. Deleting a client does `DROP SCHEMA ... CASCADE`.

None of this needs elevated privileges — which is precisely why it works on
Render, where the app's role cannot `CREATE DATABASE`.

To add something every future tenant should start with, insert it into
`tenant_template` and list the table in `TENANT_SEED_TABLES`.

## Tests

The jest suite runs against the `tenant_test` schema of the same database —
isolation by `search_path`, exactly as the app does for a real tenant, so tests
can never read or write a tenant's rows. Build (or rebuild) it with:

```bash
psql "$DATABASE_URL" -f scripts/create_test_schema.sql
npx jest                      # 163 tests across unit/integration/integrity/e2e/performance
```

It is a structural clone of `tenant_template` plus the reference catalogues and
chart of accounts, dropped and recreated on each run of that script so a failed
run cannot poison the next one. Connection settings live in `.env.test`.

Note the suite exercises schema and raw SQL, **not** the HTTP layer — the alias
case-folding bug above passed every test while returning zeros, and was only
caught by calling the endpoints. Sweep the routes too when changing reports.

## A trap specific to this schema

`lis_test_orders.clinic_id` is a **false cognate**: it holds the *consulting
clinic* (a `dr_clinics` UUID, alongside `clinic_name`/`room_number`), not the
facility id. Filtering it by a numeric `clinic_id` matched almost nothing on
MySQL (which coerced each UUID to 0) and errors outright on PostgreSQL. Every
LIS-side query is therefore deliberately **not** clinic-scoped — each tenant has
its own schema, so the table already belongs to exactly one facility. See
`dashboard.js`, `reportLaboratory.js`, `reportDoctorPerformance.js`.

Related: the `visits` table is legacy and barely written (6 rows, newest June
2026). The live unit of encounter is an `lis_test_orders` row. Reports that
counted `visits` showed 0 for any recent period.

## Known remaining work

- **16 `ON DUPLICATE KEY UPDATE` statements** still need `ON CONFLICT … DO UPDATE`
  (schemes, roles, procurement, exchangeRates, patientDeposits, approvals).
  Reads work; those specific writes will fail.
- Schema changes made by boot migrations land in `tenant_template` (the default
  connection points there), so *new* tenants pick them up — existing tenant
  schemas do not. A migration runner that loops over `clients` is the next step.
- Boot migrations still emit ~17 harmless warnings (`ALTER … MODIFY`,
  `AUTO_INCREMENT`, `ADD COLUMN … AFTER`) — idempotent patches the migrated
  schema already satisfies.

## Deploying (Render)

Build command:

```
npm install --include=dev && npm install --prefix src/server && npm run build
```

Two things there are easy to get wrong and both fail the build or the boot:

- **`--include=dev`** is required. The whole build toolchain — vite, typescript,
  tailwind, postcss, the react plugin — lives in `devDependencies`, and Render
  sets `NODE_ENV=production`, which makes plain `npm install` omit them. Without
  it the build dies with `sh: 1: vite: not found`.
- **`--prefix src/server`** is required. That directory has its own
  `package.json` with its own dependencies (express, pg, bcrypt…). Skip it and
  the build succeeds, then the service crashes on boot.

Start command: `node src/server/index.js`

## Configuration

Copy `src/server/.env.example` to `src/server/.env`. On Render set `DB_SSL=true`.
Never commit a real `.env`; database dumps are gitignored because they contain
patient records and password hashes.

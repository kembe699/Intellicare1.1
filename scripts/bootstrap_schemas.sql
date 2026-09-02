-- Turn a freshly-restored single-schema database into the multi-tenant layout.
--
-- Run this ONCE, immediately after loading the converted dump (which lands
-- everything in `public`). It:
--   1. moves the restored hospital data into its own tenant schema,
--   2. recreates an empty `public` for the control plane,
--   3. builds `tenant_template` — the structure new tenants are cloned from,
--   4. copies the reference catalogues into that template.
--
-- Safe to read before running: it renames rather than drops, and creates
-- nothing that already exists.
--
--   psql "$DATABASE_URL" -v tenant=tenant_demo -f scripts/bootstrap_schemas.sql
--
-- :tenant defaults to tenant_demo if not supplied.

\if :{?tenant}
\else
  \set tenant tenant_demo
\endif

\echo '→ moving restored data into schema' :'tenant'
ALTER SCHEMA public RENAME TO :"tenant";
CREATE SCHEMA public;

\echo '→ building tenant_template from' :'tenant'
CREATE SCHEMA tenant_template;

-- Makes the psql variable visible to the PL/pgSQL blocks below, which cannot
-- read :variables directly.
SET bootstrap.tenant = :'tenant';

DO $$
DECLARE
  src  text := current_setting('bootstrap.tenant');
  t    record;
  fk   record;
  def  text;
BEGIN
  -- Structure only. LIKE ... INCLUDING ALL brings columns, defaults, identity
  -- sequences, checks, indexes and primary keys, but not foreign keys.
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = src ORDER BY tablename LOOP
    EXECUTE format('CREATE TABLE tenant_template.%I (LIKE %I.%I INCLUDING ALL)', t.tablename, src, t.tablename);
  END LOOP;

  -- Foreign keys replayed once every table exists, so ordering can't matter.
  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS d
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = src AND c.contype = 'f'
  LOOP
    def := replace(fk.d, src || '.', 'tenant_template.');
    BEGIN
      EXECUTE format('ALTER TABLE tenant_template.%I ADD CONSTRAINT %I %s',
                     split_part(replace(fk.tbl, '"', ''), '.', 2), fk.conname, def);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'foreign key % skipped: %', fk.conname, SQLERRM;
    END;
  END LOOP;
END $$;

\echo '→ copying reference catalogues into the template'
-- Catalogues and lookup tables only — never anyone's records. Several are the
-- target of foreign keys (patients.clinic_id -> clinic_names, role_privileges
-- -> roles/privileges), so a tenant without them cannot accept writes at all.
DO $$
DECLARE
  src text := current_setting('bootstrap.tenant');
  t   text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_names','currencies','roles','privileges',
                           'role_privileges','lab_test_categories','chief_complaints']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = src AND tablename = t) THEN
      EXECUTE format('INSERT INTO tenant_template.%I SELECT * FROM %I.%I ON CONFLICT DO NOTHING', t, src, t);
    END IF;
  END LOOP;
END $$;

\echo '→ done. Layout:'
SELECT n.nspname AS schema, count(c.oid) AS tables
  FROM pg_namespace n
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
 WHERE n.nspname IN ('public', 'tenant_template') OR n.nspname LIKE 'tenant\_%'
 GROUP BY n.nspname ORDER BY n.nspname;

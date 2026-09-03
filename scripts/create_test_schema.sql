-- Build (or rebuild) `tenant_test` — the schema the jest suite runs against.
--
-- It is a structural clone of tenant_template plus the reference catalogues, so
-- tests exercise the real, current schema without touching any tenant's data.
-- Dropping and recreating is deliberate: a test run that leaves rows behind
-- can't poison the next one.
DROP SCHEMA IF EXISTS tenant_test CASCADE;
CREATE SCHEMA tenant_test;

DO $$
DECLARE t record; fk record; def text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='tenant_template' ORDER BY tablename LOOP
    EXECUTE format('CREATE TABLE tenant_test.%I (LIKE tenant_template.%I INCLUDING ALL)', t.tablename, t.tablename);
  END LOOP;

  -- LIKE ... INCLUDING ALL omits foreign keys, so replay them once every table exists.
  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS d
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
     WHERE n.nspname='tenant_template' AND c.contype='f'
  LOOP
    def := replace(fk.d, 'tenant_template.', 'tenant_test.');
    BEGIN
      EXECUTE format('ALTER TABLE tenant_test.%I ADD CONSTRAINT %I %s',
                     split_part(replace(fk.tbl,'"',''), '.', 2), fk.conname, def);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'fk % skipped: %', fk.conname, SQLERRM;
    END;
  END LOOP;

  -- chart_of_accounts is included here (unlike the provisioning seed list, which
  -- builds it programmatically) because gl_line_items.account_id is a NOT NULL
  -- foreign key: without it no ledger test can insert a single line.
  FOREACH def IN ARRAY ARRAY['clinic_names','currencies','roles','privileges',
                             'role_privileges','lab_test_categories','chief_complaints',
                             'chart_of_accounts'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='tenant_template' AND tablename=def) THEN
      EXECUTE format('INSERT INTO tenant_test.%I SELECT * FROM tenant_template.%I ON CONFLICT DO NOTHING', def, def);
    END IF;
  END LOOP;
END $$;

-- Tests need at least one facility and one chart-of-accounts row to hang
-- foreign keys off; the template ships neither.
INSERT INTO tenant_test.facilities (id, name, address, phone, email, created_at, updated_at)
VALUES (1, 'Test Facility', '', '', '', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;

SELECT count(*) AS tables_created FROM pg_tables WHERE schemaname='tenant_test';

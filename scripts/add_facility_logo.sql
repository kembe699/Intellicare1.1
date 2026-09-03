-- Add facilities.logo to every tenant schema.
--
-- Boot migrations run against the default connection only (the template), so a
-- new column reaches new tenants but never existing ones. PostgreSQL TEXT is
-- unbounded, so no length ceiling is needed for a data URI.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\_%' ORDER BY 1 LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=s AND tablename='facilities') THEN
      EXECUTE format('ALTER TABLE %I.facilities ADD COLUMN IF NOT EXISTS logo TEXT', s);
      RAISE NOTICE '% : facilities.logo ready', s;
    END IF;
  END LOOP;
END $$;

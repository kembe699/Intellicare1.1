-- Add the external-prescription columns to every tenant schema.
--
-- Boot migrations run against the default connection only (the template), so a
-- new column reaches new tenants but never existing ones. Until a per-tenant
-- migration runner exists, a schema change has to be replayed like this.
--
--   psql "$DATABASE_URL" -f scripts/patch_prescription_lines.sql
DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
     WHERE nspname LIKE 'tenant\_%' ORDER BY 1
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=s AND tablename='prescription_lines') THEN
      RAISE NOTICE '% : no prescription_lines, skipped', s; CONTINUE;
    END IF;

    -- An externally-bought drug has no inventory_items row to reference.
    EXECUTE format('ALTER TABLE %I.prescription_lines ALTER COLUMN drug_id DROP NOT NULL', s);
    EXECUTE format('ALTER TABLE %I.prescription_lines ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false', s);
    EXECUTE format('ALTER TABLE %I.prescription_lines ADD COLUMN IF NOT EXISTS external_drug_name VARCHAR(255)', s);
    -- Numeric dose per administration; dose_strength stays the label ("500mg").
    EXECUTE format('ALTER TABLE %I.prescription_lines ADD COLUMN IF NOT EXISTS dose_amount NUMERIC(10,2)', s);
    RAISE NOTICE '% : prescription_lines patched', s;
  END LOOP;
END $$;

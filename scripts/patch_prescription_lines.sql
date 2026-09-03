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

-- Same standardisation for inpatient prescriptions.
--
-- duration is free text there ("7 days"), and there is no numeric dose, so the
-- quantity could not be derived from dose x frequency x days the way the
-- outpatient flow now does. duration_days and dose_amount make it computable;
-- is_external/external_drug_name carry an out-of-stock item the patient's
-- family buys outside, exactly as on the outpatient side.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\_%' ORDER BY 1 LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=s AND tablename='inpatient_prescriptions') THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I.inpatient_prescriptions ALTER COLUMN drug_id DROP NOT NULL', s);
    EXECUTE format('ALTER TABLE %I.inpatient_prescriptions ADD COLUMN IF NOT EXISTS duration_days INTEGER', s);
    EXECUTE format('ALTER TABLE %I.inpatient_prescriptions ADD COLUMN IF NOT EXISTS dose_amount NUMERIC(10,2)', s);
    EXECUTE format('ALTER TABLE %I.inpatient_prescriptions ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT false', s);
    EXECUTE format('ALTER TABLE %I.inpatient_prescriptions ADD COLUMN IF NOT EXISTS external_drug_name VARCHAR(255)', s);
    RAISE NOTICE '% : inpatient_prescriptions patched', s;
  END LOOP;
END $$;

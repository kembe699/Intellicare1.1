-- Give conventional boolean flags a FALSE default, and backfill existing NULLs.
--
-- This class of bug has now bitten twice: password_reset_tokens.used and
-- lab_machine_raw_results.is_processed both arrived from the MySQL migration
-- nullable with no default. An INSERT that did not name the column produced
-- NULL, and the lookups tested `col = FALSE`, which against NULL evaluates to
-- NULL rather than true. Both failed silently — a valid reset link reported
-- itself expired, and a result sitting in the holding tank reported itself
-- missing.
--
-- Only columns whose names are unambiguous flags are touched (is_/has_/can_/
-- allow_ prefixes, _processed/_posted/_required/_created/_approved suffixes).
-- A boolean that legitimately carries three states — true, false, "not yet
-- decided" — would be broken by this, and those do not follow this naming.
DO $$
DECLARE r record; n bigint; total int := 0;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
     WHERE c.table_schema LIKE 'tenant\_%'
       AND c.data_type = 'boolean'
       AND c.is_nullable = 'YES'
       AND c.column_default IS NULL
       AND (c.column_name ~ '^(is|has|can|allow)_'
            OR c.column_name ~ '_(processed|posted|required|created|approved|active|paid|voided|sent|used)$'
            OR c.column_name = 'used')
     ORDER BY 1, 2, 3
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IS NULL',
                   r.table_schema, r.table_name, r.column_name) INTO n;
    EXECUTE format('UPDATE %I.%I SET %I = FALSE WHERE %I IS NULL',
                   r.table_schema, r.table_name, r.column_name, r.column_name);
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT FALSE',
                   r.table_schema, r.table_name, r.column_name);
    total := total + 1;
    IF n > 0 THEN
      RAISE NOTICE '  %.%.% : % NULL row(s) set to false, default added',
        r.table_schema, r.table_name, r.column_name, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'columns given a FALSE default: %', total;
END $$;

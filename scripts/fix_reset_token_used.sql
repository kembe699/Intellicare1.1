-- Give password_reset_tokens.used a default, across every tenant schema.
--
-- The column arrived from the MySQL migration nullable and with no default, so
-- an INSERT that did not name it produced used = NULL. The lookup then tested
-- `used = FALSE`, which against NULL evaluates to NULL rather than true, so a
-- valid token never matched and every reset link reported itself expired.
--
-- The application no longer depends on the default (it sets the column
-- explicitly) and tests IS NOT TRUE, but a correct default belongs on the
-- column regardless — any other writer would hit the same trap.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\_%' ORDER BY 1 LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=s AND tablename='password_reset_tokens') THEN
      EXECUTE format('UPDATE %I.password_reset_tokens SET used = FALSE WHERE used IS NULL', s);
      EXECUTE format('ALTER TABLE %I.password_reset_tokens ALTER COLUMN used SET DEFAULT FALSE', s);
      EXECUTE format('ALTER TABLE %I.password_reset_tokens ALTER COLUMN used SET NOT NULL', s);
      RAISE NOTICE '% : password_reset_tokens.used defaulted to FALSE', s;
    END IF;
  END LOOP;
END $$;

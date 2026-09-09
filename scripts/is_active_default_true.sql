-- A row that is created should be visible.
--
-- is_active defaults to FALSE on 28 tables, and every list filters on it — so
-- any INSERT that does not set the flag explicitly saves a row nobody can see.
-- Adding a room did exactly that: it returned 201, the row was written, and it
-- never appeared in the list.
--
-- The default is flipped so a new row is active unless something says otherwise.
-- Existing rows are deliberately left alone: deleting a room, ward, service or
-- user is a soft delete that sets this flag to false, so switching the existing
-- ones on would resurrect deleted records.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND column_name = 'is_active'
       AND column_default ILIKE '%false%'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN is_active SET DEFAULT TRUE', t);
  END LOOP;
END $$;

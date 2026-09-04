-- Keep pharmacy_prescriptions.status derived from its prescription_lines.
--
-- The header status was maintained by hand in one dispense handler
-- (pharmacyModule.js, "8. Update prescription status"), which left three ways
-- for it to drift out of step with the lines it summarises:
--
--   * cancelling a single line and editing a line's quantity never recompute
--     the header at all;
--   * the recompute only runs when the request happens to carry prescriptionId,
--     so a dispense addressed by line alone finishes the last line and leaves
--     the header on 'partial_dispensed';
--   * it is wrapped in a non-blocking try/catch, so a failure there is logged
--     and swallowed rather than rolling back the dispense.
--
-- That is what RX-202609-0011 hit: both lines 'dispensed' in full, header stuck
-- on 'partial_dispensed'. Besides reading wrong, that also keeps a finished
-- prescription in the dispensing queue, which asks for pending + partial.
--
-- A trigger fixes it for every writer at once, including raw SQL and any
-- handler added later, which hand-maintained status in five call sites cannot.
--
-- Deliberate restraint: the header is only ever moved between the three
-- lifecycle values. 'cancelled' is an explicit act by a user and is never
-- recomputed away, and a prescription whose lines are all cancelled is left
-- exactly as the application set it.
--
-- ids here are varchar, not integer, so the helper takes text: prescription_lines
-- and pharmacy_prescriptions both carry varchar keys in every tenant schema.

CREATE OR REPLACE FUNCTION sync_prescription_status(rx_id text)
RETURNS void AS $fn$
DECLARE
  n_active     int;
  n_unfinished int;
  n_dispensed  int;
  next_status  text;
BEGIN
  IF rx_id IS NULL THEN RETURN; END IF;

  SELECT count(*) FILTER (WHERE status IS DISTINCT FROM 'cancelled'),
         count(*) FILTER (WHERE status IN ('pending', 'partial')),
         count(*) FILTER (WHERE status = 'dispensed')
    INTO n_active, n_unfinished, n_dispensed
    FROM prescription_lines
   WHERE prescription_id = rx_id;

  -- No line left to summarise (none yet, or every one cancelled): leave the
  -- header on whatever the application chose.
  IF n_active = 0 THEN RETURN; END IF;

  next_status := CASE
    WHEN n_unfinished = 0 THEN 'dispensed'
    WHEN n_dispensed > 0  THEN 'partial_dispensed'
    ELSE 'pending'
  END;

  UPDATE pharmacy_prescriptions
     SET status = next_status
   WHERE id = rx_id
     AND status IN ('pending', 'partial_dispensed', 'dispensed')
     AND status IS DISTINCT FROM next_status;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_sync_prescription_status()
RETURNS trigger AS $fn$
BEGIN
  PERFORM sync_prescription_status(NEW.prescription_id);
  -- A line moved between prescriptions: the one it left needs recomputing too.
  IF TG_OP = 'UPDATE' AND OLD.prescription_id IS DISTINCT FROM NEW.prescription_id THEN
    PERFORM sync_prescription_status(OLD.prescription_id);
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_sync_prescription_status_del()
RETURNS trigger AS $fn$
BEGIN
  PERFORM sync_prescription_status(OLD.prescription_id);
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prescription_lines_rollup     ON prescription_lines;
DROP TRIGGER IF EXISTS prescription_lines_rollup_del ON prescription_lines;

CREATE TRIGGER prescription_lines_rollup
AFTER INSERT OR UPDATE OF status, prescription_id, total_quantity_dispensed, quantity_prescribed
ON prescription_lines
FOR EACH ROW EXECUTE FUNCTION trg_sync_prescription_status();

CREATE TRIGGER prescription_lines_rollup_del
AFTER DELETE ON prescription_lines
FOR EACH ROW EXECUTE FUNCTION trg_sync_prescription_status_del();

-- Backfill anything that already drifted.
UPDATE pharmacy_prescriptions pp
   SET status = d.next_status
  FROM (
    SELECT pl.prescription_id AS id,
           CASE
             WHEN count(*) FILTER (WHERE pl.status IN ('pending','partial')) = 0 THEN 'dispensed'
             WHEN count(*) FILTER (WHERE pl.status = 'dispensed') > 0 THEN 'partial_dispensed'
             ELSE 'pending'
           END AS next_status
      FROM prescription_lines pl
     WHERE pl.status IS DISTINCT FROM 'cancelled'
     GROUP BY pl.prescription_id
  ) d
 WHERE pp.id = d.id
   AND pp.status IN ('pending', 'partial_dispensed', 'dispensed')
   AND pp.status IS DISTINCT FROM d.next_status;

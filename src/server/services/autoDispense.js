/**
 * Dispense prescription lines the patient has already paid for.
 *
 * Prescriptions carry no bill reference — no bill_id, and in practice no
 * visit_id either — so "has this been paid for?" cannot be answered by a join.
 * The only link is the drug's name appearing as a paid line on one of the
 * patient's bills, which is what the counter staff match on by eye today. That
 * is the match used here, and it is deliberately narrow: the drug name must
 * match exactly (case and surrounding space aside) on a line of that patient's
 * bill that is marked paid and not voided.
 *
 * Anything that does not match is left pending. Dispensing moves real stock and
 * tells a clinician a patient received a medicine, so an uncertain match is
 * always left for a human rather than guessed at.
 *
 * The manual route (POST /pharmacy-module/dispensing) remains the richer path —
 * it handles batch selection, counselling notes and operator-chosen quantities.
 * This covers the narrower case of "the patient paid, give them what was
 * prescribed", which is the whole of the automatic and backfill flows.
 */
const { v4: uuidv4 } = require('uuid');

/**
 * Pending lines for this patient that appear as a paid line on one of their bills.
 * Returns enough to dispense: the line, its drug, what is prescribed, and stock.
 */
const PAID_PENDING_LINES = `
  WITH paid_names AS (
    SELECT DISTINCT lower(trim(s->>'serviceName')) AS name
      FROM patient_bills b,
           LATERAL jsonb_array_elements(b.services::jsonb) s
     WHERE b.patient_id = :patientId
       AND b.status <> 'cancelled'
       AND COALESCE((s->>'isVoided')::boolean, false) = false
       AND (COALESCE((s->>'paid')::boolean, false) OR lower(COALESCE(s->>'status','')) = 'paid')
  )
  SELECT pl.id            AS line_id,
         pl.prescription_id,
         pl.drug_id       AS inventory_item_id,
         pl.unit_of_measure,
         p.clinic_id,
         p.patient_id,
         p.prescription_number,
         (pl.quantity_prescribed - COALESCE(pl.total_quantity_dispensed, 0)) AS outstanding,
         COALESCE(ii.item_name, pl.external_drug_name) AS drug_name,
         COALESCE(ii.quantity_on_hand, 0)  AS stock,
         COALESCE(ii.selling_price, 0)     AS unit_price,
         ii.cost_currency
    FROM prescription_lines pl
    JOIN pharmacy_prescriptions p ON p.id = pl.prescription_id
    LEFT JOIN inventory_items ii ON ii.id = pl.drug_id
   WHERE p.patient_id = :patientId
     AND p.status IN ('pending', 'partial_dispensed')
     AND pl.status IN ('pending', 'partial')
     AND (pl.quantity_prescribed - COALESCE(pl.total_quantity_dispensed, 0)) > 0
     AND lower(trim(COALESCE(ii.item_name, pl.external_drug_name))) IN (SELECT name FROM paid_names)
   ORDER BY p.prescription_date, pl.line_number
`;

/**
 * Dispense one line, with every side effect the manual route produces: a
 * dispensing record, the stock movement, an inventory transaction for the audit
 * trail, and the line and prescription statuses brought up to date.
 */
async function dispenseLine(sequelize, line, quantity, pharmacistId, transaction) {
  // pharmacist_id is a numeric user id. A caller with no user behind it (the
  // backlog run) or a label instead of an id would abort the whole insert on a
  // type error, so anything non-numeric is recorded as "no pharmacist" and the
  // dispensing note carries the provenance instead.
  const pharmacist = Number.isFinite(Number(pharmacistId)) && String(pharmacistId).trim() !== ''
    ? Number(pharmacistId)
    : null;
  const now = new Date();
  const prefix = `DISP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [[seqRow]] = await sequelize.query(
    'SELECT COUNT(*) AS cnt FROM dispensing_records WHERE dispensing_number LIKE :prefix',
    { replacements: { prefix: `${prefix}%` }, transaction }
  );
  const dispensingNumber = `${prefix}-${String((parseInt(seqRow?.cnt, 10) || 0) + 1).padStart(4, '0')}`;
  const dispId = uuidv4();
  const unitPrice = parseFloat(line.unit_price) || 0;

  await sequelize.query(`
    INSERT INTO dispensing_records (id, clinic_id, dispensing_number, prescription_id, prescription_line_id,
      patient_id, drug_id, pharmacist_id, inventory_item_id,
      dispensing_date, dispensing_time, quantity_dispensed, unit_of_measure,
      unit_price, currency_code, exchange_rate, total_price, total_price_base,
      dispensing_notes, patient_counselling_provided, status)
    VALUES (:id, :cid, :dn, :rxid, :rxlid,
      :pid, :did, :phid, :iid,
      CURRENT_DATE, CURRENT_TIME, :qty, :uom,
      :price, :cur, 1, :total, :total,
      :notes, false, 'completed')
  `, {
    replacements: {
      id: dispId, cid: line.clinic_id, dn: dispensingNumber,
      rxid: line.prescription_id, rxlid: line.line_id,
      pid: line.patient_id, did: line.inventory_item_id, phid: pharmacist,
      iid: line.inventory_item_id, qty: quantity, uom: line.unit_of_measure || null,
      price: unitPrice, cur: line.cost_currency || null,
      total: unitPrice * quantity,
      notes: 'Dispensed automatically — already paid for',
    },
    transaction,
  });

  await sequelize.query(
    'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :id',
    { replacements: { qty: quantity, id: line.inventory_item_id }, transaction }
  );

  await sequelize.query(`
    INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
      quantity_change, reference_type, reference_id, transaction_date, notes, created_by)
    VALUES (:id, :cid, :txn, :iid, 'dispense', :qty, 'dispensing', :ref, CURRENT_DATE, :notes, :by)
  `, {
    replacements: {
      id: uuidv4(), cid: line.clinic_id, txn: `TXN-DISP-${dispensingNumber}`,
      iid: line.inventory_item_id, qty: -quantity, ref: dispensingNumber,
      notes: 'Dispensed automatically — already paid for', by: pharmacist,
    },
    transaction,
  });

  await sequelize.query(
    `UPDATE prescription_lines
        SET total_quantity_dispensed = COALESCE(total_quantity_dispensed, 0) + :qty,
            status = CASE WHEN COALESCE(total_quantity_dispensed, 0) + :qty >= quantity_prescribed
                          THEN 'dispensed' ELSE 'partial' END
      WHERE id = :id`,
    { replacements: { qty: quantity, id: line.line_id }, transaction }
  );

  await sequelize.query(
    `UPDATE pharmacy_prescriptions
        SET status = CASE WHEN (SELECT COUNT(*) FROM prescription_lines
                                 WHERE prescription_id = :rxid AND status IN ('pending', 'partial')) = 0
                          THEN 'dispensed' ELSE 'partial_dispensed' END
      WHERE id = :rxid`,
    { replacements: { rxid: line.prescription_id }, transaction }
  );

  return { dispensingNumber, quantity };
}

/**
 * Dispense everything this patient has paid for and not yet received.
 *
 * A line short of stock is skipped rather than driving inventory negative or
 * part-dispensing silently — the pharmacist needs to see that and decide. Each
 * line commits on its own so one problem drug does not roll back the rest.
 */
async function dispensePaidFor(sequelize, patientId, pharmacistId = null, { dryRun = false } = {}) {
  const [lines] = await sequelize.query(PAID_PENDING_LINES, { replacements: { patientId } });

  const result = { dispensed: [], skipped: [] };

  for (const line of lines) {
    const wanted = Number(line.outstanding) || 0;
    const stock = Number(line.stock) || 0;
    if (wanted <= 0) continue;

    if (!line.inventory_item_id || stock < wanted) {
      result.skipped.push({
        prescription: line.prescription_number,
        drug: line.drug_name,
        needed: wanted,
        stock,
        reason: !line.inventory_item_id ? 'no inventory item' : 'insufficient stock',
      });
      continue;
    }

    if (dryRun) {
      result.dispensed.push({ prescription: line.prescription_number, drug: line.drug_name, quantity: wanted });
      continue;
    }

    const t = await sequelize.transaction();
    try {
      await dispenseLine(sequelize, line, wanted, pharmacistId, t);
      await t.commit();
      result.dispensed.push({ prescription: line.prescription_number, drug: line.drug_name, quantity: wanted });
    } catch (err) {
      if (!t.finished) await t.rollback().catch(() => {});
      result.skipped.push({
        prescription: line.prescription_number, drug: line.drug_name,
        needed: wanted, stock, reason: err.message,
      });
    }
  }

  return result;
}

module.exports = { dispensePaidFor, PAID_PENDING_LINES };

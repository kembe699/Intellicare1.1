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
         p.branch_id,
         p.patient_id,
         p.prescription_number,
         (pl.quantity_prescribed - COALESCE(pl.total_quantity_dispensed, 0)) AS outstanding,
         COALESCE(ii.item_name, pl.external_drug_name) AS drug_name,
         COALESCE(ii.quantity_on_hand, 0)  AS stock,
         COALESCE(ii.selling_price, 0)     AS unit_price,
         COALESCE(NULLIF(ii.units_per_pack, 0), 1) AS units_per_pack,
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
 * Store stock (stock_by_location) moves with the item total. When no store
 * was chosen, an item kept in exactly one store is taken from that store;
 * with several, there's no way to know which shelf it came off, so only the
 * total moves (the same rule approving a stock count uses).
 */
async function deductSingleStore(sequelize, itemId, packQty, transaction) {
  const [stores] = await sequelize.query(
    'SELECT id FROM stock_by_location WHERE item_id = :iid',
    { replacements: { iid: itemId }, transaction }
  );
  if (stores.length !== 1) return null;
  await sequelize.query(
    'UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :id',
    { replacements: { qty: packQty, id: stores[0].id }, transaction }
  );
  return stores[0].id;
}

/** Takes packQty out of the item's batches, earliest expiry first. */
async function deductBatches(sequelize, itemId, packQty, transaction) {
  const [batches] = await sequelize.query(
    `SELECT id, (quantity_received - COALESCE(quantity_used, 0)) AS remaining
       FROM inventory_batches
      WHERE item_id = :iid
        AND COALESCE(status, 'active') = 'active'
        AND (quantity_received - COALESCE(quantity_used, 0)) > 0
      ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
    { replacements: { iid: itemId }, transaction }
  );
  let toTake = packQty;
  for (const batch of batches) {
    if (toTake <= 0) break;
    const take = Math.min(toTake, Number(batch.remaining) || 0);
    if (take <= 0) continue;
    await sequelize.query(
      `UPDATE inventory_batches
          SET quantity_used = COALESCE(quantity_used, 0) + :qty,
              status = CASE WHEN (quantity_received - (COALESCE(quantity_used, 0) + :qty)) <= 0
                            THEN 'depleted' ELSE status END
        WHERE id = :id`,
      { replacements: { qty: take, id: batch.id }, transaction }
    );
    toTake -= take;
  }
}

async function nextDispensingNumber(sequelize, transaction) {
  const now = new Date();
  const prefix = `DISP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [[seqRow]] = await sequelize.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(dispensing_number, '^.*-', ''), '')::int), 0) AS last
       FROM dispensing_records
      WHERE dispensing_number LIKE :prefix
        AND dispensing_number ~ '-[0-9]+$'`,
    { replacements: { prefix: `${prefix}%` }, transaction }
  );
  return `${prefix}-${String((parseInt(seqRow?.last, 10) || 0) + 1).padStart(4, '0')}`;
}

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
  const dispensingNumber = await nextDispensingNumber(sequelize, transaction);
  const dispId = uuidv4();
  const unitPrice = parseFloat(line.unit_price) || 0;
  // Prescriptions are written in doses (tablets); stock, batches and the
  // selling price are per pack (a strip of units_per_pack). Same conversion
  // the counter route makes — this path used to take a whole strip off stock
  // and charge a full strip for every single tablet.
  const unitsPerPack = parseFloat(line.units_per_pack) || 1;
  const packQty = quantity / unitsPerPack;

  await sequelize.query(`
    INSERT INTO dispensing_records (id, clinic_id, branch_id, dispensing_number, prescription_id, prescription_line_id,
      patient_id, drug_id, pharmacist_id, inventory_item_id,
      dispensing_date, dispensing_time, quantity_dispensed, unit_of_measure,
      unit_price, currency_code, exchange_rate, total_price, total_price_base,
      dispensing_notes, patient_counselling_provided, status)
    VALUES (:id, :cid, :branchId, :dn, :rxid, :rxlid,
      :pid, :did, :phid, :iid,
      CURRENT_DATE, CURRENT_TIME, :qty, :uom,
      :price, :cur, 1, :total, :total,
      :notes, false, 'completed')
  `, {
    replacements: {
      id: dispId, cid: line.clinic_id,
      // Inherit the prescription's branch. Reads filter on it, so a record left
      // NULL is invisible to the pharmacist who dispensed it — only an admin,
      // who bypasses the filter, would ever see it in History.
      branchId: line.branch_id || null,
      dn: dispensingNumber,
      rxid: line.prescription_id, rxlid: line.line_id,
      pid: line.patient_id, did: line.inventory_item_id, phid: pharmacist,
      iid: line.inventory_item_id, qty: quantity, uom: line.unit_of_measure || null,
      price: unitPrice, cur: line.cost_currency || null,
      total: unitPrice * packQty,
      notes: 'Dispensed automatically — already paid for',
    },
    transaction,
  });

  await sequelize.query(
    'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :id',
    { replacements: { qty: packQty, id: line.inventory_item_id }, transaction }
  );
  await deductSingleStore(sequelize, line.inventory_item_id, packQty, transaction);

  // Take the stock out of a batch as well as off the item.
  //
  // Dispensing has to reduce both, or the two drift apart: the item falls while
  // the batches keep showing the same stock, and anything that treats batches as
  // the record of what arrived — the on-hand reconciler does — reads the gap as
  // stock never posted and puts it back, undoing a real dispense. Batch and
  // expiry tracking would also keep offering stock that has already gone.
  //
  // Earliest expiry first, matching the manual counter route, so short-dated
  // stock is used before it is wasted.
  await deductBatches(sequelize, line.inventory_item_id, packQty, transaction);

  await sequelize.query(`
    INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
      quantity_change, reference_type, reference_id, transaction_date, notes, created_by)
    VALUES (:id, :cid, :txn, :iid, 'dispense', :qty, 'dispensing', :ref, CURRENT_DATE, :notes, :by)
  `, {
    replacements: {
      id: uuidv4(), cid: line.clinic_id, txn: `TXN-DISP-${dispensingNumber}`,
      iid: line.inventory_item_id, qty: -packQty, ref: dispensingNumber,
      notes: 'Dispensed automatically — already paid for', by: pharmacist,
    },
    transaction,
  });

  // Two statements rather than one. A placeholder inside a CASE that also holds
  // string literals trips Sequelize's replacement parser — it emits the ':' to
  // PostgreSQL unsubstituted and the statement dies on a syntax error, which
  // surfaces only as "Validation error" once the driver has wrapped it.
  await sequelize.query(
    `UPDATE prescription_lines
        SET total_quantity_dispensed = COALESCE(total_quantity_dispensed, 0) + :qty
      WHERE id = :id`,
    { replacements: { qty: quantity, id: line.line_id }, transaction }
  );

  await sequelize.query(
    `UPDATE prescription_lines
        SET status = CASE WHEN COALESCE(total_quantity_dispensed, 0) >= quantity_prescribed
                          THEN 'dispensed' ELSE 'partial' END
      WHERE id = :id`,
    { replacements: { id: line.line_id }, transaction }
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
    const wantedPacks = wanted / (Number(line.units_per_pack) || 1);

    if (!line.inventory_item_id || stock < wantedPacks - 1e-9) {
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
      // Re-read the line under a lock: the counter may have dispensed it by hand
      // since the list above was read. Same guard as POST /dispensing.
      const [[fresh]] = await sequelize.query(
        `SELECT quantity_prescribed - COALESCE(total_quantity_dispensed, 0) AS outstanding
           FROM prescription_lines WHERE id = :id FOR UPDATE`,
        { replacements: { id: line.line_id }, transaction: t }
      );
      if (!fresh || Number(fresh.outstanding) < wanted - 1e-6) {
        await t.rollback();
        result.skipped.push({ prescription: line.prescription_number, drug: line.drug_name, needed: wanted, stock, reason: 'already dispensed' });
        continue;
      }
      await dispenseLine(sequelize, line, wanted, pharmacistId, t);
      await t.commit();
      result.dispensed.push({ prescription: line.prescription_number, drug: line.drug_name, quantity: wanted });
    } catch (err) {
      if (!t.finished) await t.rollback().catch(() => {});
      // "Validation error" is all Sequelize puts in .message for a constraint or
      // type failure; the column and detail live on the driver error underneath.
      // Without them a skipped line says nothing about why it was skipped, which
      // is useless to the pharmacist who has to chase it.
      const cause = err.parent || err.original;
      const detail = [cause?.detail, cause?.column && `column ${cause.column}`, cause?.constraint]
        .filter(Boolean).join('; ');
      result.skipped.push({
        prescription: line.prescription_number, drug: line.drug_name,
        needed: wanted, stock,
        reason: detail ? `${err.message} (${detail})` : err.message,
      });
    }
  }

  return result;
}

/**
 * Dispense drugs/products added straight onto a bill (Patients Bill › add
 * item) once they are paid. Those lines never had a pharmacy prescription, so
 * nothing ever recorded them as dispensed or took them off the shelf — a
 * hospital billing its pharmacy this way (Nation Care since early October)
 * had pharmacy revenue and COGS but no dispensing history and stock that
 * never moved.
 *
 * Only lines stamped `dispenseOnPayment` qualify: the bill screen sets it on
 * a product it adds, while the pharmacy screens bill their own prescription
 * lines (dispensed through the prescription instead) without it — so the same
 * drug is never dispensed twice. Each line is stamped with its dispensing
 * number once done, so a later payment on the same bill never repeats it.
 * COGS is not posted here: billing already posted it (pharmacyCogsOnBill).
 */
async function dispenseBilledProducts(sequelize, billId, pharmacistId = null) {
  const result = { dispensed: [], skipped: [] };
  const t = await sequelize.transaction();
  try {
    const [[bill]] = await sequelize.query(
      `SELECT id, clinic_id, branch_id, patient_id, services, status::text AS status
         FROM patient_bills WHERE id = :id FOR UPDATE`,
      { replacements: { id: billId }, transaction: t }
    );
    if (!bill || bill.status === 'cancelled') { await t.rollback(); return result; }
    let lines;
    try { lines = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services; } catch { lines = null; }
    if (!Array.isArray(lines)) { await t.rollback(); return result; }

    const pharmacist = Number.isFinite(Number(pharmacistId)) && String(pharmacistId).trim() !== '' ? Number(pharmacistId) : null;
    let changed = false;
    for (const line of lines) {
      if (!line || !line.dispenseOnPayment || line.dispensingNumber || line.isVoided) continue;
      const paid = line.paid === true || String(line.status || '').toLowerCase() === 'paid';
      if (!paid || !line.serviceId) continue;
      const [[item]] = await sequelize.query(
        `SELECT id, item_name, quantity_on_hand, unit_of_measure, cost_currency,
                COALESCE(NULLIF(units_per_pack, 0), 1) AS units_per_pack
           FROM inventory_items WHERE id::text = :id`,
        { replacements: { id: String(line.serviceId) }, transaction: t }
      );
      if (!item) continue;
      // Billed quantity is in packs — the bill screen prices a product at its
      // per-pack selling price.
      const packQty = Number(line.quantity) || 1;
      if (Number(item.quantity_on_hand) < packQty - 1e-9) {
        result.skipped.push({ drug: item.item_name, needed: packQty, stock: Number(item.quantity_on_hand), reason: 'insufficient stock' });
        continue;
      }
      const dispensingNumber = await nextDispensingNumber(sequelize, t);
      const total = Number(line.totalPrice ?? 0) || 0;
      await sequelize.query(`
        INSERT INTO dispensing_records (id, clinic_id, branch_id, dispensing_number, patient_id, drug_id, pharmacist_id, inventory_item_id,
          dispensing_date, dispensing_time, quantity_dispensed, unit_of_measure,
          unit_price, currency_code, exchange_rate, total_price, total_price_base, dispensing_notes, patient_counselling_provided, status)
        VALUES (:id, :cid, :branchId, :dn, :pid, :iid, :phid, :iid,
          CURRENT_DATE, CURRENT_TIME, :qty, :uom,
          :price, :cur, 1, :total, :total, :notes, false, 'completed')
      `, {
        replacements: {
          id: uuidv4(), cid: bill.clinic_id, branchId: bill.branch_id || null, dn: dispensingNumber,
          pid: bill.patient_id, iid: item.id, phid: pharmacist,
          qty: packQty * Number(item.units_per_pack), uom: item.unit_of_measure || null,
          price: Number(line.unitPrice ?? 0) || 0, cur: item.cost_currency || null, total,
          notes: 'Dispensed on payment — billed on the patient bill',
        },
        transaction: t,
      });
      await sequelize.query(
        'UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :id',
        { replacements: { qty: packQty, id: item.id }, transaction: t }
      );
      await deductSingleStore(sequelize, item.id, packQty, t);
      await deductBatches(sequelize, item.id, packQty, t);
      await sequelize.query(`
        INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
          quantity_change, reference_type, reference_id, transaction_date, notes, created_by)
        VALUES (:id, :cid, :txn, :iid, 'dispense', :qty, 'dispensing', :ref, CURRENT_DATE, :notes, :by)
      `, {
        replacements: {
          id: uuidv4(), cid: bill.clinic_id, txn: `TXN-DISP-${dispensingNumber}`, iid: item.id,
          qty: -packQty, ref: dispensingNumber, notes: 'Dispensed on payment — billed on the patient bill', by: pharmacist,
        },
        transaction: t,
      });
      line.dispensingNumber = dispensingNumber;
      line.dispensedAt = new Date().toISOString();
      changed = true;
      result.dispensed.push({ drug: item.item_name, quantity: packQty, dispensingNumber });
    }
    if (changed) {
      await sequelize.query('UPDATE patient_bills SET services = :s WHERE id = :id', {
        replacements: { s: JSON.stringify(lines), id: bill.id }, transaction: t,
      });
    }
    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback().catch(() => {});
    throw err;
  }
  return result;
}

module.exports = { dispensePaidFor, dispenseBilledProducts, deductSingleStore, PAID_PENDING_LINES };

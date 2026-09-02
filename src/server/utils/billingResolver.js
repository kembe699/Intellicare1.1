const { normalizeServices } = require('./normalizeServices');

// The patient's current open (not-yet-closed) clinical encounter, if any.
//
// The live doctor workflow's unit of encounter is an `lis_test_orders` row (created per
// visit via POST /lis/orders, closed via PUT /lis/orders/:id/close). That row is what
// "this visit's bill" means — see patientBills.js's GET /active/:patientId/:clinicId for
// the original definition this mirrors. Every writer that creates or appends to a bill
// must resolve "the active bill" the exact same way, or a bill from a previous, already-
// closed visit keeps absorbing charges from a brand-new one (or a brand-new bill gets
// created next to one that should have been reused) purely because two code paths
// disagreed on what "active" means.
async function getCurrentOpenVisitId(patientId, clinicId) {
  if (!patientId) return null;
  try {
    const { sequelize } = require('../models');
    const [[order]] = await sequelize.query(
      `SELECT id FROM lis_test_orders WHERE participant_id = :pid AND status != 'closed' ORDER BY created_at DESC LIMIT 1`,
      { replacements: { pid: patientId } }
    );
    return order?.id || null;
  } catch (e) {
    return null;
  }
}

// Distinguishes "never had a clinical encounter at all" (pure pharmacy/walk-in patient —
// falls back to the pre-existing patient-wide bill lookup) from "has visit history but
// every visit is closed right now" (must NOT fall back, or a bill from an already-closed
// visit would keep being found and reused forever).
async function hasAnyVisitHistory(patientId) {
  if (!patientId) return false;
  try {
    const { sequelize } = require('../models');
    const [[row]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM lis_test_orders WHERE participant_id = :pid`,
      { replacements: { pid: patientId } }
    );
    return (parseInt(row?.cnt, 10) || 0) > 0;
  } catch (e) {
    return false;
  }
}

// Finds the one bill that new charges for this patient/encounter should land on, using
// the exact same visit-scoping rule as GET /active/:patientId/:clinicId. Pass a
// transaction + lock to hold the row (or the gap, if none exists yet) for the duration of
// a read-modify-write so concurrent callers can't both read the same stale total and
// silently drop one write (the "lost update" pattern that produced wrong bill totals).
async function resolveActiveBill(patientId, clinicId, { transaction, lock, visitId } = {}) {
  const { PatientBill } = require('../models');
  const { Op } = require('sequelize');

  const resolvedVisitId = visitId !== undefined ? visitId : await getCurrentOpenVisitId(patientId, clinicId);
  const statusFilter = { [Op.in]: ['pending', 'partial', 'paid', 'active'] };

  if (resolvedVisitId) {
    const bill = await PatientBill.findOne({
      where: { patient_id: patientId, clinic_id: clinicId, visit_id: resolvedVisitId, status: statusFilter },
      order: [['created_at', 'DESC']],
      transaction,
      lock,
    });
    return { bill, resolvedVisitId };
  }

  // No open visit. If this patient has visit history at all, every visit is closed —
  // there must be no reusable bill; the next charge starts a fresh one.
  if (await hasAnyVisitHistory(patientId)) {
    return { bill: null, resolvedVisitId: null };
  }

  // Truly never had a visit (pure walk-in) — fall back to the patient-wide lookup.
  const bill = await PatientBill.findOne({
    where: { patient_id: patientId, clinic_id: clinicId, status: statusFilter },
    order: [['created_at', 'DESC']],
    transaction,
    lock,
  });
  return { bill, resolvedVisitId: null };
}

// The single canonical "append these line items to the patient's current bill, creating
// one if none exists" operation. Wrapped in a transaction with a row lock (or gap lock,
// via resolveActiveBill, when no matching row exists yet) so two concurrent calls for the
// same patient/visit serialize instead of racing — one waits, re-resolves, and appends to
// what the first one just created/updated, instead of both creating separate bills or
// both overwriting each other's totals.
async function addLineItemsToBill({ patientId, patientName, clinicId, branchId, lineItems, notes, createdBy, visitId }) {
  const { PatientBill, sequelize } = require('../models');
  if (!patientId || !Array.isArray(lineItems) || lineItems.length === 0) return null;

  const total = lineItems.reduce((sum, li) => sum + (parseFloat(li.totalPrice) || 0), 0);

  const run = async () => sequelize.transaction(async (t) => {
    const { bill, resolvedVisitId } = await resolveActiveBill(patientId, clinicId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      visitId,
    });

    if (bill) {
      const services = normalizeServices(bill.services);
      services.push(...lineItems);
      const newTotal = parseFloat(bill.total_amount) + total;
      const paid = parseFloat(bill.paid_amount);
      const newBalance = newTotal - paid;
      await bill.update({
        services,
        total_amount: newTotal,
        balance_amount: newBalance,
        status: newBalance <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'pending',
        updated_at: new Date(),
      }, { transaction: t });
      return bill;
    }

    return PatientBill.create({
      bill_number: `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      patient_id: patientId,
      patient_name: patientName,
      clinic_id: clinicId,
      branch_id: branchId || null,
      total_amount: total,
      paid_amount: 0,
      balance_amount: total,
      status: 'pending',
      bill_date: new Date(),
      services: lineItems,
      notes: notes || null,
      created_by: createdBy || 'System',
      visit_id: resolvedVisitId,
    }, { transaction: t });
  });

  try {
    return await run();
  } catch (e) {
    // Belt-and-suspenders against the unique index on visit_id: the row-lock above
    // already serializes same-process races, but if a second bill for this visit_id was
    // committed between our lock read and our insert (e.g. a different DB connection
    // pool racing at the gap-lock boundary), retry once — the second pass will now find
    // the row the first attempt created and append to it instead of erroring out.
    if (e.name === 'SequelizeUniqueConstraintError' || e.original?.code === 'ER_DUP_ENTRY') {
      return run();
    }
    throw e;
  }
}

// Reconciles a growing charge (currently just inpatient bed fees) to a target
// CUMULATIVE quantity across the whole stay, WITHOUT touching any line that's
// already been paid or invoiced — those represent money already collected
// (or already handed to a credit invoice) and must stand exactly as they
// were at that moment. This matters because a partial payment can land on
// this exact line mid-stay: if the patient pays for 5 of their (at the time)
// 5 admitted days, that line is settled — day 6 onward has to accrue on a
// *new*, still-open line, not by inflating the totalPrice of a line that's
// already marked paid (which would silently orphan the difference: the bill
// total grows but paid_amount doesn't, while the line still reads "paid").
//
// quantity here is the target TOTAL for the whole stay (e.g. "26 days so
// far"), not a delta — settled quantity from paid/invoiced lines of the same
// serviceName is subtracted off to get what the (at most one) open line
// should actually show.
async function updateOrAddLineItem({ patientId, patientName, clinicId, branchId, serviceName, quantity, unitPrice, notes, createdBy, visitId }) {
  const { PatientBill, sequelize } = require('../models');
  if (!patientId || !serviceName) return null;

  const run = async () => sequelize.transaction(async (t) => {
    const { bill, resolvedVisitId } = await resolveActiveBill(patientId, clinicId, { transaction: t, lock: t.LOCK.UPDATE, visitId });

    if (!bill) {
      const totalPrice = parseFloat((quantity * unitPrice).toFixed(2));
      if (totalPrice <= 0) return null;
      return PatientBill.create({
        bill_number: `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
        patient_id: patientId,
        patient_name: patientName,
        clinic_id: clinicId,
        branch_id: branchId || null,
        total_amount: totalPrice,
        paid_amount: 0,
        balance_amount: totalPrice,
        status: 'pending',
        bill_date: new Date(),
        services: [{ serviceName, quantity, unitPrice, totalPrice }],
        notes: notes || null,
        created_by: createdBy || 'System',
        visit_id: resolvedVisitId,
      }, { transaction: t });
    }

    const services = normalizeServices(bill.services);
    const matching = services.filter((s) => !s.isVoided && s.serviceName === serviceName);
    const settledQty = matching
      .filter((s) => s.paid || s.invoiced)
      .reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);
    const openLineIdx = services.findIndex((s) => !s.isVoided && s.serviceName === serviceName && !s.paid && !s.invoiced);
    const neededQty = quantity - settledQty;

    // Never mutate a matched line's properties in place — normalizeServices only
    // shallow-copies the array, so `services[i]` is the exact same object
    // Sequelize is holding as the "previous" value for dirty-checking. Mutating
    // it corrupts that snapshot too, so the before/after comparison sees no
    // difference and silently drops the services column from the UPDATE
    // (confirmed live: the quantity looked right on the object returned from
    // this call, but never actually landed in the database). Always swap in a
    // brand new object instead.
    let delta = 0;
    if (neededQty <= 0) {
      // Already fully covered by settled lines — nothing owed for the new
      // total, so a stale open line (if any) has nothing left to represent.
      if (openLineIdx !== -1) {
        delta = -(parseFloat(services[openLineIdx].totalPrice) || 0);
        services.splice(openLineIdx, 1);
      }
    } else if (openLineIdx !== -1) {
      const newTotal = parseFloat((neededQty * unitPrice).toFixed(2));
      delta = newTotal - (parseFloat(services[openLineIdx].totalPrice) || 0);
      services[openLineIdx] = { ...services[openLineIdx], quantity: neededQty, unitPrice, totalPrice: newTotal };
    } else {
      const newTotal = parseFloat((neededQty * unitPrice).toFixed(2));
      services.push({ serviceName, quantity: neededQty, unitPrice, totalPrice: newTotal });
      delta = newTotal;
    }
    if (Math.abs(delta) < 0.01) return bill; // already up to date, skip the write

    const newTotal = parseFloat(bill.total_amount) + delta;
    const paid = parseFloat(bill.paid_amount);
    const newBalance = newTotal - paid;
    // The static bulk update (matching the real payment handler in
    // patientBills.js) issues a plain UPDATE ... WHERE id = :id, bypassing
    // instance-level dirty-checking entirely — belt-and-suspenders on top of
    // never mutating shared objects above, so this write can never again be
    // silently dropped because Sequelize thought nothing had changed.
    await PatientBill.update({
      services,
      total_amount: newTotal,
      balance_amount: newBalance,
      status: newBalance <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'pending',
      updated_at: new Date(),
    }, { where: { id: bill.id }, transaction: t });
    return PatientBill.findByPk(bill.id, { transaction: t });
  });

  try {
    return await run();
  } catch (e) {
    console.error('Error updating line item:', e);
    return null;
  }
}

module.exports = { getCurrentOpenVisitId, hasAnyVisitHistory, resolveActiveBill, addLineItemsToBill, updateOrAddLineItem };

/**
 * Attributes patient-bill consultation revenue to a specific consultant, for
 * the HR module's Consultant Bill feature.
 *
 * There is no hard FK from a patient bill to the visit/doctor that generated
 * it (patient_bills has no visit_id or doctor_id column) — this adapts the
 * same documented, disclosed heuristic already used in
 * src/server/routes/reportDoctorPerformance.js: a bill's Consultation-category
 * line items are attributed to whichever provider(s) saw that same patient on
 * that same calendar day (via lis_test_orders), splitting evenly when more
 * than one did. That report only credits doctor_id values matching a
 * role='doctor' user; this version does not apply that filter (a consultant's
 * linked account can have any role) and also matches visits recorded via
 * consultant_id (employees.id) for a consultant with no linked account at all
 * — linking one is optional, see hr.js. It still needs every visit in range,
 * not just the target's own, to compute correct per-bill shares when a
 * patient was seen by more than one provider the same day.
 */
const { QueryTypes } = require('sequelize');
const AccountingService = require('./AccountingService');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Cash line items are taken at face value in the bill's own currency; scheme
// (insurance) items are resolved to that same currency where possible. Kept
// deliberately simpler than reportDoctorPerformance.js's version (which
// converts insurance amounts to the base currency) since this feature bills
// per-currency and never blends — an insurance item priced in a different
// currency than the bill itself is rare enough to just fall back to its raw
// scheme price rather than pull in a full FX pipeline here.
function resolveItemAmount(item, bill) {
  const qty = num(item.quantity) || 1;
  const cashAmount =
    item.totalPrice != null ? num(item.totalPrice)
    : item.total_price != null ? num(item.total_price)
    : num(item.unitPrice ?? item.unit_price ?? item.price) * qty;

  const isIndividuallyInsured = item.schemePrice != null && cashAmount === 0;
  if (!bill.schemeId && !isIndividuallyInsured) return cashAmount;
  if (isIndividuallyInsured) return num(item.schemePrice);
  return cashAmount;
}

/**
 * Returns { consultations, totalsByCurrency } for one consultant over
 * [dateFrom, dateTo] (YYYY-MM-DD, inclusive). `consultations` is one row per
 * attributed patient bill — the granularity a "trace" UI and a bill-creation
 * step both need.
 *
 * A consultant is identified by `{ userId, employeeId }` — linking a user
 * account is optional (see hr.js), so a visit may record either a real
 * doctor_id (users.id) or a consultant_id (employees.id) when no account is
 * linked. Every visit in range is keyed onto one shared identity space
 * ("u:<id>" or "c:<id>") so the same-patient/same-day sharing logic below
 * treats a linked and unlinked provider identically when computing shares.
 */
async function getConsultationsForDoctor(sequelize, clinicId, { userId, employeeId }, dateFrom, dateTo) {
  const fromTs = `${dateFrom} 00:00:00`;
  const toTs = `${dateTo} 23:59:59`;
  const repl = { clinicId, fromTs, toTs };
  const targetKey = userId ? `u:${userId}` : `c:${employeeId}`;

  // All visits in range (any provider), to build correct per-patient/day
  // provider sets — not just this consultant's own visits.
  const visitRows = await sequelize.query(
    `SELECT o.id AS "visitId", o.doctor_id AS "doctorId", o.consultant_id AS "consultantId",
            o.participant_id AS "patientId", DATE(o.created_at) AS "visitDay"
     FROM lis_test_orders o
     WHERE (o.doctor_id IS NOT NULL OR o.consultant_id IS NOT NULL) AND o.created_at BETWEEN :fromTs AND :toTs`,
    { replacements: repl, type: QueryTypes.SELECT }
  );

  const dayLookup = new Map(); // `${patientId}|${visitDay}` -> Set(providerKey)
  for (const v of visitRows) {
    const providerKey = v.doctorId != null ? `u:${v.doctorId}` : `c:${v.consultantId}`;
    const key = `${v.patientId}|${v.visitDay}`;
    if (!dayLookup.has(key)) dayLookup.set(key, new Set());
    dayLookup.get(key).add(providerKey);
  }
  const targetHasVisit = visitRows.some(v => (v.doctorId != null ? `u:${v.doctorId}` : `c:${v.consultantId}`) === targetKey);
  if (!targetHasVisit) return { consultations: [], totalsByCurrency: {} };

  const consultationServices = await sequelize.query(
    `SELECT service_name AS "serviceName" FROM services WHERE category = 'Consultation'`,
    { type: QueryTypes.SELECT }
  );
  const consultationNames = new Set(consultationServices.map(s => normalizeName(s.serviceName)).filter(Boolean));
  if (consultationNames.size === 0) return { consultations: [], totalsByCurrency: {} };

  const bills = await sequelize.query(
    `SELECT id, patient_id AS "patientId", total_amount AS "totalAmount", paid_amount AS "paidAmount",
            status, DATE(bill_date) AS "billDay", services,
            scheme_id AS "schemeId", bill_currency AS "billCurrency"
     FROM patient_bills
     WHERE clinic_id = :clinicId AND bill_date BETWEEN :fromTs AND :toTs`,
    { replacements: repl, type: QueryTypes.SELECT }
  );

  const consultations = [];
  const totalsByCurrency = {};

  for (const bill of bills) {
    const key = `${bill.patientId}|${bill.billDay}`;
    const doctorSet = dayLookup.get(key);
    if (!doctorSet || !doctorSet.has(targetKey)) continue; // not this consultant's patient/day

    let items = [];
    try {
      const parsed = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      continue;
    }

    const billTotal = num(bill.totalAmount);
    const billPaid = num(bill.paidAmount);
    const billPaidRatio = billTotal > 0 ? Math.min(billPaid / billTotal, 1) : 0;
    const currency = bill.billCurrency || 'USD';

    let billed = 0, collected = 0;
    for (const item of items) {
      const rawName = item?.serviceName || item?.name || item?.service_name;
      const n = normalizeName(rawName);
      if (!n || !consultationNames.has(n)) continue;

      const itemTotal = resolveItemAmount(item, bill);
      let itemCollected;
      if (typeof item.paid === 'boolean') itemCollected = item.paid ? itemTotal : 0;
      else if (item.status === 'paid') itemCollected = itemTotal;
      else if (bill.status === 'paid') itemCollected = itemTotal;
      else if (bill.status === 'pending') itemCollected = 0;
      else itemCollected = itemTotal * billPaidRatio;

      billed += itemTotal;
      collected += itemCollected;
    }
    if (billed <= 0) continue;

    const share = 1 / doctorSet.size;
    const attributedBilled = billed * share;
    const attributedCollected = collected * share;

    consultations.push({
      patient_bill_id: bill.id,
      patient_id: bill.patientId,
      visit_date: bill.billDay,
      currency,
      billed_amount: Math.round(attributedBilled * 100) / 100,
      collected_amount: Math.round(attributedCollected * 100) / 100,
      shared: doctorSet.size > 1,
    });

    const t = (totalsByCurrency[currency] ||= { billed: 0, collected: 0 });
    t.billed += attributedBilled;
    t.collected += attributedCollected;
  }

  for (const c of Object.keys(totalsByCurrency)) {
    totalsByCurrency[c].billed = Math.round(totalsByCurrency[c].billed * 100) / 100;
    totalsByCurrency[c].collected = Math.round(totalsByCurrency[c].collected * 100) / 100;
  }

  return { consultations, totalsByCurrency };
}

module.exports = { getConsultationsForDoctor, normalizeName };

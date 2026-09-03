// ─── Doctor Performance Report (v2) ────────────────────────────────────────
//
// Follows the same conventions as
// reportLaboratory.js / reportPharmacy.js / reportPatients.js. Self-contained,
// PostgreSQL SQL, does not touch index.js — meant to be mounted
// separately, e.g.:
//
//   const reportDoctorPerformanceRouter = require('./routes/reportDoctorPerformance');
//   app.use('/api/reports-v2/doctor-performance', reportDoctorPerformanceRouter);
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// ── Data source: lis_test_orders, not the legacy `visits` table ─────────
// The legacy `visits` table is barely-used (3 stale rows total, all months
// old — see reportPatients.js) and, on top of that, its doctor_id is
// stamped with whichever account was logged in when the row was created
// (always "Levi Admin", an admin account), never a real role='doctor' user
// — so this report always showed zero doctor-attributed revenue no matter
// the period. The live clinical workflow's real unit of encounter is a
// `lis_test_orders` row (created per visit via POST /lis/orders — see
// billingResolver.js's getCurrentOpenVisitId, which treats it the same
// way), and verified against live data its `doctor_id` DOES resolve to the
// real doctor accounts (Apedo Acuil, Mutasa Matembe). This report uses
// lis_test_orders for doctor attribution instead.
//
// `lis_test_orders.clinic_id` is a UUID column that is NULL/inconsistent on
// most live rows (a different, largely-unused scoping scheme) — matching
// the documented decision in reportPatients.js / reportLaboratory.js, we do
// NOT filter LIS-side queries by clinic, to avoid silently dropping
// legitimate records against sparse data.
//
// ── The hard part: revenue attribution ──────────────────────────────────
// `patient_bills` has no `visit_id` or `doctor_id` column (verified via
// DESCRIBE) — there is no direct FK from a bill to the visit/doctor that
// generated it. Per the same honesty pattern established in
// reportLaboratory.js's cash-value section, we attribute revenue using a
// best-effort, clearly-disclosed heuristic instead of presenting a shaky
// number as fact:
//
//   1. From each bill's `services` JSON, identify line items that match the
//      `services` catalog's category = 'Consultation' entries (currently
//      just "GP - Consultation"), using the same normalize-and-match
//      pattern as reportLaboratory.js (lowercase, strip "(...)" suffixes,
//      strip punctuation, collapse whitespace).
//   2. Sum each bill's matched Consultation line items into a per-bill
//      billed/collected total (collected uses the identical per-item
//      paid-flag → bill-status → prorated-ratio priority order as
//      reportLaboratory.js).
//   3. Attribute that bill's Consultation total to the doctor(s) who saw
//      the SAME patient (patient_bills.patient_id == lis_test_orders.
//      participant_id — both key against lis_participants.id, verified
//      against live data) on the SAME calendar day as the bill, restricted
//      to doctor-attributed orders only (see above). If more than one
//      distinct doctor saw that patient that day, the bill's Consultation
//      amount is split evenly between them (rare edge case — flagged via
//      ambiguousBillCount). If no doctor-attributed visit matches, the
//      amount is NOT attributed to any doctor — it is reported separately
//      as `revenueAttribution.unattributedConsultationBilled/Collected`
//      rather than silently dropped or force-fit.
//
// This is included (not omitted) because the mechanism is fully disclosed
// in the API response (`revenueAttribution.note` + collectionMethod +
// unattributed figures). Callers should treat `revenueAttributed` as an
// approximate, same-day-billing estimate — not a verified per-doctor
// collections figure.
//
// ── Clinic scoping ──────────────────────────────────────────────────────
// `patient_bills.clinic_id` is a reliable int column — filtered when a
// clinic is resolved. `lis_test_orders.clinic_id` is not (see above).

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const AccountingService = require('../services/AccountingService');

// ── Helpers ──────────────────────────────────────────────────────────────

/** YYYY-MM-DD for `daysAgo` days before today (local server date). */
function isoDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

/** Validates a YYYY-MM-DD string; returns null if invalid/missing. */
function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** lowercase, strip "(...)" suffixes, strip punctuation, collapse whitespace */
function normalizeName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort numeric coercion, defaulting to 0. */
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2dp, avoiding floating point noise. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// A consultation line item's REAL price is not always what its own unitPrice/totalPrice
// says — insurance/credit-priced items use one of two representations elsewhere in this
// app (BillDetails.tsx / DispensingWorkflow.tsx's re-pricing logic), and both of them
// left the previous version of this report attributing $0 to insurance visits entirely:
//   1. The whole bill is scheme-mode (bill.scheme_id set) — unitPrice/totalPrice ARE the
//      real charge, just denominated in the scheme's own currency (bill.bill_currency),
//      which is frequently not the base currency (e.g. a $10 consultation billed as
//      "totalPrice: 10" while the SSP-facing cash total is a completely separate number).
//   2. An individually-insured item on an otherwise-cash bill — unitPrice/totalPrice are
//      deliberately zeroed (nothing owed in SSP for it) and the real price is stashed in
//      schemePrice/schemeCurrency instead.
// Resolves either representation to a base-currency (SSP) amount, tagged as insurance so
// callers can report it separately from genuine cash revenue instead of folding it in
// (which would misrepresent the currency) or dropping it (which is the bug this fixes).
async function resolveItemAmount(item, bill, rateCache, clinicId) {
  const qty = num(item.quantity) || 1;
  const cashAmount =
    item.totalPrice != null ? num(item.totalPrice)
    : item.total_price != null ? num(item.total_price)
    : num(item.unitPrice ?? item.unit_price ?? item.price) * qty;

  const isSchemeBill = !!bill.schemeId;
  const isIndividuallyInsured = item.schemePrice != null && cashAmount === 0;
  if (!isSchemeBill && !isIndividuallyInsured) {
    return { amount: cashAmount, isInsurance: false };
  }

  const rawAmount = isSchemeBill ? cashAmount : num(item.schemePrice);
  const currency = (isSchemeBill ? bill.billCurrency : item.schemeCurrency) || 'SSP';
  if (currency === 'SSP' || rawAmount === 0) {
    return { amount: rawAmount, isInsurance: true };
  }

  const asOfDate = bill.billDay || new Date();
  const cacheKey = `${currency}|${asOfDate}`;
  let rate = rateCache.get(cacheKey);
  if (rate === undefined) {
    try {
      rate = await AccountingService.getExchangeRate(clinicId, currency, 'SSP', asOfDate);
    } catch {
      rate = null;
    }
    rateCache.set(cacheKey, rate);
  }
  const amount = rate != null ? AccountingService.convertAmount(rawAmount, rate) : rawAmount;
  return { amount, isInsurance: true, unconverted: rate == null };
}

// ── GET / ────────────────────────────────────────────────────────────────
// Query params:
//   dateFrom, dateTo  — YYYY-MM-DD, default to the last 30 days
//   clinic_id         — defaults to the authenticated user's clinic
router.get('/', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;

    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { clinicId, fromTs, toTs };

    // ── 1. Visits (lis_test_orders) in period whose doctor_id resolves to an
    //      actual role='doctor' user. This is the ONLY set of visits this
    //      report credits to a doctor — see header note.
    const visitRows = await sequelize.query(
      `SELECT o.id AS "visitId", o.doctor_id AS "doctorId", u.display_name AS "doctorName",
              o.participant_id AS "patientId", DATE(o.created_at) AS "visitDay"
       FROM lis_test_orders o
       INNER JOIN users u ON u.id = o.doctor_id AND u.role = 'doctor'
       WHERE o.created_at BETWEEN :fromTs AND :toTs
       ORDER BY o.created_at`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 2. Total visits in period (any doctor_id/none), for the
    //      dataQuality disclosure — how many were excluded and why.
    const [allVisitsRow] = await sequelize.query(
      `SELECT COUNT(*) AS "totalVisits"
       FROM lis_test_orders
       WHERE created_at BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const totalVisitsAllStaff = parseInt(allVisitsRow?.totalVisits, 10) || 0;

    // ── 3. Per-doctor aggregation (patients seen, visit count) + a
    //      (patientId, day) -> Set(doctorId) lookup used for revenue
    //      attribution below.
    const doctorMap = new Map(); // doctorId -> aggregate row
    const dayLookup = new Map(); // `${patientId}|${visitDay}` -> Set(doctorId)

    for (const v of visitRows) {
      let d = doctorMap.get(v.doctorId);
      if (!d) {
        d = {
          doctorId: v.doctorId,
          doctorName: v.doctorName,
          visits: 0,
          patients: new Set(),
          cashBilled: 0,
          cashCollected: 0,
          insuranceBilled: 0,
          insuranceCollected: 0,
        };
        doctorMap.set(v.doctorId, d);
      }
      d.visits += 1;
      d.patients.add(v.patientId);

      const key = `${v.patientId}|${v.visitDay}`;
      if (!dayLookup.has(key)) dayLookup.set(key, new Set());
      dayLookup.get(key).add(v.doctorId);
    }

    // ── 4. Consultation-category catalog (currently just "GP - Consultation").
    const consultationServices = await sequelize.query(
      `SELECT service_name AS "serviceName" FROM services WHERE category = 'Consultation'`,
      { type: QueryTypes.SELECT }
    );
    const consultationNames = new Set(
      consultationServices.map(s => normalizeName(s.serviceName)).filter(Boolean)
    );

    // ── 5. Bills in period (clinic-scoped) — parse services JSON in JS,
    //      same reasoning as reportLaboratory.js (mysql2/Sequelize returns
    //      JSON columns as raw strings via raw sequelize.query).
    const bills = await sequelize.query(
      `SELECT id, patient_id AS "patientId", total_amount AS "totalAmount", paid_amount AS "paidAmount",
              status, DATE(bill_date) AS "billDay", services,
              scheme_id AS "schemeId", bill_currency AS "billCurrency"
       FROM patient_bills
       WHERE clinic_id = :clinicId AND bill_date BETWEEN :fromTs AND :toTs`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    let totalConsultationBilled = 0;
    let totalConsultationCollected = 0;
    let totalCashConsultationBilled = 0;
    let totalInsuranceConsultationBilled = 0;
    let unattributedBilled = 0;
    let unattributedCollected = 0;
    let ambiguousBillCount = 0;
    let explicitPaidFlagItems = 0;
    let estimatedFromBillStatusItems = 0;
    const rateCache = new Map();

    for (const bill of bills) {
      let items = [];
      try {
        const parsed = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        continue; // malformed JSON on this bill — skip it, don't crash the report
      }

      const billTotal = num(bill.totalAmount);
      const billPaid = num(bill.paidAmount);
      const billPaidRatio = billTotal > 0 ? Math.min(billPaid / billTotal, 1) : 0;

      let billConsultCashBilled = 0, billConsultCashCollected = 0;
      let billConsultInsuranceBilled = 0, billConsultInsuranceCollected = 0;

      for (const item of items) {
        const rawName = item?.serviceName || item?.name || item?.service_name;
        const n = normalizeName(rawName);
        if (!n || !consultationNames.has(n)) continue;

        const { amount: itemTotal, isInsurance } = await resolveItemAmount(item, bill, rateCache, clinicId);

        let collected;
        if (typeof item.paid === 'boolean') {
          collected = item.paid ? itemTotal : 0;
          explicitPaidFlagItems++;
        } else if (item.status === 'paid') {
          collected = itemTotal;
          explicitPaidFlagItems++;
        } else if (bill.status === 'paid') {
          collected = itemTotal;
          estimatedFromBillStatusItems++;
        } else if (bill.status === 'pending') {
          collected = 0;
          estimatedFromBillStatusItems++;
        } else {
          collected = itemTotal * billPaidRatio;
          estimatedFromBillStatusItems++;
        }

        if (isInsurance) {
          billConsultInsuranceBilled += itemTotal;
          billConsultInsuranceCollected += collected;
        } else {
          billConsultCashBilled += itemTotal;
          billConsultCashCollected += collected;
        }
      }

      const billConsultBilled = billConsultCashBilled + billConsultInsuranceBilled;
      const billConsultCollected = billConsultCashCollected + billConsultInsuranceCollected;
      if (billConsultBilled <= 0) continue; // no Consultation line items on this bill

      totalConsultationBilled += billConsultBilled;
      totalConsultationCollected += billConsultCollected;
      totalCashConsultationBilled += billConsultCashBilled;
      totalInsuranceConsultationBilled += billConsultInsuranceBilled;

      const key = `${bill.patientId}|${bill.billDay}`;
      const doctorSet = dayLookup.get(key);

      if (!doctorSet || doctorSet.size === 0) {
        unattributedBilled += billConsultBilled;
        unattributedCollected += billConsultCollected;
        continue;
      }

      if (doctorSet.size > 1) ambiguousBillCount++;

      const share = 1 / doctorSet.size;
      for (const docId of doctorSet) {
        const d = doctorMap.get(docId);
        if (!d) continue;
        d.cashBilled += billConsultCashBilled * share;
        d.cashCollected += billConsultCashCollected * share;
        d.insuranceBilled += billConsultInsuranceBilled * share;
        d.insuranceCollected += billConsultInsuranceCollected * share;
      }
    }

    // ── 6. Shape per-doctor output rows.
    const doctors = Array.from(doctorMap.values())
      .map(d => {
        const totalBilled = d.cashBilled + d.insuranceBilled;
        const totalCollected = d.cashCollected + d.insuranceCollected;
        return {
          doctorId: d.doctorId,
          doctorName: d.doctorName,
          patientsSeen: d.patients.size,
          visits: d.visits,
          revenueBilled: round2(totalBilled),
          revenueCollected: round2(totalCollected),
          cashRevenueBilled: round2(d.cashBilled),
          cashRevenueCollected: round2(d.cashCollected),
          insuranceRevenueBilled: round2(d.insuranceBilled),
          insuranceRevenueCollected: round2(d.insuranceCollected),
          avgRevenuePerVisit: d.visits > 0 ? round2(totalBilled / d.visits) : 0,
        };
      })
      .sort((a, b) => b.visits - a.visits || b.revenueBilled - a.revenueBilled);

    const totalDoctorsActive = doctors.length;
    const totalPatientsSeen = new Set(visitRows.map(v => v.patientId)).size;
    const totalVisits = visitRows.length;
    const totalRevenueAttributed = round2(doctors.reduce((sum, d) => sum + d.revenueBilled, 0));

    const unattributedVisits = totalVisitsAllStaff - totalVisits;

    res.json({
      period: { dateFrom, dateTo },
      clinicId,
      summary: {
        totalDoctorsActive,
        totalPatientsSeen,
        totalVisits,
        totalRevenueAttributed,
      },
      doctors,
      dataQuality: {
        totalVisitsAllStaff,
        doctorAttributedVisits: totalVisits,
        unattributedVisits,
        note:
          unattributedVisits > 0
            ? `${unattributedVisits} of ${totalVisitsAllStaff} visit(s) in this period have a doctor_id that does not resolve to a user with role='doctor' (e.g. logged under a reception/admin account) and are excluded from doctor-level figures below.`
            : null,
      },
      revenueAttribution: {
        totalConsultationBilled: round2(totalConsultationBilled),
        totalConsultationCollected: round2(totalConsultationCollected),
        cashConsultationBilled: round2(totalCashConsultationBilled),
        insuranceConsultationBilled: round2(totalInsuranceConsultationBilled),
        unattributedConsultationBilled: round2(unattributedBilled),
        unattributedConsultationCollected: round2(unattributedCollected),
        ambiguousBillCount,
        collectionMethod: {
          exactItems: explicitPaidFlagItems,
          estimatedItems: estimatedFromBillStatusItems,
        },
        note:
          "Revenue is approximate, based on same-day consultation billing: a bill's Consultation-category line item(s) are attributed to the doctor who saw that same patient on the same calendar day, because patient_bills has no direct visit_id or doctor_id column. If a patient saw more than one doctor the same day, the amount is split evenly between them (see ambiguousBillCount). Bills that don't match any doctor-attributed visit are excluded from doctor totals and reported separately as unattributed. Insurance/credit-priced consultations are converted to SSP using the exchange rate on the bill's date and reported separately from cash revenue (see each doctor's cashRevenueBilled vs insuranceRevenueBilled).",
      },
    });
  } catch (err) {
    console.error('Doctor Performance report error:', err);
    res.status(500).json({ error: 'Failed to generate doctor performance report' });
  }
});

module.exports = router;

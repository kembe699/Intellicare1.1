// ─── Laboratory Report (v2) ────────────────────────────────────────────────
//
// Rewritten as a self-contained v2 report. Part of the same effort as reportPatients.js:
// the old src/server/routes/reports.js was full of Postgres-only SQL that
// silently returns zeros on MySQL. This router is self-contained, plain
// MySQL SQL only, and does not touch reports.js or index.js — it is meant
// to be mounted separately, e.g.:
//
//   const reportLaboratoryRouter = require('./routes/reportLaboratory');
//   app.use('/api/reports-v2/laboratory', reportLaboratoryRouter);
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// ── Data model recap ────────────────────────────────────────────────────
// The LIS (lab) module has its own tables, unrelated by foreign key to the
// generic billing tables:
//   lis_participants  — one row per lab patient
//   lis_test_orders   — one row per order (participant_id, clinic_id [UUID,
//                       sparsely populated — see clinic-scoping note below])
//   lis_specimens     — one row per test within an order (test_code,
//                       test_name, status, created_at ≈ when the test was
//                       ordered/registered)
//   lis_results       — one or more analyte rows per specimen (not needed
//                       for this report — volume/status live on the specimen)
// "By test" and "by patient volume" are computed straight from
// lis_specimens/lis_test_orders/lis_participants — clean, no ambiguity.
//
// ── The hard part: cash value ───────────────────────────────────────────
// Lab tests are billed through the generic `patient_bills.services` JSON
// column, NOT a dedicated lab-billing table, and there is NO foreign key
// from a bill line item back to a lis_specimens row. Line items are also
// inconsistently shaped: some are tagged `department: "Laboratory"` /
// `type: "Lab Test"`, most are not; field names vary (serviceName/name,
// totalPrice/total_price, unitPrice/unit_price/price).
//
// Verified against live data (see investigation notes below) that neither
// tag nor field name can be trusted alone. Instead we identify a bill line
// item as lab-related by matching its (normalized) name against the UNION
// of two catalogs:
//   1. `lab_tests.test_name` / `lab_tests.test_code` — the LIS test catalog.
//   2. `services.service_name` WHERE category = 'Diagnostic' — the generic
//      billing catalog's lab-tagged entries.
// These two catalogs are NOT reliably linked (lab_tests.service_id is NULL
// for most rows in live data — e.g. "Liver Function Test (LFT)" in
// lab_tests has no service_id, while a separate, unlinked "Liver Profile"
// row exists in `services` with category Diagnostic). So a bill item can
// match one catalog, the other, both, or neither — we take the union.
// Normalization = lowercase, strip parenthetical suffixes like "(LFT)",
// strip punctuation, collapse whitespace. This was verified by hand against
// every line item in the 9 live patient_bills rows: it correctly captures
// "Complete Blood Count", "Liver Profile", "Liver Function Test (LFT)",
// "Lipid Profile"/"Lipid profile" as lab items, and correctly excludes
// "GP - Consultation", "Arthegate" (a drug), and bare "Consultation".
//
// When a match resolves to a `lab_tests` row, we key it by test_code so its
// cash value can be merged into the same "by test" row as its LIS-side
// volume. When a match only resolves via the `services` Diagnostic catalog
// (no lab_tests linkage — e.g. "Liver Profile" in the live data), there is
// no test_code to merge against, so it is reported as its own row with
// volume = null ("not tracked in LIS") rather than guessing which LIS test
// it corresponds to.
//
// ── Billed vs. Collected ────────────────────────────────────────────────
// "Billed" = the line item's total price, unconditionally, for bills dated
// in the period.
// "Collected" is an ESTIMATE, in this priority order:
//   1. If the line item itself carries `paid: true/false` (per-item payment
//      tracking added earlier), use that — exact.
//   2. Otherwise, fall back to the bill's overall status: status='paid' →
//      full item amount collected; status='pending' → 0 collected;
//      otherwise (partial/overdue/active) → the item amount is prorated by
//      the bill's paid_amount/total_amount ratio. This is a genuine
//      estimate, not a measurement — most live bills have no per-item paid
//      flag, so most "Collected" figures for lab items are prorated
//      estimates, not exact collections. The API response reports how many
//      matched items fell into each method (`collectionMethod`) so the
//      frontend/caller can see how much of the "Collected" figure is exact
//      vs. estimated, rather than silently presenting an estimate as fact.
//
// ── Clinic scoping ──────────────────────────────────────────────────────
// `patient_bills.clinic_id` is a reliable int column — filtered when a
// clinic is resolved. `lis_test_orders.clinic_id` is a UUID column that is
// NULL on most live rows (a different, largely-unused scoping scheme) —
// matching the documented decision in reportPatients.js for lis_participants,
// we do NOT filter LIS-side queries by clinic, to avoid silently dropping
// legitimate records against sparse data.

const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/authorize');
// Every reports-v2 route carries financial/clinical data and was previously
// gated only on the frontend's requiredPrivilege="pages.reports.view" check
// (src/App.tsx) -- any authenticated user of any role could call these
// endpoints directly (devtools/Postman/a future UI surface) and get the
// data with no server-side check at all. Mirrors reportDhis2.js, the one
// report file that already did this correctly.
router.use(authorize('pages.reports.view'));

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

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

// Non-admin users only see rows from their own branch; admins see everything.
// Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't
// mix with the named :params this file uses in the same query) — same
// convention as branchScope() in routes/hr.js.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
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
    const branchSqlSp = branchScope(req, repl, 'sp');

    // ── 1. By-test volume from the LIS side (lis_specimens.created_at =
    //      when the test was ordered/registered). Not clinic-filtered —
    //      see header note. Branch-filtered via lis_specimens.branch_id.
    const volumeRows = await sequelize.query(
      `SELECT sp.test_code AS "testCode", MIN(sp.test_name) AS "testName", COUNT(*) AS volume
       FROM lis_specimens sp
       INNER JOIN lis_test_orders o ON o.id = sp.order_id
       WHERE sp.created_at BETWEEN :fromTs AND :toTs ${branchSqlSp}
       GROUP BY sp.test_code
       ORDER BY volume DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 2. Patient volume: distinct participants + total tests performed.
    const [patientVolumeRow] = await sequelize.query(
      `SELECT COUNT(DISTINCT o.participant_id) AS "distinctPatients", COUNT(*) AS "totalTests"
       FROM lis_specimens sp
       INNER JOIN lis_test_orders o ON o.id = sp.order_id
       WHERE sp.created_at BETWEEN :fromTs AND :toTs ${branchSqlSp}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 3. Turnaround / status breakdown (bonus).
    const statusRows = await sequelize.query(
      `SELECT sp.status AS status, COUNT(*) AS count
       FROM lis_specimens sp
       INNER JOIN lis_test_orders o ON o.id = sp.order_id
       WHERE sp.created_at BETWEEN :fromTs AND :toTs ${branchSqlSp}
       GROUP BY sp.status
       ORDER BY count DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // ── 4. Catalogs used to identify lab-related bill line items.
    const labTests = await sequelize.query(
      `SELECT test_code AS "testCode", test_name AS "testName" FROM lab_tests`,
      { type: QueryTypes.SELECT }
    );
    const diagnosticServices = await sequelize.query(
      `SELECT id, service_name AS "serviceName" FROM services WHERE category = 'Diagnostic'`,
      { type: QueryTypes.SELECT }
    );

    const nameToTest = new Map(); // normalized name -> { testCode, testName }
    for (const t of labTests) {
      const n1 = normalizeName(t.testName);
      const n2 = normalizeName(t.testCode);
      if (n1) nameToTest.set(n1, { testCode: t.testCode, testName: t.testName });
      if (n2) nameToTest.set(n2, { testCode: t.testCode, testName: t.testName });
    }
    const nameToService = new Map(); // normalized name -> { serviceName } (only for names not already a lab_tests match)
    for (const s of diagnosticServices) {
      const n = normalizeName(s.serviceName);
      if (n && !nameToTest.has(n)) nameToService.set(n, { serviceName: s.serviceName });
    }

    function classifyLineItem(rawName) {
      const n = normalizeName(rawName);
      if (!n) return null;
      if (nameToTest.has(n)) {
        const t = nameToTest.get(n);
        return { key: `code:${t.testCode}`, testCode: t.testCode, label: t.testName };
      }
      if (nameToService.has(n)) {
        const s = nameToService.get(n);
        return { key: `svc:${n}`, testCode: null, label: s.serviceName };
      }
      return null;
    }

    // ── 5. Pull raw bills in the period (clinic-scoped) and parse the JSON
    //      `services` line-item array in JS (mysql2/Sequelize returns JSON
    //      columns as raw strings via raw sequelize.query, not pre-parsed —
    //      verified against this connection).
    const branchSqlNoAlias = repl.branchId ? ' AND branch_id = :branchId' : '';
    const bills = await sequelize.query(
      `SELECT id, total_amount AS "totalAmount", paid_amount AS "paidAmount", status, bill_date AS "billDate", services
       FROM patient_bills
       WHERE clinic_id = :clinicId AND bill_date BETWEEN :fromTs AND :toTs ${branchSqlNoAlias}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const cashByKey = new Map(); // key -> { label, testCode, totalBilled, totalCollected }
    let explicitPaidFlagItems = 0;
    let estimatedFromBillStatusItems = 0;

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

      for (const item of items) {
        const rawName = item?.serviceName || item?.name || item?.service_name;
        const match = classifyLineItem(rawName);
        if (!match) continue;

        const qty = num(item.quantity) || 1;
        const itemTotal =
          item.totalPrice != null ? num(item.totalPrice)
          : item.total_price != null ? num(item.total_price)
          : num(item.unitPrice ?? item.unit_price ?? item.price) * qty;

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

        const row = cashByKey.get(match.key) || {
          label: match.label,
          testCode: match.testCode,
          totalBilled: 0,
          totalCollected: 0,
        };
        row.totalBilled += itemTotal;
        row.totalCollected += collected;
        cashByKey.set(match.key, row);
      }
    }

    // ── 6. Merge LIS-side volume with bill-side cash into one "by test" table.
    const volumeByCode = new Map(volumeRows.map(r => [r.testCode, r]));
    const byTestMap = new Map(); // key -> row

    for (const r of volumeRows) {
      byTestMap.set(`code:${r.testCode}`, {
        testCode: r.testCode,
        testName: r.testName,
        volume: parseInt(r.volume, 10) || 0,
        totalBilled: 0,
        totalCollected: 0,
      });
    }
    for (const [key, cash] of cashByKey.entries()) {
      const existing = byTestMap.get(key);
      if (existing) {
        existing.totalBilled = cash.totalBilled;
        existing.totalCollected = cash.totalCollected;
      } else {
        byTestMap.set(key, {
          testCode: cash.testCode,
          testName: cash.label,
          volume: null, // billed under this name but no matching LIS specimen in period — not tracked in LIS
          totalBilled: cash.totalBilled,
          totalCollected: cash.totalCollected,
        });
      }
    }

    const byTest = Array.from(byTestMap.values()).sort((a, b) => b.totalBilled - a.totalBilled || b.volume - a.volume);

    const totalBilled = byTest.reduce((sum, r) => sum + r.totalBilled, 0);
    const totalCollected = byTest.reduce((sum, r) => sum + r.totalCollected, 0);

    res.json({
      period: { dateFrom, dateTo },
      clinicId,
      patientVolume: {
        distinctPatients: parseInt(patientVolumeRow?.distinctPatients, 10) || 0,
        totalTests: parseInt(patientVolumeRow?.totalTests, 10) || 0,
      },
      cashSummary: {
        totalBilled,
        totalCollected,
        collectionMethod: {
          exactItems: explicitPaidFlagItems,
          estimatedItems: estimatedFromBillStatusItems,
          note:
            estimatedFromBillStatusItems > 0
              ? 'Some "Collected" figures are estimated by prorating bill-level payment status/ratio to line items, because most bills do not carry a per-item paid flag. See collectionMethod counts.'
              : 'All matched line items carried an explicit per-item paid flag or status.',
        },
      },
      byTest,
      statusBreakdown: statusRows.map(r => ({ status: r.status, count: parseInt(r.count, 10) || 0 })),
    });
  } catch (err) {
    console.error('Laboratory report error:', err);
    res.status(500).json({ error: 'Failed to generate laboratory report' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const formDefinition = require('../config/dhis2FormDefinition');
const ExcelJS = require('exceljs');

// ═══════════════════════════════════════════════════════════════════════
// DHIS2 MONTHLY HMIS FACILITY REPORT
//
// Two things confirmed by direct code search before writing this file (not
// assumed):
//
// 1. WHERE OUTPATIENT DATA REALLY LIVES. The older `visits`/`patients`-based
//    clinical flow (clinical.js's POST /visits -> Visit.create(),
//    routes/visits.js) has ZERO reachable frontend caller — no page calls
//    /api/visits or /clinical/visits to create one, and `grep -rn "INSERT
//    INTO visits"` across every route file is empty. It's dead code, same
//    situation as the already-removed /laboratory page. The LIVE outpatient
//    system — registration, queueing, triage, ordering, visit summary,
//    prescriptions, radiology — is lis_participants (patient identity) +
//    lis_test_orders (one row per visit) + lis_test_orders.clinical_notes
//    (free text; a doctor's diagnosis is embedded as a literal repeated
//    "Diagnosis: <text>" substring — see LISTestOrders.tsx's own
//    getDiagnosesFromNotes/extractDiagnosisFromNotes, mirrored here in
//    extractDiagnosisSegments()). Sections A/B below read exclusively from
//    this live path; `visits` is never touched, so there's no risk of
//    double-counting a patient against stale legacy rows nothing writes to
//    anymore. Inpatient (Section F) is a genuinely separate identity space
//    — `patients` + `inpatient_admissions` — which is expected, not a bug:
//    a MoH HMIS form already reports OPD and IPD as separate indicators.
//
// 2. TENANT ISOLATION. clinicalDiagnoses.js's comment about a past
//    cross-tenant leak was about `require('../config/database')` — a raw,
//    non-tenant-aware connection. `require('../models')` (used below,
//    matching reportOccupancy.js) is different: models/index.js wraps every
//    export in a Proxy resolved via tenantContext.js's AsyncLocalStorage,
//    populated by middleware/auth.js's `tenantContext.run(tenantConnection,
//    () => next())` — the SAME tenantConnection object also assigned to
//    req.models. So `require('../models').sequelize` and
//    `req.models.sequelize` are equivalent inside a request. Only
//    `require('../config/database')` (bypassing the proxy) is unsafe. This
//    file uses the proxy form, same as every other reports-v2 route.
// ═══════════════════════════════════════════════════════════════════════

// Same inline branch-scoping convention as reportOccupancy.js/hr.js — named
// :params mixed with other named params in the same query, which
// branchFilter.js's own getBranchConditionSQL (positional `?`) can't do.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// ── Date/period helpers ──────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM' -> { year, month (1-12), periodStart 'YYYY-MM-01', periodEnd 'YYYY-MM-DD' (last day) }
function getPeriodBounds(period) {
  const [yearStr, monthStr] = String(period).split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('period must be in YYYY-MM format');
  }
  const periodStart = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { year, month, periodStart, periodEnd, daysInMonth: lastDay };
}

// Default period = last full calendar month, as requested.
function defaultPeriod() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function calcAgeYears(dob, asOfDate) {
  if (!dob) return null;
  const birth = new Date(dob);
  const asOf = new Date(asOfDate);
  if (isNaN(birth.getTime()) || isNaN(asOf.getTime())) return null;
  let age = asOf.getFullYear() - birth.getFullYear();
  const m = asOf.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : null;
}

function getAgeBandId(ageYears) {
  if (ageYears == null) return null;
  const band = formDefinition.ageBands.find((b) =>
    (b.maxYears == null || ageYears < b.maxYears) && (b.minYears == null || ageYears >= b.minYears)
  );
  return band ? band.id : null;
}

function getSexBucket(gender) {
  const g = (gender || '').trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'm';
  if (g === 'female' || g === 'f') return 'f';
  return null;
}

// Increments the right column of an { u5m, u5f, ge5m, ge5f, unknown, total }
// row bucket given an age/sex pair — missing DOB or gender always goes to
// "unknown", never guessed into a band, and total always includes it.
function bucketInto(row, ageYears, gender) {
  const ageBandId = getAgeBandId(ageYears);
  const sex = getSexBucket(gender);
  row.total += 1;
  if (ageBandId == null || sex == null) {
    row.unknown += 1;
    return;
  }
  const key = `${ageBandId === 'u5' ? 'u5' : 'ge5'}${sex}`;
  row[key] = (row[key] || 0) + 1;
}

function emptyAgeSexRow() {
  return { u5m: 0, u5f: 0, ge5m: 0, ge5f: 0, unknown: 0, total: 0 };
}

// ── Diagnosis text helpers — mirrors LISTestOrders.tsx's own convention ──

// Every "Diagnosis: X" segment in clinical_notes, in order, de-duped like
// the frontend's getDiagnosesFromNotes.
function extractDiagnosisSegments(notes) {
  if (!notes) return [];
  const all = String(notes).split('Diagnosis:').slice(1).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  return all.filter((d) => {
    const key = d.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Negation words must be ignored on EITHER side of the matched keyword —
// "rule out malaria" (before) and "malaria negative"/"malaria ruled out"
// (after) both must not count as a positive match.
// Clipped to the same clause as the matched keyword (stops at ./,/;/!) —
// free-text clinical notes routinely mention several conditions in one
// segment ("UTI. Also rule out malaria this visit."), and without a clause
// boundary a negation meant for one term (malaria) would incorrectly bleed
// onto an unrelated, earlier term (UTI) just for being within the window.
function isNegatedMatch(text, matchStart, matchEnd, negationWords, windowChars) {
  const clauseBoundary = /[.,;!]/;
  let beforeRaw = text.slice(Math.max(0, matchStart - windowChars), matchStart);
  const lastBoundary = [...beforeRaw].reduce((acc, ch, i) => (clauseBoundary.test(ch) ? i : acc), -1);
  if (lastBoundary !== -1) beforeRaw = beforeRaw.slice(lastBoundary + 1);

  let afterRaw = text.slice(matchEnd, matchEnd + windowChars);
  const boundaryMatch = afterRaw.search(clauseBoundary);
  if (boundaryMatch !== -1) afterRaw = afterRaw.slice(0, boundaryMatch);

  const before = beforeRaw.toLowerCase();
  const after = afterRaw.toLowerCase();
  return negationWords.some((w) => before.includes(w.toLowerCase()) || after.includes(w.toLowerCase()));
}

// Returns the matched row's id, or null if nothing (non-negated) matched.
// ICD-10 codes are checked first (a no-op today — lis_test_orders carries no
// structured diagnosis code field yet — kept so a future structured field
// works without changing this function).
function matchDiagnosisRow(segmentText, rows, negationWords, windowChars, structuredIcd10Code) {
  const lower = segmentText.toLowerCase();
  if (structuredIcd10Code) {
    const byCode = rows.find((r) => (r.icd10 || []).includes(structuredIcd10Code));
    if (byCode) return byCode.id;
  }
  for (const row of rows) {
    if (row.isCatchAll || row.isMeta || row.isMalariaClinicalFallback || row.isTotal) continue;
    for (const kw of row.keywords || []) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx === -1) continue;
      if (isNegatedMatch(lower, idx, idx + kw.length, negationWords, windowChars)) continue;
      return row.id;
    }
  }
  return null;
}

// ── Section computations ─────────────────────────────────────────────────

async function computeAttendanceAndMorbidity(req, clinicId, period) {
  const { periodStart, periodEnd, year } = getPeriodBounds(period);
  const yearStart = `${year}-01-01`;
  const periodStartTs = `${periodStart} 00:00:00`;
  const periodEndTs = `${periodEnd} 23:59:59`;

  // Fetch the whole calendar year up to and including this period so "New"
  // vs "Re-attendance" can be determined even when the reporting month isn't
  // January — a visit's own order_id is all Section B's malaria-confirmation
  // check and the lab join need, so it's carried through.
  const ordersRepl = { clinicId, yearStart, periodEndTs };
  const branchSql = branchScope(req, ordersRepl, 'o');
  const [yearOrders] = await sequelize.query(
    `SELECT o.id AS order_id, o.participant_id, o.created_at, o.clinical_notes,
       p.date_of_birth, p.gender
     FROM lis_test_orders o
     JOIN lis_participants p ON p.id = o.participant_id
     WHERE o.created_at >= :yearStart AND o.created_at <= :periodEndTs ${branchSql}
     ORDER BY o.participant_id ASC, o.created_at ASC`,
    { replacements: ordersRepl }
  );

  const firstOrderIdByParticipant = new Map();
  for (const o of yearOrders) {
    if (!firstOrderIdByParticipant.has(o.participant_id)) firstOrderIdByParticipant.set(o.participant_id, o.order_id);
  }

  const periodOrders = yearOrders.filter((o) => o.created_at >= new Date(periodStartTs) && o.created_at <= new Date(periodEndTs));

  // ── Section A ──
  const sectionA = { new: emptyAgeSexRow(), reattendance: emptyAgeSexRow(), total: emptyAgeSexRow() };
  for (const o of periodOrders) {
    const isNew = firstOrderIdByParticipant.get(o.participant_id) === o.order_id;
    const rowKey = isNew ? 'new' : 'reattendance';
    bucketInto(sectionA[rowKey], calcAgeYears(o.date_of_birth, o.created_at), o.gender);
    bucketInto(sectionA.total, calcAgeYears(o.date_of_birth, o.created_at), o.gender);
  }

  // ── Malaria confirmation lookup (shared with Section C) ──
  const orderIds = periodOrders.map((o) => o.order_id);
  const specimenRows = orderIds.length > 0 ? await fetchApprovedSpecimenResults(req, orderIds) : [];
  const confirmedMalariaOrderIds = new Set();
  const bSection = formDefinition.sections.B;
  const malariaRow = bSection.rows.find((r) => r.id === 'malaria_confirmed');
  const confirmedByLabRowIds = new Set(malariaRow?.confirmedByLabRowIds || []);
  for (const spec of specimenRows) {
    const labRowId = matchLabTestRow(spec.test_name, spec.test_code, formDefinition.sections.C.rows);
    if (labRowId && confirmedByLabRowIds.has(labRowId) && isPositiveResult(spec.approved_values, formDefinition.sections.C.rows.find((r) => r.id === labRowId))) {
      confirmedMalariaOrderIds.add(spec.order_id);
    }
  }

  // ── Section B ──
  const bRows = {};
  for (const row of bSection.rows) {
    if (row.isTotal) continue;
    bRows[row.id] = emptyAgeSexRow();
  }
  let noDiagnosisCount = 0;
  const negationWords = bSection.negationWords || formDefinition.negationWords;
  const negationWindow = bSection.negationWindowChars || formDefinition.negationWindowChars;
  const matchableRows = bSection.rows.filter((r) => !r.isTotal && !r.isMeta && !r.isMalariaClinicalFallback);

  for (const o of periodOrders) {
    const segments = extractDiagnosisSegments(o.clinical_notes);
    if (segments.length === 0) {
      noDiagnosisCount += 1;
      continue;
    }
    const age = calcAgeYears(o.date_of_birth, o.created_at);
    for (const seg of segments) {
      let rowId = matchDiagnosisRow(seg, matchableRows, negationWords, negationWindow, null) || 'other';
      if (rowId === 'malaria_confirmed' && !confirmedMalariaOrderIds.has(o.order_id)) {
        rowId = malariaRow.malariaClinicalFallbackRowId || 'malaria_clinical';
      }
      if (!bRows[rowId]) bRows[rowId] = emptyAgeSexRow();
      bucketInto(bRows[rowId], age, o.gender);
    }
  }
  const bTotal = emptyAgeSexRow();
  for (const key of Object.keys(bRows)) {
    for (const col of ['u5m', 'u5f', 'ge5m', 'ge5f', 'unknown', 'total']) bTotal[col] += bRows[key][col];
  }
  bRows.total = bTotal;

  // Visits with >=1 diagnosis segment — used by the "morbidity should not
  // exceed attendance" warning (not "B total <= new attendance", since one
  // visit can carry several diagnoses and re-attendances get diagnosed too).
  const visitsWithDiagnosis = periodOrders.length - noDiagnosisCount;

  return {
    sectionA,
    sectionB: bRows,
    diagnosisReview: {
      noDiagnosisCount,
      visitsWithDiagnosis,
      totalAttendance: sectionA.total.total,
      warningText: bSection.warningText,
    },
  };
}

// One row per specimen that has at least one APPROVED result — grouping by
// specimen (not by lis_results analyte row) so a specimen with several
// analytes (confirmed live: a single BFFM specimen has separate "BFFM" /
// "SPECIES" / "Density" analyte rows) counts once, not three times.
async function fetchApprovedSpecimenResults(req, orderIds) {
  const replacements = { orderIds };
  const branchSql = branchScope(req, replacements, 'o');
  const [rows] = await sequelize.query(
    `SELECT s.id AS specimen_id, s.test_code, s.test_name, s.order_id,
       array_agg(DISTINCT lower(r.value)) AS approved_values
     FROM lis_specimens s
     JOIN lis_test_orders o ON o.id = s.order_id
     JOIN lis_results r ON r.specimen_id = s.id AND r.status = 'approved'
     WHERE s.order_id IN (:orderIds) ${branchSql}
     GROUP BY s.id, s.test_code, s.test_name, s.order_id`,
    { replacements }
  );
  return rows;
}

function matchLabTestRow(testName, testCode, labRows) {
  const hay = `${testName || ''} ${testCode || ''}`.toLowerCase();
  for (const row of labRows) {
    if ((row.testNameKeywords || []).some((kw) => hay.includes(kw.toLowerCase()))) return row.id;
  }
  return null;
}

function isPositiveResult(approvedValues, labRow) {
  if (!labRow || !approvedValues) return false;
  const positives = (labRow.positiveValues || []).map((v) => v.toLowerCase());
  return (approvedValues || []).some((v) => positives.some((p) => (v || '').includes(p)));
}

async function computeLaboratory(req, clinicId, period) {
  const { periodStart, periodEnd } = getPeriodBounds(period);
  const replacements = { clinicId, periodStart: `${periodStart} 00:00:00`, periodEnd: `${periodEnd} 23:59:59` };
  const branchSql = branchScope(req, replacements, 'o');
  const [specimenRows] = await sequelize.query(
    `SELECT s.id AS specimen_id, s.test_code, s.test_name,
       array_agg(DISTINCT lower(r.value)) AS approved_values
     FROM lis_specimens s
     JOIN lis_test_orders o ON o.id = s.order_id
     JOIN lis_results r ON r.specimen_id = s.id AND r.status = 'approved'
     WHERE o.created_at >= :periodStart AND o.created_at <= :periodEnd ${branchSql}
     GROUP BY s.id, s.test_code, s.test_name`,
    { replacements }
  );

  const cRows = {};
  for (const row of formDefinition.sections.C.rows) {
    cRows[row.id] = { tested: 0, positive: 0, pct_positive: 0 };
  }
  for (const spec of specimenRows) {
    const rowId = matchLabTestRow(spec.test_name, spec.test_code, formDefinition.sections.C.rows);
    if (!rowId) continue;
    cRows[rowId].tested += 1;
    if (isPositiveResult(spec.approved_values, formDefinition.sections.C.rows.find((r) => r.id === rowId))) {
      cRows[rowId].positive += 1;
    }
  }
  for (const rowId of Object.keys(cRows)) {
    const r = cRows[rowId];
    r.pct_positive = r.tested > 0 ? Number(((r.positive / r.tested) * 100).toFixed(1)) : 0;
  }
  return cRows;
}

async function computeInpatient(req, clinicId, period) {
  const { periodStart, periodEnd } = getPeriodBounds(period);
  const periodStartTs = `${periodStart} 00:00:00`;
  const periodEndTs = `${periodEnd} 23:59:59`;

  const admRepl = { clinicId, periodStartTs, periodEndTs };
  const branchSqlAdm = branchScope(req, admRepl);
  const [[admRow]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM inpatient_admissions
     WHERE clinic_id = :clinicId AND admission_date >= :periodStartTs AND admission_date <= :periodEndTs ${branchSqlAdm}`,
    { replacements: admRepl }
  );

  const dischRepl = { clinicId, periodStartTs, periodEndTs };
  const branchSqlDisch = branchScope(req, dischRepl);
  const [[dischRow]] = await sequelize.query(
    `SELECT
       COUNT(*) AS discharges,
       COUNT(*) FILTER (WHERE discharge_outcome = 'dead') AS deaths,
       COUNT(*) FILTER (WHERE discharge_reason ILIKE '%refer%') AS referred_out
     FROM inpatient_admissions
     WHERE clinic_id = :clinicId AND discharge_date >= :periodStartTs AND discharge_date <= :periodEndTs ${branchSqlDisch}`,
    { replacements: dischRepl }
  );

  // Bed-days: every admission overlapping the month at all, clipped to the
  // month's own boundaries. An admission with no discharge yet is still
  // "in" through the end of the month.
  const bedDaysRepl = { clinicId, periodStartTs, periodEndTs };
  const branchSqlBedDays = branchScope(req, bedDaysRepl);
  const [[bedDaysRow]] = await sequelize.query(
    `SELECT COALESCE(SUM(
       EXTRACT(EPOCH FROM (
         LEAST(COALESCE(discharge_date, :periodEndTs::timestamp), :periodEndTs::timestamp)
         - GREATEST(admission_date, :periodStartTs::timestamp)
       )) / 86400.0
     ), 0) AS bed_days
     FROM inpatient_admissions
     WHERE clinic_id = :clinicId
       AND admission_date <= :periodEndTs
       AND (discharge_date IS NULL OR discharge_date >= :periodStartTs) ${branchSqlBedDays}`,
    { replacements: bedDaysRepl }
  );

  return {
    admissions: Number(admRow?.cnt) || 0,
    discharges: Number(dischRow?.discharges) || 0,
    deaths: Number(dischRow?.deaths) || 0,
    referred_out: Number(dischRow?.referred_out) || 0,
    bed_days: Math.round((Number(bedDaysRow?.bed_days) || 0) * 10) / 10,
  };
}

// Resolves which inventory_items.id backs a given Section G row: an explicit
// dhis2_mappings choice first, otherwise a best-effort keyword guess against
// the item catalogue so the report isn't all-zeros before anyone has
// configured Settings.
async function resolveTracerDrugItemIds(req, clinicId, branchId) {
  const mappingRepl = { branchId: branchId || -1 };
  const [[mappingRow]] = await sequelize.query(
    `SELECT payload FROM dhis2_mappings WHERE mapping_type = 'tracer_drugs' AND COALESCE(branch_id, -1) = :branchId`,
    { replacements: mappingRepl }
  );
  const explicit = mappingRow?.payload || {};

  const [items] = await sequelize.query(`SELECT id, item_name FROM inventory_items WHERE clinic_id = :clinicId AND is_active = true`, { replacements: { clinicId } });

  const resolved = {};
  for (const row of formDefinition.sections.G.defaultItems) {
    if (explicit[row.id]) { resolved[row.id] = explicit[row.id]; continue; }
    const match = items.find((it) => (row.itemNameKeywords || []).some((kw) => (it.item_name || '').toLowerCase().includes(kw.toLowerCase())));
    resolved[row.id] = match ? match.id : null;
  }
  return resolved;
}

async function computeTracerDrugs(req, clinicId, branchId, period) {
  const { periodStart, periodEnd, daysInMonth, year, month } = getPeriodBounds(period);
  const itemIdByRow = await resolveTracerDrugItemIds(req, clinicId, branchId);
  const prevPeriod = month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`;
  const gDef = formDefinition.sections.G;

  const rows = {};
  for (const rowDef of gDef.defaultItems) {
    const itemId = itemIdByRow[rowDef.id];
    if (!itemId) {
      rows[rowDef.id] = { opening: 0, received: 0, used: 0, closing: 0, daysOutOfStock: 0, itemId: null, unmapped: true };
      continue;
    }

    const [[snapshot]] = await sequelize.query(
      `SELECT closing_qty FROM dhis2_stock_snapshots WHERE branch_id = :branchId AND item_id = :itemId AND period = :prevPeriod`,
      { replacements: { branchId: branchId || 0, itemId, prevPeriod } }
    );

    let opening, estimated;
    if (snapshot) {
      opening = Number(snapshot.closing_qty);
      estimated = false;
    } else {
      const [[item]] = await sequelize.query(`SELECT quantity_on_hand FROM inventory_items WHERE id = :itemId`, { replacements: { itemId } });
      opening = Number(item?.quantity_on_hand) || 0;
      estimated = true;
    }

    const txnRepl = { itemId, periodStart, periodEnd, branchId: branchId || 0 };
    const branchSqlTxn = branchScope(req, txnRepl);
    const [txns] = await sequelize.query(
      `SELECT transaction_date, transaction_type, quantity_change
       FROM inventory_transactions
       WHERE item_id = :itemId AND transaction_date >= :periodStart AND transaction_date <= :periodEnd ${branchSqlTxn}
       ORDER BY transaction_date ASC`,
      { replacements: txnRepl }
    );

    let received = 0;
    let used = 0;
    const changeByDay = {};
    for (const t of txns) {
      const change = Number(t.quantity_change) || 0;
      if (gDef.receivedTransactionTypes.includes(t.transaction_type)) received += change;
      if (gDef.usedTransactionTypes.includes(t.transaction_type)) used += Math.abs(change);
      const dayKey = String(t.transaction_date).slice(0, 10);
      changeByDay[dayKey] = (changeByDay[dayKey] || 0) + change;
    }
    const closing = opening + received - used;

    let running = opening;
    let daysOutOfStock = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${year}-${pad2(month)}-${pad2(d)}`;
      running += changeByDay[dayKey] || 0;
      if (running <= 0) daysOutOfStock += 1;
    }

    rows[rowDef.id] = { opening, received, used, closing, daysOutOfStock, itemId, estimated: estimated || undefined };
  }
  return rows;
}

// Upserts each tracer-drug row's (possibly overridden) closing balance as
// next month's opening — called on finalize only.
async function writeStockSnapshots(req, branchId, period, tracerDrugsFinal) {
  for (const [rowId, row] of Object.entries(tracerDrugsFinal || {})) {
    if (!row.itemId) continue;
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO dhis2_stock_snapshots (id, branch_id, item_id, period, closing_qty, estimated)
       VALUES (:id, :branchId, :itemId, :period, :closingQty, false)
       ON CONFLICT (branch_id, item_id, period) DO UPDATE SET closing_qty = EXCLUDED.closing_qty, estimated = false, updated_at = NOW()`,
      { replacements: { id, branchId, itemId: row.itemId, period, closingQty: row.closing || 0 } }
    );
  }
}

// Assembles every section's computed values for a period+branch. Read-only.
async function computeFullReport(req, clinicId, branchId, period) {
  const { sectionA, sectionB, diagnosisReview } = await computeAttendanceAndMorbidity(req, clinicId, period);
  const sectionC = await computeLaboratory(req, clinicId, period);
  const sectionF = await computeInpatient(req, clinicId, period);
  const sectionG = await computeTracerDrugs(req, clinicId, branchId, period);

  const warnings = [];
  if (diagnosisReview.noDiagnosisCount > 0) {
    warnings.push(`${diagnosisReview.noDiagnosisCount} visit(s) have no diagnosis recorded.`);
  }
  if (sectionA.total.unknown > 0) {
    warnings.push(`${sectionA.total.unknown} attendance(s) have unknown age/sex (missing date of birth or gender).`);
  }
  if (diagnosisReview.visitsWithDiagnosis > diagnosisReview.totalAttendance) {
    warnings.push('Visits with at least one recorded diagnosis exceed total attendance — check for duplicate visit records.');
  }
  const malariaConfirmed = sectionB.malaria_confirmed?.total || 0;
  const malariaTestsPositive = (sectionC.malaria_rdt?.positive || 0) + (sectionC.malaria_microscopy?.positive || 0);
  if (Math.abs(malariaConfirmed - malariaTestsPositive) > Math.max(3, malariaTestsPositive * 0.3)) {
    warnings.push(`Malaria (confirmed) (${malariaConfirmed}) is notably different from positive malaria tests (${malariaTestsPositive}) — review before submitting.`);
  }

  return {
    period,
    sections: { A: sectionA, B: sectionB, C: sectionC, F: sectionF, G: sectionG },
    diagnosisReview,
    warnings,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────

router.get('/definition', authorize('reports.dhis2.view'), async (req, res) => {
  res.json(formDefinition);
});

router.get('/compute', authorize('reports.dhis2.view'), async (req, res) => {
  try {
    const period = req.query.period || defaultPeriod();
    const clinicId = req.query.clinic_id || req.user?.clinicId || 1;
    const branchId = req.query.branch_id ? parseInt(req.query.branch_id, 10) : getCreateBranchId(req);
    const result = await computeFullReport(req, clinicId, branchId, period);
    res.json(result);
  } catch (error) {
    console.error('Error computing DHIS2 report:', error);
    res.status(500).json({ error: error.message || 'Failed to compute DHIS2 report' });
  }
});

router.get('/', authorize('reports.dhis2.view'), async (req, res) => {
  try {
    const replacements = {};
    const branchSql = branchScope(req, replacements, 'r');
    let sql = `SELECT r.id, r.branch_id, r.period, r.status, r.created_by, r.finalized_by, r.finalized_at, r.created_at, r.updated_at
               FROM dhis2_monthly_reports r WHERE 1=1 ${branchSql}`;
    if (req.query.branch_id) { sql += ' AND r.branch_id = :qBranchId'; replacements.qBranchId = parseInt(req.query.branch_id, 10); }
    sql += ' ORDER BY period DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing DHIS2 reports:', error);
    res.status(500).json({ error: 'Failed to list DHIS2 reports' });
  }
});

router.get('/:id', authorize('reports.dhis2.view'), async (req, res) => {
  try {
    const replacements = { id: req.params.id };
    const branchSql = branchScope(req, replacements, 'r');
    const [rows] = await sequelize.query(
      `SELECT * FROM dhis2_monthly_reports r WHERE r.id = :id ${branchSql}`,
      { replacements }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching DHIS2 report:', error);
    res.status(500).json({ error: 'Failed to fetch DHIS2 report' });
  }
});

router.post('/', authorize('reports.dhis2.view'), async (req, res) => {
  try {
    const { period, overrides, header, signoff } = req.body;
    if (!period) return res.status(400).json({ error: 'period is required' });

    // A report always belongs to one facility — "All Branches" is
    // view/export only, never a saveable draft.
    const branchId = req.body.branch_id ? parseInt(req.body.branch_id, 10) : getCreateBranchId(req);
    if (!branchId) {
      return res.status(400).json({ error: 'A specific branch is required to save a report — "All Branches" is view/export only.' });
    }

    const clinicId = req.body.clinic_id || req.user?.clinicId || 1;
    const computed = await computeFullReport(req, clinicId, branchId, period);

    const [[existing]] = await sequelize.query(
      `SELECT id, status FROM dhis2_monthly_reports WHERE branch_id = :branchId AND period = :period`,
      { replacements: { branchId, period } }
    );
    if (existing && existing.status === 'final') {
      return res.status(409).json({ error: 'This report is finalized. An admin must reopen it before it can be edited.' });
    }

    const id = existing?.id || uuidv4();
    if (existing) {
      await sequelize.query(
        `UPDATE dhis2_monthly_reports
         SET computed_values = :computed, overrides = :overrides, header = :header, signoff = :signoff, updated_at = NOW()
         WHERE id = :id`,
        { replacements: { id, computed: JSON.stringify(computed), overrides: JSON.stringify(overrides || {}), header: JSON.stringify(header || {}), signoff: JSON.stringify(signoff || {}) } }
      );
    } else {
      await sequelize.query(
        `INSERT INTO dhis2_monthly_reports (id, clinic_id, branch_id, period, status, computed_values, overrides, header, signoff, created_by)
         VALUES (:id, :clinicId, :branchId, :period, 'draft', :computed, :overrides, :header, :signoff, :createdBy)`,
        { replacements: { id, clinicId, branchId, period, computed: JSON.stringify(computed), overrides: JSON.stringify(overrides || {}), header: JSON.stringify(header || {}), signoff: JSON.stringify(signoff || {}), createdBy: req.user?.id || null } }
      );
    }

    try {
      const { logAudit } = require('./reports');
      await logAudit({
        req, clinic_id: clinicId, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'DHIS2 Report', action: 'save', entity_type: 'Dhis2MonthlyReport', entity_id: id,
        description: `Saved DHIS2 report draft for ${period}`, status: 'success',
      });
    } catch (e) { /* audit is best-effort */ }

    const [[saved]] = await sequelize.query(`SELECT * FROM dhis2_monthly_reports WHERE id = :id`, { replacements: { id } });
    res.status(existing ? 200 : 201).json(saved);
  } catch (error) {
    console.error('Error saving DHIS2 report:', error);
    res.status(500).json({ error: error.message || 'Failed to save DHIS2 report' });
  }
});

router.post('/:id/finalize', authorize('reports.dhis2.finalize'), async (req, res) => {
  try {
    const replacements = { id: req.params.id };
    const branchSql = branchScope(req, replacements, 'r');
    const [[report]] = await sequelize.query(`SELECT * FROM dhis2_monthly_reports r WHERE r.id = :id ${branchSql}`, { replacements });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status === 'final') return res.status(409).json({ error: 'Report is already finalized' });

    const computed = typeof report.computed_values === 'string' ? JSON.parse(report.computed_values) : report.computed_values;
    const overrides = typeof report.overrides === 'string' ? JSON.parse(report.overrides) : report.overrides;
    const gFinal = { ...(computed?.sections?.G || {}) };
    for (const rowId of Object.keys(gFinal)) {
      const override = overrides?.G?.[rowId]?.closing;
      if (override != null) gFinal[rowId] = { ...gFinal[rowId], closing: override };
    }
    await writeStockSnapshots(req, report.branch_id, report.period, gFinal);

    await sequelize.query(
      `UPDATE dhis2_monthly_reports SET status = 'final', finalized_by = :userId, finalized_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: report.id, userId: req.user?.id || null } }
    );

    try {
      const { logAudit } = require('./reports');
      await logAudit({
        req, clinic_id: report.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'DHIS2 Report', action: 'finalize', entity_type: 'Dhis2MonthlyReport', entity_id: report.id,
        description: `Finalized DHIS2 report for ${report.period}`, status: 'success',
      });
    } catch (e) { /* audit is best-effort */ }

    res.json({ success: true });
  } catch (error) {
    console.error('Error finalizing DHIS2 report:', error);
    res.status(500).json({ error: 'Failed to finalize DHIS2 report' });
  }
});

// Only admins may reopen — literal role array, matching the existing style
// of permanently-hardcoded admin-only routes (e.g. roles.js) rather than a
// privilege grant, since the requirement is specifically "admin", not
// "whoever holds reports.dhis2.finalize".
router.post('/:id/reopen', authorize(['admin']), async (req, res) => {
  try {
    const [, meta] = await sequelize.query(
      `UPDATE dhis2_monthly_reports SET status = 'draft', finalized_by = NULL, finalized_at = NULL, updated_at = NOW() WHERE id = :id AND status = 'final'`,
      { replacements: { id: req.params.id } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Finalized report not found' });

    const [[report]] = await sequelize.query(`SELECT clinic_id, period FROM dhis2_monthly_reports WHERE id = :id`, { replacements: { id: req.params.id } });
    try {
      const { logAudit } = require('./reports');
      await logAudit({
        req, clinic_id: report?.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'DHIS2 Report', action: 'reopen', entity_type: 'Dhis2MonthlyReport', entity_id: req.params.id,
        description: `Reopened DHIS2 report for ${report?.period}`, status: 'success',
      });
    } catch (e) { /* audit is best-effort */ }

    res.json({ success: true });
  } catch (error) {
    console.error('Error reopening DHIS2 report:', error);
    res.status(500).json({ error: 'Failed to reopen DHIS2 report' });
  }
});

// ── Settings: lab/inventory/branch-header mappings ──────────────────────

router.get('/settings/mappings', authorize('reports.dhis2.view'), async (req, res) => {
  try {
    const branchId = req.query.branch_id ? parseInt(req.query.branch_id, 10) : null;
    const [rows] = await sequelize.query(
      `SELECT mapping_type, payload FROM dhis2_mappings WHERE COALESCE(branch_id, -1) = :branchId`,
      { replacements: { branchId: branchId || -1 } }
    );
    const [[branchSettings]] = await sequelize.query(
      `SELECT * FROM dhis2_branch_settings WHERE branch_id = :branchId`,
      { replacements: { branchId: branchId || 0 } }
    );
    res.json({ mappings: rows, branchSettings: branchSettings || null });
  } catch (error) {
    console.error('Error fetching DHIS2 settings:', error);
    res.status(500).json({ error: 'Failed to fetch DHIS2 settings' });
  }
});

router.put('/settings/mappings', authorize('reports.dhis2.finalize'), async (req, res) => {
  try {
    const { branch_id, mapping_type, payload, branch_settings } = req.body;
    const branchId = branch_id ? parseInt(branch_id, 10) : null;

    if (mapping_type && payload) {
      const id = uuidv4();
      await sequelize.query(
        `INSERT INTO dhis2_mappings (id, branch_id, mapping_type, payload)
         VALUES (:id, :branchId, :mappingType, :payload)
         ON CONFLICT (COALESCE(branch_id, -1), mapping_type) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        { replacements: { id, branchId, mappingType: mapping_type, payload: JSON.stringify(payload) } }
      );
    }

    if (branch_settings && branchId) {
      const id = uuidv4();
      await sequelize.query(
        `INSERT INTO dhis2_branch_settings (id, branch_id, state, county, payam, facility_code, facility_type, catchment_population)
         VALUES (:id, :branchId, :state, :county, :payam, :facilityCode, :facilityType, :catchmentPopulation)
         ON CONFLICT (branch_id) DO UPDATE SET
           state = EXCLUDED.state, county = EXCLUDED.county, payam = EXCLUDED.payam,
           facility_code = EXCLUDED.facility_code, facility_type = EXCLUDED.facility_type,
           catchment_population = EXCLUDED.catchment_population, updated_at = NOW()`,
        { replacements: {
          id, branchId,
          state: branch_settings.state || null, county: branch_settings.county || null, payam: branch_settings.payam || null,
          facilityCode: branch_settings.facility_code || null, facilityType: branch_settings.facility_type || null,
          catchmentPopulation: branch_settings.catchment_population != null ? parseInt(branch_settings.catchment_population, 10) : null,
        } }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving DHIS2 settings:', error);
    res.status(500).json({ error: 'Failed to save DHIS2 settings' });
  }
});

// Flattens computed_values + overrides into the "Data" sheet shape — kept
// close to DHIS2's own dataValueSets (dataElement, period, orgUnit,
// categoryOptionCombo, value) so a future submission integration can extend
// this instead of re-deriving it, without actually submitting anywhere yet.
function flattenToDataRows(computed, overrides, period, orgUnit) {
  const rows = [];
  const ageSexCols = ['u5m', 'u5f', 'ge5m', 'ge5f', 'unknown', 'total'];
  const pushAgeSex = (sectionId, rowId, rowLabel, computedRow, overrideRow) => {
    for (const col of ageSexCols) {
      const computedValue = computedRow?.[col] ?? 0;
      const overridden = overrideRow && overrideRow[col] != null;
      rows.push({
        section: sectionId, indicator: rowLabel, ageGroup: col.startsWith('u5') ? '<5' : col.startsWith('ge5') ? '≥5' : (col === 'unknown' ? 'Unknown' : 'All'),
        sex: col.endsWith('m') ? 'M' : col.endsWith('f') ? 'F' : (col === 'unknown' ? 'Unknown' : 'All'),
        value: overridden ? overrideRow[col] : computedValue, computedValue, overridden: !!overridden,
        dataElement: `${sectionId}_${rowId}`, period, orgUnit, categoryOptionCombo: col,
      });
    }
  };

  for (const rowDef of formDefinition.sections.A.rows) {
    if (rowDef.isTotal) continue;
    pushAgeSex('A', rowDef.id, rowDef.label, computed?.sections?.A?.[rowDef.id], overrides?.A?.[rowDef.id]);
  }
  for (const rowDef of formDefinition.sections.B.rows) {
    if (rowDef.isTotal) continue;
    pushAgeSex('B', rowDef.id, rowDef.label, computed?.sections?.B?.[rowDef.id], overrides?.B?.[rowDef.id]);
  }
  for (const rowDef of formDefinition.sections.C.rows) {
    const c = computed?.sections?.C?.[rowDef.id] || {};
    const o = overrides?.C?.[rowDef.id] || {};
    for (const col of ['tested', 'positive', 'pct_positive']) {
      const overridden = o[col] != null;
      rows.push({
        section: 'C', indicator: rowDef.label, ageGroup: 'All', sex: 'All',
        value: overridden ? o[col] : (c[col] ?? 0), computedValue: c[col] ?? 0, overridden,
        dataElement: `C_${rowDef.id}_${col}`, period, orgUnit, categoryOptionCombo: col,
      });
    }
  }
  for (const rowDef of formDefinition.sections.D.rows) {
    const o = overrides?.D?.[rowDef.id];
    rows.push({ section: 'D', indicator: rowDef.label, ageGroup: 'All', sex: 'All', value: o ?? 0, computedValue: null, overridden: o != null, dataElement: `D_${rowDef.id}`, period, orgUnit, categoryOptionCombo: 'value' });
  }
  for (const rowDef of formDefinition.sections.E.rows) {
    const o = overrides?.E?.[rowDef.id];
    rows.push({ section: 'E', indicator: rowDef.label, ageGroup: 'All', sex: 'All', value: o ?? 0, computedValue: null, overridden: o != null, dataElement: `E_${rowDef.id}`, period, orgUnit, categoryOptionCombo: 'value' });
  }
  for (const rowDef of formDefinition.sections.F.rows) {
    const c = computed?.sections?.F?.[rowDef.id];
    const o = overrides?.F?.[rowDef.id];
    rows.push({ section: 'F', indicator: rowDef.label, ageGroup: 'All', sex: 'All', value: o ?? c ?? 0, computedValue: c ?? 0, overridden: o != null, dataElement: `F_${rowDef.id}`, period, orgUnit, categoryOptionCombo: 'value' });
  }
  for (const rowDef of formDefinition.sections.G.defaultItems) {
    const c = computed?.sections?.G?.[rowDef.id] || {};
    const o = overrides?.G?.[rowDef.id] || {};
    for (const col of ['opening', 'received', 'used', 'closing', 'daysOutOfStock']) {
      const overridden = o[col] != null;
      rows.push({
        section: 'G', indicator: rowDef.label, ageGroup: 'All', sex: 'All',
        value: overridden ? o[col] : (c[col] ?? 0), computedValue: c[col] ?? 0, overridden,
        dataElement: `G_${rowDef.id}_${col}`, period, orgUnit, categoryOptionCombo: col,
      });
    }
  }
  return rows;
}

router.get('/:id/export.xlsx', authorize('reports.dhis2.view'), async (req, res) => {
  try {
    const replacements = { id: req.params.id };
    const branchSql = branchScope(req, replacements, 'r');
    const [[report]] = await sequelize.query(`SELECT * FROM dhis2_monthly_reports r WHERE r.id = :id ${branchSql}`, { replacements });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const [[branch]] = await sequelize.query(`SELECT name FROM branches WHERE id = :id`, { replacements: { id: report.branch_id } });
    const computed = typeof report.computed_values === 'string' ? JSON.parse(report.computed_values) : report.computed_values;
    const overrides = typeof report.overrides === 'string' ? JSON.parse(report.overrides) : report.overrides;
    const header = typeof report.header === 'string' ? JSON.parse(report.header) : report.header;
    const isDraft = report.status !== 'final';
    const facilityCode = header?.facility_code || 'FACILITY';
    const facilityName = branch?.name || 'Facility';

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('HMIS report', isDraft ? { properties: { tabColor: { argb: 'FFDC2626' } } } : undefined);

    const titleRow = sheet.addRow([`Monthly HMIS Facility Report — ${facilityName} — ${report.period}${isDraft ? '  (DRAFT)' : ''}`]);
    titleRow.font = { bold: true, size: 14 };
    sheet.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
    if (isDraft) titleRow.font = { ...titleRow.font, color: { argb: 'FFDC2626' } };
    sheet.addRow([]);

    const headerRow = sheet.addRow(['Facility Code', facilityCode, 'Facility Type', header?.facility_type || '']);
    headerRow.font = { bold: false };
    sheet.addRow(['State', header?.state || '', 'County', header?.county || '', 'Payam', header?.payam || '']);
    sheet.addRow(['Catchment Population', header?.catchment_population || '']);
    sheet.addRow([]);

    const addSectionAgeSex = (sectionDef, computedSection, overrideSection) => {
      const secTitle = sheet.addRow([`${sectionDef.id}. ${sectionDef.title}`]);
      secTitle.font = { bold: true, size: 12 };
      sheet.mergeCells(`A${secTitle.number}:F${secTitle.number}`);
      const colHeaderRow = sheet.addRow(['Indicator', ...sectionDef.columns.map((c) => c.label)]);
      colHeaderRow.font = { bold: true };
      colHeaderRow.eachCell((cell) => { cell.border = { bottom: { style: 'thin' } }; });
      for (const rowDef of sectionDef.rows) {
        const computedRow = computedSection?.[rowDef.id] || {};
        const overrideRow = overrideSection?.[rowDef.id] || {};
        const cells = sectionDef.columns.map((c) => (overrideRow[c.id] != null ? overrideRow[c.id] : (computedRow[c.id] ?? 0)));
        const r = sheet.addRow([rowDef.label, ...cells]);
        if (rowDef.isTotal) r.font = { bold: true };
        r.eachCell((cell) => { cell.border = { top: { style: 'hair' } }; });
      }
      sheet.addRow([]);
    };

    addSectionAgeSex(formDefinition.sections.A, computed?.sections?.A, overrides?.A);
    addSectionAgeSex(formDefinition.sections.B, computed?.sections?.B, overrides?.B);

    const cTitle = sheet.addRow(['C. Laboratory']); cTitle.font = { bold: true, size: 12 };
    const cHeader = sheet.addRow(['Test', 'Tested', 'Positive', '% positive']); cHeader.font = { bold: true };
    for (const rowDef of formDefinition.sections.C.rows) {
      const c = computed?.sections?.C?.[rowDef.id] || {};
      const o = overrides?.C?.[rowDef.id] || {};
      sheet.addRow([rowDef.label, o.tested ?? c.tested ?? 0, o.positive ?? c.positive ?? 0, o.pct_positive ?? c.pct_positive ?? 0]);
    }
    sheet.addRow([]);

    const fTitle = sheet.addRow(['F. Inpatient']); fTitle.font = { bold: true, size: 12 };
    for (const rowDef of formDefinition.sections.F.rows) {
      const c = computed?.sections?.F?.[rowDef.id];
      const o = overrides?.F?.[rowDef.id];
      sheet.addRow([rowDef.label, o ?? c ?? 0]);
    }
    sheet.addRow([]);

    const gTitle = sheet.addRow(['G. Tracer Drugs and Supplies']); gTitle.font = { bold: true, size: 12 };
    const gHeader = sheet.addRow(['Item', 'Opening', 'Received', 'Used', 'Closing', 'Days Out of Stock']); gHeader.font = { bold: true };
    for (const rowDef of formDefinition.sections.G.defaultItems) {
      const c = computed?.sections?.G?.[rowDef.id] || {};
      const o = overrides?.G?.[rowDef.id] || {};
      sheet.addRow([rowDef.label, o.opening ?? c.opening ?? 0, o.received ?? c.received ?? 0, o.used ?? c.used ?? 0, o.closing ?? c.closing ?? 0, o.daysOutOfStock ?? c.daysOutOfStock ?? 0]);
    }

    sheet.columns.forEach((col) => { col.width = 22; });

    // Sheet 2 — flat data, DHIS2-dataValueSets-shaped for later reuse.
    const dataSheet = workbook.addWorksheet('Data');
    dataSheet.columns = [
      { header: 'Section', key: 'section', width: 10 },
      { header: 'Indicator', key: 'indicator', width: 35 },
      { header: 'Age Group', key: 'ageGroup', width: 12 },
      { header: 'Sex', key: 'sex', width: 10 },
      { header: 'Value', key: 'value', width: 12 },
      { header: 'Computed Value', key: 'computedValue', width: 15 },
      { header: 'Overridden', key: 'overridden', width: 12 },
      { header: 'dataElement', key: 'dataElement', width: 25 },
      { header: 'period', key: 'period', width: 10 },
      { header: 'orgUnit', key: 'orgUnit', width: 15 },
      { header: 'categoryOptionCombo', key: 'categoryOptionCombo', width: 20 },
    ];
    dataSheet.getRow(1).font = { bold: true };
    const dataRows = flattenToDataRows(computed, overrides, report.period, facilityCode);
    dataRows.forEach((r) => dataSheet.addRow({ ...r, overridden: r.overridden ? 'yes' : 'no' }));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DHIS2_${facilityCode}_${report.period}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting DHIS2 report to Excel:', error);
    res.status(500).json({ error: 'Failed to export DHIS2 report' });
  }
});

module.exports = router;

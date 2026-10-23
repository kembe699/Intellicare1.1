// ─── Clinical Reports (v2) ────────────────────────────────────────────────
//
// MOH-style clinical register reports — Patient Register, Workload,
// Morbidity, Nursing Notes, Laboratory/Radiology/Prescription registers,
// Inpatient registers, and age-split Outpatient registers. Mounted at
// /api/reports-v2/clinical, same convention as reportPatients.js /
// reportLaboratory.js (relies on the global authenticateToken +
// branchAccessControl middleware already applied ahead of route mounting).
//
// Two independent patient registries, same as reportPatients.js: `patients`
// and `lis_participants` (no clinic_id — queried clinic-agnostically).
//
// IMPORTANT: lis_test_orders.clinic_id is NOT a real numeric clinic id (it's
// a "consulting clinic" UUID string, a false cognate) — never filter that
// table by clinic_id. Every tenant schema already belongs to exactly one
// facility, so clinic scoping is unnecessary there; branch_id is the real
// scope.
//
// "All Branches" vs "By Branch" dropdown variants share one query function
// each: `allBranches=true` skips branch filtering entirely (every branch's
// rows), otherwise the normal ambient branchScope() applies (admins see
// everything unless scoped to one branch; non-admins always see their own
// branch only) — same convention as every other v2 report.

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

function isoDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function asDateStr(v) {
  if (!v || typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Same convention as reportPatients.js/reportDhis2.js's branchScope — named
// :branchId replacement, optional table alias, skipped entirely when
// `skip` is true (the "All Branches" dropdown variants).
function branchScope(req, replacements, alias = '', skip = false) {
  if (skip) return '';
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

// Age in whole years as of a given date — identical to reportDhis2.js's
// calcAgeYears (duplicated here per this codebase's established convention
// of small report-local helpers rather than a shared cross-file import).
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

// Every "Diagnosis: X" segment in clinical_notes, de-duped — mirrors
// reportDhis2.js's extractDiagnosisSegments / LISTestOrders.tsx's own
// getDiagnosesFromNotes convention. This is the clinician's point-of-care
// working impression (pre-coding), as opposed to visit_diagnoses' formally
// ICD-coded rows — see GET /morbidity below for how the two are split.
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

function boolParam(v) { return v === 'true' || v === '1' || v === true; }

// ── GET /patient-register ───────────────────────────────────────────────
// Every patient registered in the period, from BOTH registries.
router.get('/patient-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;

    const repl1 = { fromTs, toTs };
    const branchSql1 = branchScope(req, repl1, 'p', allBranches);
    const rowsA = await sequelize.query(
      `SELECT p.id, p.first_name AS "firstName", p.last_name AS "lastName", p.gender,
              p.date_of_birth AS "dateOfBirth", p.registration_date AS "visitDate",
              b.name AS "branchName", 'Registry' AS source
       FROM patients p
       LEFT JOIN branches b ON b.id = p.branch_id
       WHERE p.registration_date BETWEEN :fromTs AND :toTs ${branchSql1}
       ORDER BY p.registration_date DESC`,
      { replacements: repl1, type: QueryTypes.SELECT }
    );

    const repl2 = { fromTs, toTs };
    const branchSql2 = branchScope(req, repl2, 'lp', allBranches);
    const rowsB = await sequelize.query(
      `SELECT lp.id, lp.first_name AS "firstName", lp.last_name AS "lastName", lp.gender,
              lp.date_of_birth AS "dateOfBirth", lp.created_at AS "visitDate",
              b.name AS "branchName", 'LIS' AS source
       FROM lis_participants lp
       LEFT JOIN branches b ON b.id = lp.branch_id
       WHERE lp.created_at BETWEEN :fromTs AND :toTs ${branchSql2}
       ORDER BY lp.created_at DESC`,
      { replacements: repl2, type: QueryTypes.SELECT }
    );

    const rows = [...rowsA, ...rowsB]
      .map((r) => ({ ...r, age: calcAgeYears(r.dateOfBirth, r.visitDate) }))
      .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());

    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Clinical patient-register error:', err);
    res.status(500).json({ error: 'Failed to generate patient register' });
  }
});

// ── GET /workload ────────────────────────────────────────────────────────
// Visits (lis_test_orders) handled per doctor, per branch, in the period.
router.get('/workload', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'o', allBranches);

    const rows = await sequelize.query(
      `SELECT COALESCE(u.display_name, 'Unassigned') AS "doctorName",
              COALESCE(b.name, 'Unassigned') AS "branchName",
              COUNT(*) AS "visitCount"
       FROM lis_test_orders o
       LEFT JOIN users u ON u.id = o.doctor_id
       LEFT JOIN branches b ON b.id = o.branch_id
       WHERE o.created_at BETWEEN :fromTs AND :toTs ${branchSql}
       GROUP BY u.display_name, b.name
       ORDER BY "visitCount" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, visitCount: parseInt(r.visitCount, 10) || 0 })) });
  } catch (err) {
    console.error('Clinical workload error:', err);
    res.status(500).json({ error: 'Failed to generate workload report' });
  }
});

// ── GET /visits-by-role ──────────────────────────────────────────────────
// Every visit touchpoint (doctor, triage, consultant) tagged with the
// acting staff member's role — the closest schema-backed reading of
// "Patient Visits By Role(s)" (there is no single "visit handler role"
// field; a visit can have up to three distinct staff touchpoints).
router.get('/visits-by-role', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'o', allBranches);

    const rows = await sequelize.query(
      `SELECT role, COUNT(*) AS "visitCount" FROM (
         SELECT u.role AS role FROM lis_test_orders o
           JOIN users u ON u.id = o.doctor_id
           WHERE o.doctor_id IS NOT NULL AND o.created_at BETWEEN :fromTs AND :toTs ${branchSql}
         UNION ALL
         SELECT u.role AS role FROM lis_test_orders o
           JOIN users u ON u.id = o.triaged_by
           WHERE o.triaged_by IS NOT NULL AND o.created_at BETWEEN :fromTs AND :toTs ${branchSql}
       ) touchpoints
       GROUP BY role ORDER BY "visitCount" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ role: r.role || 'unknown', visitCount: parseInt(r.visitCount, 10) || 0 })) });
  } catch (err) {
    console.error('Clinical visits-by-role error:', err);
    res.status(500).json({ error: 'Failed to generate visits-by-role report' });
  }
});

// ── GET /morbidity ───────────────────────────────────────────────────────
// by=diagnosis  — formally ICD-coded rows (visit_diagnoses)
// by=impression — the clinician's free-text point-of-care impression,
//                 parsed from lis_test_orders.clinical_notes, for visits
//                 that were never coded
router.get('/morbidity', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const by = req.query.by === 'impression' ? 'impression' : 'diagnosis';
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;

    if (by === 'diagnosis') {
      const repl = { fromTs, toTs };
      const branchSql = branchScope(req, repl, 'vd', allBranches);
      const rows = await sequelize.query(
        `SELECT COALESCE(vd.icd_code, 'uncoded') AS "icdCode", MIN(vd.description) AS description, COUNT(*) AS count
         FROM visit_diagnoses vd
         WHERE vd.deleted_at IS NULL AND vd.created_at BETWEEN :fromTs AND :toTs ${branchSql}
         GROUP BY vd.icd_code ORDER BY count DESC`,
        { replacements: repl, type: QueryTypes.SELECT }
      );
      return res.json({ period: { dateFrom, dateTo }, by, rows: rows.map(r => ({ ...r, count: parseInt(r.count, 10) || 0 })) });
    }

    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'o', allBranches);
    const orders = await sequelize.query(
      `SELECT o.clinical_notes AS "clinicalNotes" FROM lis_test_orders o
       WHERE o.created_at BETWEEN :fromTs AND :toTs ${branchSql} AND o.clinical_notes IS NOT NULL`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const counts = new Map();
    for (const o of orders) {
      for (const seg of extractDiagnosisSegments(o.clinicalNotes)) {
        const key = seg.toLowerCase();
        const row = counts.get(key) || { description: seg, count: 0 };
        row.count += 1;
        counts.set(key, row);
      }
    }
    const rows = [...counts.values()].sort((a, b) => b.count - a.count);
    res.json({ period: { dateFrom, dateTo }, by, rows });
  } catch (err) {
    console.error('Clinical morbidity error:', err);
    res.status(500).json({ error: 'Failed to generate morbidity report' });
  }
});

// ── GET /nursing-notes-summary ───────────────────────────────────────────
// nursing_notes carries no branch_id of its own — resolved via its
// admission's branch_id instead.
router.get('/nursing-notes-summary', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'ia', allBranches);

    const rows = await sequelize.query(
      `SELECT COALESCE(b.name, 'Unassigned') AS "branchName", nn.shift,
              COUNT(*) AS "noteCount", COUNT(DISTINCT nn.patient_id) AS "patientCount"
       FROM nursing_notes nn
       LEFT JOIN inpatient_admissions ia ON ia.id = nn.admission_id
       LEFT JOIN branches b ON b.id = ia.branch_id
       WHERE nn.note_date BETWEEN :fromTs AND :toTs ${branchSql}
       GROUP BY b.name, nn.shift ORDER BY "noteCount" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, noteCount: parseInt(r.noteCount, 10) || 0, patientCount: parseInt(r.patientCount, 10) || 0 })) });
  } catch (err) {
    console.error('Clinical nursing-notes-summary error:', err);
    res.status(500).json({ error: 'Failed to generate nursing notes summary' });
  }
});

// ── GET /laboratory-data-summary ─────────────────────────────────────────
router.get('/laboratory-data-summary', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'sp', allBranches);

    const rows = await sequelize.query(
      `SELECT sp.test_code AS "testCode", MIN(sp.test_name) AS "testName",
              COUNT(*) AS volume, COUNT(DISTINCT o.participant_id) AS "distinctPatients",
              SUM(CASE WHEN sp.status IN ('completed','approved','released') THEN 1 ELSE 0 END) AS completed
       FROM lis_specimens sp
       INNER JOIN lis_test_orders o ON o.id = sp.order_id
       WHERE sp.created_at BETWEEN :fromTs AND :toTs ${branchSql}
       GROUP BY sp.test_code ORDER BY volume DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({ ...r, volume: parseInt(r.volume, 10) || 0, distinctPatients: parseInt(r.distinctPatients, 10) || 0, completed: parseInt(r.completed, 10) || 0 })),
    });
  } catch (err) {
    console.error('Clinical laboratory-data-summary error:', err);
    res.status(500).json({ error: 'Failed to generate laboratory data summary' });
  }
});

// ── GET /laboratory-tat-summary ──────────────────────────────────────────
// Turnaround = lis_results.created_at (first result recorded) minus
// lis_specimens.collection_time (falling back to the specimen's own
// created_at when never explicitly collected) — there is no dedicated TAT
// timestamp column, so this is a computed delta, averaged per test.
router.get('/laboratory-tat-summary', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'sp', allBranches);

    const rows = await sequelize.query(
      `SELECT sp.test_code AS "testCode", MIN(sp.test_name) AS "testName",
              COUNT(DISTINCT sp.id) AS "specimenCount",
              AVG(EXTRACT(EPOCH FROM (r.created_at - COALESCE(sp.collection_time, sp.created_at))) / 3600.0) AS "avgHours"
       FROM lis_specimens sp
       INNER JOIN lis_results r ON r.specimen_id = sp.id
       WHERE sp.created_at BETWEEN :fromTs AND :toTs ${branchSql}
       GROUP BY sp.test_code ORDER BY "avgHours" DESC NULLS LAST`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({ ...r, specimenCount: parseInt(r.specimenCount, 10) || 0, avgHours: r.avgHours != null ? parseFloat(r.avgHours) : null })),
    });
  } catch (err) {
    console.error('Clinical laboratory-tat-summary error:', err);
    res.status(500).json({ error: 'Failed to generate laboratory TAT summary' });
  }
});

// ── GET /laboratory-register ─────────────────────────────────────────────
// Row-level listing. testCode narrows to one test ("By Test").
router.get('/laboratory-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const testCode = req.query.testCode || null;
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'sp', allBranches);
    const testSql = testCode ? ' AND sp.test_code = :testCode' : '';
    if (testCode) repl.testCode = testCode;

    const rows = await sequelize.query(
      `SELECT sp.id, sp.test_code AS "testCode", sp.test_name AS "testName", sp.status,
              sp.collection_time AS "collectionTime", sp.created_at AS "orderedAt",
              COALESCE(lp.first_name || ' ' || lp.last_name, 'Unknown') AS "patientName",
              b.name AS "branchName"
       FROM lis_specimens sp
       INNER JOIN lis_test_orders o ON o.id = sp.order_id
       LEFT JOIN lis_participants lp ON lp.id = o.participant_id
       LEFT JOIN branches b ON b.id = sp.branch_id
       WHERE sp.created_at BETWEEN :fromTs AND :toTs ${branchSql}${testSql}
       ORDER BY sp.created_at DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Clinical laboratory-register error:', err);
    res.status(500).json({ error: 'Failed to generate laboratory register' });
  }
});

// ── GET /radiology-register ──────────────────────────────────────────────
// Outpatient (radiology_requests) and inpatient (inpatient_radiology_requests)
// imaging, combined.
router.get('/radiology-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;

    const repl1 = { fromTs, toTs };
    const branchSql1 = branchScope(req, repl1, 'rr', allBranches);
    const outpatient = await sequelize.query(
      `SELECT rr.id, rr.exam_name AS "examName", rr.status, rr.request_date AS "requestDate",
              COALESCE(lp.first_name || ' ' || lp.last_name, 'Unknown') AS "patientName",
              b.name AS "branchName", 'Outpatient' AS setting,
              COALESCE(rr.category, 'Radiology') AS "category"
       FROM radiology_requests rr
       LEFT JOIN lis_participants lp ON lp.id = rr.participant_id
       LEFT JOIN branches b ON b.id = rr.branch_id
       WHERE rr.request_date BETWEEN :fromTs AND :toTs ${branchSql1}
       ORDER BY rr.request_date DESC`,
      { replacements: repl1, type: QueryTypes.SELECT }
    );

    const repl2 = { fromTs, toTs };
    const branchSql2 = branchScope(req, repl2, 'irr', allBranches);
    const inpatient = await sequelize.query(
      `SELECT irr.id, irr.imaging_type AS "examName", irr.status, irr.request_date AS "requestDate",
              NULLIF(TRIM(COALESCE(p.first_name, lp.first_name, '') || ' ' || COALESCE(p.last_name, lp.last_name, '')), '') AS "rawPatientName",
              b.name AS "branchName", 'Inpatient' AS setting,
              'Radiology' AS "category"
       FROM inpatient_radiology_requests irr
       LEFT JOIN patients p ON p.id = irr.patient_id
       LEFT JOIN lis_participants lp ON lp.id = irr.patient_id
       LEFT JOIN branches b ON b.id = irr.branch_id
       WHERE irr.request_date BETWEEN :fromTs AND :toTs ${branchSql2}
       ORDER BY irr.request_date DESC`,
      { replacements: repl2, type: QueryTypes.SELECT }
    );

    const rows = [...outpatient, ...inpatient.map(r => ({ ...r, patientName: r.rawPatientName || 'Unknown' }))]
      .sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Clinical radiology-register error:', err);
    res.status(500).json({ error: 'Failed to generate radiology register' });
  }
});

// ── GET /prescription-register ───────────────────────────────────────────
// Newer structured system (pharmacy_prescriptions + prescription_lines) and
// the legacy free-text `prescriptions` table, combined. clinicianId narrows
// to one prescriber ("Per Clinician").
router.get('/prescription-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const clinicianId = req.query.clinicianId ? parseInt(req.query.clinicianId, 10) : null;
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;

    const repl1 = { fromTs, toTs };
    const branchSql1 = branchScope(req, repl1, 'pp', allBranches);
    const clinicianSql1 = clinicianId ? ' AND pp.doctor_id = :clinicianId' : '';
    if (clinicianId) repl1.clinicianId = clinicianId;
    const structured = await sequelize.query(
      `SELECT pp.id, pp.prescription_number AS "prescriptionNumber", pp.prescription_date AS "prescriptionDate",
              COALESCE(pp.prescribed_by_name, u.display_name, 'Unknown') AS "prescriberName",
              COALESCE(ii.item_name, pl.external_drug_name, 'Unknown drug') AS "drugName",
              pl.dose_strength AS "doseStrength", pl.frequency, pl.duration_days AS "durationDays",
              NULLIF(TRIM(COALESCE(lp.first_name, p.first_name, '') || ' ' || COALESCE(lp.last_name, p.last_name, '')), '') AS "rawPatientName",
              b.name AS "branchName",
              pl.location_name AS "locationName", COALESCE(pl.is_external, false) AS "isExternal"
       FROM pharmacy_prescriptions pp
       JOIN prescription_lines pl ON pl.prescription_id = pp.id
       LEFT JOIN inventory_items ii ON ii.id = pl.drug_id
       LEFT JOIN users u ON u.id = pp.doctor_id
       LEFT JOIN patients p ON p.id = pp.patient_id
       LEFT JOIN lis_participants lp ON lp.id = pp.patient_id
       LEFT JOIN branches b ON b.id = pp.branch_id
       WHERE pp.prescription_date BETWEEN :fromTs AND :toTs ${branchSql1}${clinicianSql1}
       ORDER BY pp.prescription_date DESC`,
      { replacements: repl1, type: QueryTypes.SELECT }
    );

    const repl2 = { fromTs, toTs };
    const branchSql2 = branchScope(req, repl2, 'rx', allBranches);
    const clinicianSql2 = clinicianId ? ' AND rx.prescribed_by = :clinicianId' : '';
    if (clinicianId) repl2.clinicianId = clinicianId;
    const legacy = await sequelize.query(
      `SELECT rx.id, NULL AS "prescriptionNumber", rx.prescribed_at AS "prescriptionDate",
              COALESCE(u.display_name, 'Unknown') AS "prescriberName",
              COALESCE(rx.medication_name, rx.drug_name, 'Unknown drug') AS "drugName",
              rx.dosage AS "doseStrength", rx.frequency, NULL AS "durationDays",
              NULLIF(TRIM(rx.patient_name), '') AS "rawPatientName",
              b.name AS "branchName",
              NULL AS "locationName", false AS "isExternal"
       FROM prescriptions rx
       LEFT JOIN users u ON u.id = rx.prescribed_by
       LEFT JOIN branches b ON b.id = rx.branch_id
       WHERE rx.prescribed_at BETWEEN :fromTs AND :toTs ${branchSql2}${clinicianSql2}
       ORDER BY rx.prescribed_at DESC`,
      { replacements: repl2, type: QueryTypes.SELECT }
    );

    // "Dosage" combines dose + frequency the same way the prescribing UI
    // itself displays a line ("{dose} · {frequency}") — neither field alone
    // is reliably filled in (prescribers often free-text just one of them),
    // so showing only `frequency` left real prescriptions looking blank.
    const rows = [...structured, ...legacy]
      .map(r => ({
        ...r,
        patientName: r.rawPatientName || 'Unknown',
        dosage: [r.doseStrength, r.frequency].filter(Boolean).join(' · ') || '—',
      }))
      .sort((a, b) => new Date(b.prescriptionDate).getTime() - new Date(a.prescriptionDate).getTime());
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Clinical prescription-register error:', err);
    res.status(500).json({ error: 'Failed to generate prescription register' });
  }
});

// ── GET /inpatient-register ──────────────────────────────────────────────
// moh301=true changes nothing about the data pulled today — flagged in the
// frontend as needing confirmation against the actual MOH 301 paper form's
// exact column layout, not yet distinguished at the query level.
router.get('/inpatient-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'ia', allBranches);

    const rows = await sequelize.query(
      `SELECT ia.id, ia.admission_date AS "admissionDate", ia.discharge_date AS "dischargeDate",
              ia.status, ia.diagnosis, ia.admission_type AS "admissionType", ia.discharge_outcome AS "dischargeOutcome",
              NULLIF(TRIM(COALESCE(p.first_name, lp.first_name, '') || ' ' || COALESCE(p.last_name, lp.last_name, '')), '') AS "rawPatientName",
              COALESCE(p.gender, lp.gender) AS gender, COALESCE(p.date_of_birth, lp.date_of_birth) AS "dateOfBirth",
              COALESCE(w.name, 'Unassigned') AS "wardName",
              COALESCE(u.display_name, 'Unassigned') AS "attendingDoctor",
              b.name AS "branchName"
       FROM inpatient_admissions ia
       LEFT JOIN patients p ON p.id = ia.patient_id
       LEFT JOIN lis_participants lp ON lp.id = ia.patient_id
       LEFT JOIN wards w ON w.id = ia.ward_id
       LEFT JOIN users u ON u.id = ia.attending_doctor_id
       LEFT JOIN branches b ON b.id = ia.branch_id
       WHERE ia.admission_date BETWEEN :fromTs AND :toTs ${branchSql}
       ORDER BY ia.admission_date DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({
      period: { dateFrom, dateTo },
      rows: rows.map(r => ({ ...r, patientName: r.rawPatientName || 'Unknown', age: calcAgeYears(r.dateOfBirth, r.admissionDate) })),
    });
  } catch (err) {
    console.error('Clinical inpatient-register error:', err);
    res.status(500).json({ error: 'Failed to generate inpatient register' });
  }
});

// ── GET /inpatient-admissions-attending-doctor ───────────────────────────
router.get('/inpatient-admissions-attending-doctor', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'ia', allBranches);

    const rows = await sequelize.query(
      `SELECT ia.id, ia.admission_date AS "admissionDate", ia.status,
              NULLIF(TRIM(COALESCE(p.first_name, lp.first_name, '') || ' ' || COALESCE(p.last_name, lp.last_name, '')), '') AS "rawPatientName",
              COALESCE(u.display_name, 'Unassigned') AS "attendingDoctor",
              b.name AS "branchName"
       FROM inpatient_admissions ia
       LEFT JOIN patients p ON p.id = ia.patient_id
       LEFT JOIN lis_participants lp ON lp.id = ia.patient_id
       LEFT JOIN users u ON u.id = ia.attending_doctor_id
       LEFT JOIN branches b ON b.id = ia.branch_id
       WHERE ia.admission_date BETWEEN :fromTs AND :toTs ${branchSql} AND ia.attending_doctor_id IS NOT NULL
       ORDER BY ia.admission_date DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({ period: { dateFrom, dateTo }, rows: rows.map(r => ({ ...r, patientName: r.rawPatientName || 'Unknown' })) });
  } catch (err) {
    console.error('Clinical inpatient-admissions-attending-doctor error:', err);
    res.status(500).json({ error: 'Failed to generate inpatient admissions report' });
  }
});

// ── GET /daily-bed-return ────────────────────────────────────────────────
// Admissions and discharges per day, plus beds occupied at day's end.
router.get('/daily-bed-return', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;

    const repl1 = { fromTs, toTs };
    const branchSql1 = branchScope(req, repl1, '', allBranches);
    const admissions = await sequelize.query(
      `SELECT DATE(admission_date) AS day, COUNT(*) AS admissions
       FROM inpatient_admissions
       WHERE admission_date BETWEEN :fromTs AND :toTs ${branchSql1}
       GROUP BY DATE(admission_date)`,
      { replacements: repl1, type: QueryTypes.SELECT }
    );

    const repl2 = { fromTs, toTs };
    const branchSql2 = branchScope(req, repl2, '', allBranches);
    const discharges = await sequelize.query(
      `SELECT DATE(discharge_date) AS day, COUNT(*) AS discharges
       FROM inpatient_admissions
       WHERE discharge_date BETWEEN :fromTs AND :toTs ${branchSql2}
       GROUP BY DATE(discharge_date)`,
      { replacements: repl2, type: QueryTypes.SELECT }
    );

    const byDay = new Map();
    for (const a of admissions) byDay.set(a.day, { day: a.day, admissions: parseInt(a.admissions, 10) || 0, discharges: 0 });
    for (const d of discharges) {
      const row = byDay.get(d.day) || { day: d.day, admissions: 0, discharges: 0 };
      row.discharges = parseInt(d.discharges, 10) || 0;
      byDay.set(d.day, row);
    }

    const rows = [...byDay.values()].sort((a, b) => new Date(b.day).getTime() - new Date(a.day).getTime());
    res.json({ period: { dateFrom, dateTo }, rows });
  } catch (err) {
    console.error('Clinical daily-bed-return error:', err);
    res.status(500).json({ error: 'Failed to generate daily bed return' });
  }
});

// ── GET /outpatient-register ─────────────────────────────────────────────
// ageMode: overFive | underFive | underSelected | overSelected
// selectedAge required for the two "Selected Age" variants.
router.get('/outpatient-register', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const allBranches = boolParam(req.query.allBranches);
    const ageMode = req.query.ageMode || 'overFive';
    const selectedAge = req.query.selectedAge ? parseInt(req.query.selectedAge, 10) : null;
    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { fromTs, toTs };
    const branchSql = branchScope(req, repl, 'o', allBranches);

    // Every outpatient visit in the period, from both registries, with the
    // patient's age AS OF that visit.
    const orders = await sequelize.query(
      `SELECT o.id AS "orderId", o.created_at AS "visitDate", o.participant_id AS "participantId",
              p.first_name AS "firstName", p.last_name AS "lastName", p.gender, p.date_of_birth AS "dateOfBirth",
              b.name AS "branchName"
       FROM lis_test_orders o
       LEFT JOIN lis_participants p ON p.id = o.participant_id
       LEFT JOIN branches b ON b.id = o.branch_id
       WHERE o.created_at BETWEEN :fromTs AND :toTs ${branchSql}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const withAge = orders
      .map((o) => ({ ...o, age: calcAgeYears(o.dateOfBirth, o.visitDate) }))
      .filter((o) => o.age != null);

    let rows;
    if (ageMode === 'underFive') rows = withAge.filter((o) => o.age < 5);
    else if (ageMode === 'underSelected') rows = selectedAge != null ? withAge.filter((o) => o.age < selectedAge) : [];
    else if (ageMode === 'overSelected') rows = selectedAge != null ? withAge.filter((o) => o.age >= selectedAge) : [];
    else rows = withAge.filter((o) => o.age >= 5); // overFive (default)

    rows.sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());
    res.json({ period: { dateFrom, dateTo }, ageMode, selectedAge, rows });
  } catch (err) {
    console.error('Clinical outpatient-register error:', err);
    res.status(500).json({ error: 'Failed to generate outpatient register' });
  }
});

module.exports = router;

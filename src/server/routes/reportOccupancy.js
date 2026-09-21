const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');

// ═══════════════════════════════════════════════════
// BED / WARD OCCUPANCY REPORT — current-state snapshot + admissions trend
// Plain PostgreSQL SQL.
//
// GET /  (mounted e.g. at /api/reports-v2/occupancy)
// Query params:
//   clinic_id  (optional, defaults to 1)
//   dateFrom   (optional, YYYY-MM-DD) — bounds the admissions-trend section only.
//              Defaults to 29 days ago.
//   dateTo     (optional, YYYY-MM-DD) — defaults to today.
//
// Source of truth for "occupied": beds.status. Verified against inpatient.js
// (the live wards/rooms/beds/admissions API) — that module computes ward and
// room occupancy the same way, via COUNT(*) WHERE b.status = 'occupied', and
// toggles beds.status on admit ('occupied') and discharge ('available'). The
// denormalized wards.current_occupancy / rooms.current_occupancy columns are
// NOT kept in sync (confirmed stale against live data) and are deliberately
// not used here.
// ═══════════════════════════════════════════════════

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

// Non-admin users only see rows from their own branch; admins see everything.
// Written inline with named replacements (not branchFilter.js's
// getBranchConditionSQL, which uses positional `?` placeholders that can't
// mix with the named :params this file uses in the same query) — same
// convention as branchScope() in routes/hr.js.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin') return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND ${col} = :branchId`;
}

router.get('/', async (req, res) => {
  try {
    const clinicId = req.query.clinic_id || req.user?.clinicId || 1;

    const today = new Date();
    const defaultFrom = new Date(today.getTime() - 29 * 86400000);
    const dateFrom = req.query.dateFrom || isoDate(defaultFrom);
    const dateTo = req.query.dateTo || isoDate(today);
    const periodStart = `${dateFrom} 00:00:00`;
    const periodEnd = `${dateTo} 23:59:59`;

    // ── 1. Overall bed summary (current state) ──────────────────────────
    const bedStatusRepl = { clinicId };
    const branchSqlBeds = branchScope(req, bedStatusRepl);
    const [bedStatusRows] = await sequelize.query(
      `SELECT status, COUNT(*) AS cnt
       FROM beds
       WHERE clinic_id = :clinicId AND is_active = true ${branchSqlBeds}
       GROUP BY status`,
      { replacements: bedStatusRepl }
    );

    let totalBeds = 0;
    let occupiedBeds = 0;
    let availableBeds = 0;
    let maintenanceBeds = 0;
    for (const row of bedStatusRows) {
      const cnt = Number(row.cnt) || 0;
      totalBeds += cnt;
      if (row.status === 'occupied') occupiedBeds += cnt;
      else if (row.status === 'available') availableBeds += cnt;
      else maintenanceBeds += cnt;
    }
    const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

    // ── 2. By-ward breakdown (current state) ─────────────────────────────
    const byWardRepl = { clinicId };
    const branchSqlWard = branchScope(req, byWardRepl, 'w');
    const [byWard] = await sequelize.query(
      `SELECT
         w.id AS ward_id,
         w.name AS ward_name,
         w.code AS ward_code,
         w.ward_type,
         COUNT(b.id) AS total_beds,
         SUM(CASE WHEN b.status = 'occupied' THEN 1 ELSE 0 END) AS occupied_beds,
         SUM(CASE WHEN b.status = 'available' THEN 1 ELSE 0 END) AS available_beds,
         SUM(CASE WHEN b.status NOT IN ('occupied', 'available') THEN 1 ELSE 0 END) AS maintenance_beds
       FROM wards w
       LEFT JOIN beds b ON b.ward_id = w.id AND b.is_active = true
       WHERE w.clinic_id = :clinicId AND w.is_active = true ${branchSqlWard}
       GROUP BY w.id, w.name, w.code, w.ward_type
       ORDER BY w.name ASC`,
      { replacements: byWardRepl }
    );

    const wardBreakdown = byWard.map(w => {
      const total = Number(w.total_beds) || 0;
      const occupied = Number(w.occupied_beds) || 0;
      return {
        ward_id: w.ward_id,
        ward_name: w.ward_name,
        ward_code: w.ward_code,
        ward_type: w.ward_type,
        total_beds: total,
        occupied_beds: occupied,
        available_beds: Number(w.available_beds) || 0,
        maintenance_beds: Number(w.maintenance_beds) || 0,
        occupancy_rate: total > 0 ? (occupied / total) * 100 : 0,
      };
    });

    // ── 3. Full bed roster (current state, ward/room detail) ────────────
    const bedRowsRepl = { clinicId };
    const branchSqlBedRows = branchScope(req, bedRowsRepl, 'b');
    const [bedRows] = await sequelize.query(
      `SELECT
         b.id, b.bed_number, b.bed_type, b.status,
         r.room_number, r.room_type,
         w.name AS ward_name
       FROM beds b
       LEFT JOIN rooms r ON r.id = b.room_id
       LEFT JOIN wards w ON w.id = b.ward_id
       WHERE b.clinic_id = :clinicId AND b.is_active = true ${branchSqlBedRows}
       ORDER BY w.name ASC, r.room_number ASC, b.bed_number ASC`,
      { replacements: bedRowsRepl }
    );

    // ── 4. Admissions trend (period-based, secondary section) ───────────
    const dailyRepl = { clinicId, periodStart, periodEnd };
    const branchSqlAdm = branchScope(req, dailyRepl);
    const [dailyRows] = await sequelize.query(
      `SELECT DATE(admission_date) AS day, COUNT(*) AS admissions
       FROM inpatient_admissions
       WHERE clinic_id = :clinicId
         AND admission_date >= :periodStart AND admission_date <= :periodEnd ${branchSqlAdm}
       GROUP BY DATE(admission_date)
       ORDER BY day ASC`,
      { replacements: dailyRepl }
    );

    const periodTotalsRepl = { clinicId, periodStart, periodEnd };
    const branchSqlPeriodTotals = branchScope(req, periodTotalsRepl);
    const [[periodTotals]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt
       FROM inpatient_admissions
       WHERE clinic_id = :clinicId
         AND admission_date >= :periodStart AND admission_date <= :periodEnd ${branchSqlPeriodTotals}`,
      { replacements: periodTotalsRepl }
    );

    const activeTotalsRepl = { clinicId };
    const branchSqlActiveTotals = branchScope(req, activeTotalsRepl);
    const [[activeTotals]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt
       FROM inpatient_admissions
       WHERE clinic_id = :clinicId AND status = 'active' ${branchSqlActiveTotals}`,
      { replacements: activeTotalsRepl }
    );

    // Average length of stay — only meaningful over admissions that actually have
    // both dates populated, and only over discharges that fall within the period.
    // With very little data this may legitimately be based on 0 or 1 rows; the
    // completed_count tells the frontend how much to trust the average.
    const losTotalsRepl = { clinicId, periodStart, periodEnd };
    const branchSqlLos = branchScope(req, losTotalsRepl);
    const [[losTotals]] = await sequelize.query(
      `SELECT COUNT(*) AS completed_count, AVG(((discharge_date)::date - (admission_date)::date)) AS avg_los
       FROM inpatient_admissions
       WHERE clinic_id = :clinicId
         AND discharge_date IS NOT NULL
         AND discharge_date >= :periodStart AND discharge_date <= :periodEnd ${branchSqlLos}`,
      { replacements: losTotalsRepl }
    );

    const admissionsTrend = {
      dateFrom,
      dateTo,
      daily: dailyRows.map(r => ({ day: r.day, admissions: Number(r.admissions) || 0 })),
      totalAdmissionsInPeriod: Number(periodTotals?.cnt) || 0,
      currentActiveAdmissions: Number(activeTotals?.cnt) || 0,
      completedStaysInPeriod: Number(losTotals?.completed_count) || 0,
      avgLengthOfStayDays: losTotals?.avg_los != null ? Number(losTotals.avg_los) : null,
    };

    res.json({
      asOf: new Date().toISOString(),
      summary: {
        total_beds: totalBeds,
        occupied_beds: occupiedBeds,
        available_beds: availableBeds,
        maintenance_beds: maintenanceBeds,
        occupancy_rate: occupancyRate,
      },
      byWard: wardBreakdown,
      beds: bedRows,
      admissionsTrend,
    });
  } catch (error) {
    console.error('Error building occupancy report:', error);
    res.status(500).json({ error: 'Failed to build occupancy report' });
  }
});

module.exports = router;

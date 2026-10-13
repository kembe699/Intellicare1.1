// ══════════════════════════════════════════════════════════════════════════
// Theatre (Operating Room) Report — operations performed, by surgeon and by
// procedure, with the revenue each billed.
//
// Didn't exist before this file — theatre.js is purely the operational
// module (booking/running operations); nothing in the Reports Center ever
// broke out theatre activity on its own. Operations already carry their own
// billing fields (procedure_fee, fee_currency, bill_id — wired up when
// requests/operations were made catalog-driven and self-billing earlier),
// so this is a straightforward aggregation, not new billing plumbing.
//
// Mount as:
//   app.use('/api/reports-v2/theatre', require('./routes/reportTheatre'));
// ══════════════════════════════════════════════════════════════════════════

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
const { getBranchConditionSQL } = require('../middleware/branchFilter');

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

router.get('/', async (req, res) => {
  try {
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;

    const clinicSQL = clinicId ? ' AND o.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];
    const branch = getBranchConditionSQL(req, 'o');
    const dateSQL = `DATE(o.scheduled_at) BETWEEN ? AND ?`;
    const baseParams = [dateFrom, dateTo, ...clinicParams, ...branch.params];

    // ── Summary ──────────────────────────────────────────────────────────
    const [[summaryRow]] = await sequelize.query(
      `SELECT
         COUNT(*) AS total_operations,
         COUNT(*) FILTER (WHERE o.status = 'completed') AS completed_operations,
         COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled_operations,
         COUNT(*) FILTER (WHERE o.outcome = 'death') AS deaths,
         COALESCE(SUM(o.procedure_fee) FILTER (WHERE o.bill_id IS NOT NULL), 0) AS total_revenue,
         COALESCE(AVG(o.duration_minutes) FILTER (WHERE o.duration_minutes IS NOT NULL), 0) AS avg_duration_minutes
       FROM theatre_operations o
       WHERE ${dateSQL} ${clinicSQL} ${branch.sql}`,
      { replacements: baseParams }
    );

    // ── By procedure ─────────────────────────────────────────────────────
    const [byProcedure] = await sequelize.query(
      `SELECT
         o.procedure_name,
         COUNT(*) AS operation_count,
         COALESCE(SUM(o.procedure_fee) FILTER (WHERE o.bill_id IS NOT NULL), 0) AS total_revenue
       FROM theatre_operations o
       WHERE ${dateSQL} ${clinicSQL} ${branch.sql}
       GROUP BY o.procedure_name
       ORDER BY total_revenue DESC`,
      { replacements: baseParams }
    );

    // ── By surgeon (primary surgeon only — see theatre_operation_team for
    //    the full multi-member roster; this report counts the case against
    //    whoever is on the single surgeon_employee_id column, same as every
    //    other read site in this app) ────────────────────────────────────
    const [bySurgeon] = await sequelize.query(
      `SELECT
         o.surgeon_employee_id,
         COALESCE(e.first_name || ' ' || e.last_name, 'Unassigned') AS surgeon_name,
         COUNT(*) AS operation_count,
         COALESCE(SUM(o.procedure_fee) FILTER (WHERE o.bill_id IS NOT NULL), 0) AS total_revenue
       FROM theatre_operations o
       LEFT JOIN employees e ON e.id = o.surgeon_employee_id
       WHERE ${dateSQL} ${clinicSQL} ${branch.sql}
       GROUP BY o.surgeon_employee_id, e.first_name, e.last_name
       ORDER BY total_revenue DESC`,
      { replacements: baseParams }
    );

    res.json({
      period: { dateFrom, dateTo },
      summary: {
        totalOperations: parseInt(summaryRow.total_operations, 10) || 0,
        completedOperations: parseInt(summaryRow.completed_operations, 10) || 0,
        cancelledOperations: parseInt(summaryRow.cancelled_operations, 10) || 0,
        deaths: parseInt(summaryRow.deaths, 10) || 0,
        totalRevenue: parseFloat(summaryRow.total_revenue) || 0,
        avgDurationMinutes: Math.round(parseFloat(summaryRow.avg_duration_minutes) || 0),
      },
      byProcedure: byProcedure.map((r) => ({
        procedureName: r.procedure_name || 'Unspecified',
        operationCount: parseInt(r.operation_count, 10) || 0,
        totalRevenue: parseFloat(r.total_revenue) || 0,
      })),
      bySurgeon: bySurgeon.map((r) => ({
        surgeonId: r.surgeon_employee_id,
        surgeonName: r.surgeon_name,
        operationCount: parseInt(r.operation_count, 10) || 0,
        totalRevenue: parseFloat(r.total_revenue) || 0,
      })),
    });
  } catch (err) {
    console.error('Theatre report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

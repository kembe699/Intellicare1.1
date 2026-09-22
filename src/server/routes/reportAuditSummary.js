// ─── Staff Activity / Audit Log Summary Report (v2) ───────────────────────
//
// Report reading from the existing `audit_logs` table
// (written to via the `logAudit` helper exported from the OLD
// src/server/routes/reports.js — that file and its export are NOT touched
// here, this router only SELECTs from the table it populates).
//
// Self-contained. NOTE: originally written for MySQL (no AGE(), no ::date casts, no
// quoted INTERVAL literals — those are Postgres-only and silently fail on
// MySQL). Does not touch reports.js or index.js — meant to be mounted
// separately, e.g.:
//
//   const reportAuditSummaryRouter = require('./routes/reportAuditSummary');
//   app.use('/api/reports-v2/audit-summary', reportAuditSummaryRouter);
//
// Auth: relies on the global `app.use('/api', authenticateToken)` +
// `branchAccessControl` middleware already applied ahead of route mounting
// in index.js — req.user is expected to be populated by the time requests
// reach this router.
//
// Scope note — only `audit_logs` is used here. `branch_access_audit_logs`
// currently has 0 rows live in this system, and `pharmacy_audit_log` has a
// materially different shape (action_type/action_by/action_details, with
// action_by sometimes a numeric user id and sometimes null — not a clean
// join target) and is already narrow-purpose (pharmacy dispensing only).
// Merging three differently-shaped audit tables into one table would be
// messy for little benefit; `audit_logs` alone is the general-purpose,
// cross-module trail (auth, expenses, purchase orders, etc.) and is the
// right single source for a "staff activity" report.
//
// clinic_id note — `audit_logs.clinic_id` is NULL for a meaningful chunk of
// rows (e.g. LOGIN events logged before clinic context is resolved in the
// request pipeline). Since every user in this system currently belongs to
// clinic 1, excluding NULL-clinic rows would hide a large share of real
// activity. This router treats a log row as "in scope" when its clinic_id
// matches the requested clinic OR is NULL, rather than doing a strict
// equality filter like other reports.

const express = require('express');
const router = express.Router();
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

const ACTIVITY_ROW_CAP = 200;

// ── GET / ────────────────────────────────────────────────────────────────
// Query params:
//   dateFrom, dateTo  — YYYY-MM-DD, default to the last 30 days
//   clinic_id         — defaults to the authenticated user's clinic
//   userId            — optional: narrow the totals tiles + chronological activity
//                        log down to a single user's actions (drill-down after
//                        picking someone from the Staff Activity Summary table).
//                        byUser/byUserAction/byAction stay clinic-wide so the
//                        picker/summary context doesn't collapse to one row.
router.get('/', async (req, res) => {
  try {
    const dateFrom = asDateStr(req.query.dateFrom) || isoDaysAgo(29);
    const dateTo = asDateStr(req.query.dateTo) || isoDaysAgo(0);
    const clinicId = parseInt(req.query.clinic_id, 10) || req.user?.clinicId || 1;
    const userId = req.query.userId ? String(req.query.userId) : null;

    const fromTs = `${dateFrom} 00:00:00`;
    const toTs = `${dateTo} 23:59:59`;
    const repl = { clinicId, fromTs, toTs, rowCap: ACTIVITY_ROW_CAP, userId };

    // Non-admin users only see their own branch's staff activity; admins see
    // the whole clinic. Same clinic_id-NULL-is-in-scope reasoning as above
    // applies to branch_id: a lot of rows (e.g. LOGIN, or anything logged by
    // a system/background job) predate branch context or have none, and
    // hiding those from every non-admin would silently drop a large share of
    // real activity rather than just scoping it. Inline, named-`:param`-style
    // helper — this file's raw SQL uses named replacements, not
    // branchFilter.js's positional `?` placeholders.
    let branchScopeSQL = '';
    if (req.user?.role !== 'admin' || req.branchContext?.adminScoped) {
      const branchId = req.branchContext?.branchId || req.user?.branchId || null;
      if (branchId) {
        branchScopeSQL = ' AND (al.branch_id = :branchId OR al.branch_id IS NULL)';
        repl.branchId = branchId;
      }
    }

    const scopeClause = `(al.clinic_id = :clinicId OR al.clinic_id IS NULL) AND al.created_at BETWEEN :fromTs AND :toTs${branchScopeSQL}`;
    const userScopeClause = userId ? `${scopeClause} AND al.user_id = :userId` : scopeClause;

    // 1. Summary tiles — total actions, active staff count, most active user, top action.
    //    Scoped to the selected user when one is picked.
    const [totalsRow] = await sequelize.query(
      `SELECT COUNT(*) AS "totalActions",
              COUNT(DISTINCT al.user_id) AS "activeStaffCount"
       FROM audit_logs al
       WHERE ${userScopeClause}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const [mostActiveUserRow] = await sequelize.query(
      `SELECT al.user_id AS "userId",
              COALESCE(u.display_name, al.user_name, ('User #' || al.user_id)) AS "userName",
              COUNT(*) AS "actionCount"
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${scopeClause} AND al.user_id IS NOT NULL
       GROUP BY al.user_id, "userName"
       ORDER BY "actionCount" DESC
       LIMIT 1`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const [mostCommonActionRow] = await sequelize.query(
      `SELECT al.action AS action, COUNT(*) AS "actionCount"
       FROM audit_logs al
       WHERE ${userScopeClause}
       GROUP BY al.action
       ORDER BY "actionCount" DESC
       LIMIT 1`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 2. Per-user staff activity summary.
    const byUser = await sequelize.query(
      `SELECT al.user_id AS "userId",
              COALESCE(u.display_name, al.user_name, ('User #' || al.user_id)) AS "userName",
              COALESCE(u.role, al.user_role, '—') AS "userRole",
              COUNT(*) AS "actionCount",
              MAX(al.created_at) AS "lastActionAt"
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${scopeClause}
       GROUP BY al.user_id, "userName", "userRole"
       ORDER BY "actionCount" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 3. Per-user × action-type breakdown (for the stacked summary).
    const byUserAction = await sequelize.query(
      `SELECT al.user_id AS "userId",
              COALESCE(u.display_name, al.user_name, ('User #' || al.user_id)) AS "userName",
              al.action AS action,
              COUNT(*) AS "actionCount"
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${scopeClause}
       GROUP BY al.user_id, "userName", al.action
       ORDER BY "userName" ASC, "actionCount" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 4. Action-type totals across all staff (for the "by action type" tile/legend).
    const byAction = await sequelize.query(
      `SELECT al.action AS action, al.module AS module, COUNT(*) AS "actionCount"
       FROM audit_logs al
       WHERE ${scopeClause}
       GROUP BY al.action, al.module
       ORDER BY "actionCount" DESC`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    // 5. Chronological activity log — most recent first, capped. Scoped to the
    //    selected user when one is picked (this is the actual "see every action
    //    they did" drill-down), and includes the before/after value snapshot so
    //    an update/void/cancel action can be inspected in detail, not just named.
    const [countRow] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM audit_logs al WHERE ${userScopeClause}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );
    const totalLogCount = parseInt(countRow.total, 10) || 0;

    const activity = await sequelize.query(
      `SELECT al.id AS id,
              al.user_id AS "userId",
              COALESCE(u.display_name, al.user_name, ('User #' || al.user_id)) AS "userName",
              COALESCE(u.role, al.user_role, '—') AS "userRole",
              al.module AS module,
              al.action AS action,
              al.entity_type AS "entityType",
              al.entity_id AS "entityId",
              al.description AS description,
              al.old_values AS "oldValues",
              al.new_values AS "newValues",
              al.ip_address AS "ipAddress",
              al.status AS status,
              al.created_at AS "createdAt"
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${userScopeClause}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT :rowCap`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    res.json({
      period: { dateFrom, dateTo },
      clinicId,
      userId,
      totals: {
        totalActions: parseInt(totalsRow.totalActions, 10) || 0,
        activeStaffCount: parseInt(totalsRow.activeStaffCount, 10) || 0,
        mostActiveUser: mostActiveUserRow
          ? {
              userId: mostActiveUserRow.userId,
              userName: mostActiveUserRow.userName,
              actionCount: parseInt(mostActiveUserRow.actionCount, 10) || 0,
            }
          : null,
        mostCommonAction: mostCommonActionRow
          ? {
              action: mostCommonActionRow.action,
              actionCount: parseInt(mostCommonActionRow.actionCount, 10) || 0,
            }
          : null,
      },
      byUser: byUser.map(r => ({
        userId: r.userId,
        userName: r.userName,
        userRole: r.userRole,
        actionCount: parseInt(r.actionCount, 10) || 0,
        lastActionAt: r.lastActionAt,
      })),
      byUserAction: byUserAction.map(r => ({
        userId: r.userId,
        userName: r.userName,
        action: r.action,
        actionCount: parseInt(r.actionCount, 10) || 0,
      })),
      byAction: byAction.map(r => ({
        action: r.action,
        module: r.module,
        actionCount: parseInt(r.actionCount, 10) || 0,
      })),
      activity: {
        rows: activity,
        rowCap: ACTIVITY_ROW_CAP,
        totalCount: totalLogCount,
        truncated: totalLogCount > ACTIVITY_ROW_CAP,
      },
    });
  } catch (err) {
    console.error('Audit summary report error:', err);
    res.status(500).json({ error: 'Failed to generate audit summary report' });
  }
});

module.exports = router;

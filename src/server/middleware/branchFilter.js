/**
 * Branch-level data isolation helpers.
 *
 * Rules:
 *  - Admin users (role === 'admin') see ALL data across every branch.
 *  - Non-admin users MUST have a branch assigned (enforced by branchAccessControl).
 *  - Everyone else only sees rows that match their branch_id.
 *
 * Usage in a route:
 *   const { getBranchCondition, getBranchConditionSQL } = require('../middleware/branchFilter');
 *
 *   // Sequelize where-clause helper
 *   const where = { ...getBranchCondition(req), status: 'active' };
 *   const rows = await Model.findAll({ where });
 *
 *   // Raw SQL helper
 *   const { sql: branchSQL, params } = getBranchConditionSQL(req, 'p');
 *   const query = `SELECT * FROM patients p WHERE 1=1 ${branchSQL}`;
 */

/**
 * Returns a Sequelize-compatible where fragment { branch_id: X } or {}.
 * Merge this into your where clause.
 */
function getBranchCondition(req) {
  if (!req.user) return {};
  if (req.user.role === 'admin') return {};
  // Prefer branchContext (DB-resolved by branchAccessControl) over JWT branchId
  const branchId = req.branchContext?.branchId || req.user.branchId || null;
  // branchAccessControl already blocks unassigned users — null here means admin fallback only
  if (!branchId) return {};
  return { branch_id: branchId };
}

/**
 * Returns a raw-SQL fragment and replacement params for branch filtering.
 * @param {object} req  - Express request (must have req.user)
 * @param {string} alias - Table alias, e.g. 'p' for `patients p`
 * @returns {{ sql: string, params: any[] }}
 */
function getBranchConditionSQL(req, alias = '') {
  if (!req.user) return { sql: '', params: [] };
  if (req.user.role === 'admin') return { sql: '', params: [] };
  // Prefer branchContext (DB-resolved by branchAccessControl) over JWT branchId
  const branchId = req.branchContext?.branchId || req.user.branchId || null;
  // branchAccessControl already blocks unassigned users — null here means admin fallback only
  if (!branchId) return { sql: '', params: [] };
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return { sql: ` AND ${col} = ?`, params: [branchId] };
}

/**
 * Returns the branch_id to stamp on newly created records.
 * Falls back to null if admin or unassigned.
 */
function getCreateBranchId(req) {
  if (!req.user) return null;
  return req.branchContext?.branchId || req.user.branchId || null;
}

module.exports = { getBranchCondition, getBranchConditionSQL, getCreateBranchId };

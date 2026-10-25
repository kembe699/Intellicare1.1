/**
 * Visit counts for dashboards and reports.
 *
 * A visit is an LIS encounter: one lis_test_orders row per patient visit,
 * written by registration/queueing (POST /lis/participants, /lis/orders). The
 * old `visits` table is legacy and barely written any more, so reading it made
 * "visits today" show 0 while the day was full of patients. It is used only as
 * a fallback, for a period in which LIS recorded no visits at all (a tenant, or
 * history, from before LIS).
 *
 * lis_test_orders.clinic_id is the consulting clinic (a dr_clinics UUID), not
 * the facility; each tenant schema is one facility, so a per-facility
 * breakdown attributes LIS visits to the facility the report is run for.
 */

/** Total visits in [from, to]. Returns { total, source: 'lis' | 'legacy' }. */
async function countVisits(sequelize, { from, to, branchId = null, transaction } = {}) {
  const replacements = { from, to, branchId };
  const branch = branchId ? ' AND branch_id = :branchId' : '';
  const [[lis]] = await sequelize.query(
    `SELECT COUNT(*)::int AS n FROM lis_test_orders WHERE created_at BETWEEN :from AND :to${branch}`,
    { replacements, transaction });
  if ((lis?.n || 0) > 0) return { total: lis.n, source: 'lis' };
  try {
    const [[legacy]] = await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM visits WHERE visit_date BETWEEN :from AND :to${branch}`,
      { replacements, transaction });
    return { total: legacy?.n || 0, source: 'legacy' };
  } catch {
    return { total: 0, source: 'lis' }; // no legacy table in this tenant
  }
}

/**
 * Visits per facility (clinic_names.id) in [from, to], as a Map. LIS visits all
 * belong to `facilityClinicId`; the legacy table, when it is the fallback, is
 * grouped by its own clinic_id.
 */
async function visitsByFacility(sequelize, { from, to, branchId = null, facilityClinicId = 1 } = {}) {
  const { total, source } = await countVisits(sequelize, { from, to, branchId });
  if (source === 'lis') return new Map(total ? [[parseInt(facilityClinicId, 10) || 1, total]] : []);
  const branch = branchId ? ' AND branch_id = :branchId' : '';
  try {
    const [rows] = await sequelize.query(
      `SELECT clinic_id, COUNT(*)::int AS n FROM visits WHERE visit_date BETWEEN :from AND :to${branch} GROUP BY clinic_id`,
      { replacements: { from, to, branchId } });
    return new Map(rows.map((r) => [parseInt(r.clinic_id, 10), r.n]));
  } catch {
    return new Map();
  }
}

module.exports = { countVisits, visitsByFacility };

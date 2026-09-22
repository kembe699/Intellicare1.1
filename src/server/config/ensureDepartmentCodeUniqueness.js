/**
 * departments has the identical bug shape as inventory_items (see
 * ensureInventoryItemCodeUniqueness.js): a unique constraint on
 * (department_code, clinic_id) — migrateDepartments.js's
 * `unique_dept_code_clinic` — which, since clinic_id is always 1 in this
 * schema-per-tenant app, actually blocks two different branches from ever
 * using the same department_code. Widens it to
 * (department_code, clinic_id, branch_id).
 *
 * Same idempotent, per-tenant self-migration shape as
 * ensureInpatientBedUniqueness.js / ensureInventoryItemCodeUniqueness.js —
 * see tenantDb.js's buildTenantConnection for why this runs per tenant
 * connection. Constraint names aren't assumed (looked up via
 * information_schema), and existing conflicting rows are checked for and
 * logged rather than letting the ALTER fail and crash tenant startup.
 */
async function ensureDepartmentCodeUniqueness(sequelize, label = 'database') {
  try {
    const [[tableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'departments'`
    );
    if (Number(tableCheck.cnt) === 0) return;

    const [[colCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'departments' AND column_name = 'branch_id'`
    );
    if (Number(colCheck.cnt) === 0) return; // branch_id migration hasn't reached this tenant yet

    const [constraints] = await sequelize.query(`
      SELECT tc.constraint_name AS name,
             array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_schema = current_schema()
        AND tc.table_name = 'departments'
        AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
    `);

    const sameCols = (cols, expected) =>
      Array.isArray(cols) && cols.length === expected.length &&
      expected.every(c => cols.includes(c));

    const alreadyFixed = constraints.find(c => sameCols(c.cols, ['department_code', 'clinic_id', 'branch_id']));
    if (alreadyFixed) return;

    const oldConstraint = constraints.find(c => sameCols(c.cols, ['department_code', 'clinic_id']));

    const [conflicts] = await sequelize.query(`
      SELECT clinic_id, branch_id, department_code, COUNT(*) AS cnt
      FROM departments
      WHERE branch_id IS NOT NULL
      GROUP BY clinic_id, branch_id, department_code
      HAVING COUNT(*) > 1
    `);
    if (conflicts.length > 0) {
      console.warn(
        `⚠️  [${label}] Skipping departments (department_code, clinic_id, branch_id) uniqueness fix — ` +
        `${conflicts.length} existing department_code conflict(s) within the same branch (e.g. clinic ${conflicts[0].clinic_id}, ` +
        `branch ${conflicts[0].branch_id}, department_code "${conflicts[0].department_code}"). Resolve these duplicates manually, then this will apply on the next connection.`
      );
      return;
    }

    if (oldConstraint) {
      await sequelize.query(`ALTER TABLE departments DROP CONSTRAINT "${oldConstraint.name}"`);
    }
    await sequelize.query(`ALTER TABLE departments ADD CONSTRAINT unique_dept_code_clinic_branch UNIQUE (department_code, clinic_id, branch_id)`);
    console.log(`✅ [${label}] departments department_code uniqueness widened to (department_code, clinic_id, branch_id)`);
  } catch (e) {
    console.warn(`[${label}] departments uniqueness migration warning:`, e.message);
  }
}

module.exports = { ensureDepartmentCodeUniqueness };

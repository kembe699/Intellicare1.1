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
 * connection.
 *
 * Looks at pg_index directly, not information_schema.table_constraints —
 * the latter only reports NAMED constraints, missing a bare
 * `CREATE UNIQUE INDEX` with no backing constraint (found on production:
 * `departments_department_code_clinic_id_idx`, old-shaped, never created by
 * anything in this codebase — same leftover-ORM-sync-era shape as
 * inventory_items' equivalent). Every old-shaped match is dropped, not just
 * the first, using DROP CONSTRAINT for a named one (the only form Postgres
 * accepts for a constraint-backed index — confirmed against a real tenant)
 * or plain DROP INDEX for a bare one.
 *
 * Existing conflicting rows are checked for and logged rather than letting
 * the ALTER fail and crash tenant startup.
 */
async function getNonPrimaryUniqueIndexes(sequelize, table) {
  // string_agg + split, not array_agg — see ensureSchemeUniqueness.js's identical helper
  // for why: Sequelize's raw query path here never runs the pg array-type parser on an
  // array_agg() result, so it comes back as a literal string, not a JS array.
  const [rows] = await sequelize.query(`
    SELECT ic.relname AS index_name,
           string_agg(a.attname, ',' ORDER BY x.n) AS cols
    FROM pg_index ix
    JOIN pg_class ic ON ic.oid = ix.indexrelid
    JOIN pg_class tc ON tc.oid = ix.indrelid
    JOIN pg_namespace ns ON ns.oid = tc.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true
    JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = x.attnum
    WHERE tc.relname = :table
      AND ns.nspname = current_schema()
      AND ix.indisunique = true
      AND ix.indisprimary = false
    GROUP BY ic.relname
  `, { replacements: { table } });
  return rows.map((r) => ({ index_name: r.index_name, cols: r.cols.split(',') }));
}

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

    const sameCols = (cols, expected) =>
      Array.isArray(cols) && cols.length === expected.length &&
      expected.every((c) => cols.includes(c));

    const indexes = await getNonPrimaryUniqueIndexes(sequelize, 'departments');
    const oldMatches = indexes.filter((ix) => sameCols(ix.cols, ['department_code', 'clinic_id']));
    const alreadyWidened = indexes.some((ix) => sameCols(ix.cols, ['department_code', 'clinic_id', 'branch_id']));
    if (oldMatches.length === 0) return;

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

    const [namedConstraints] = await sequelize.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = current_schema() AND table_name = 'departments' AND constraint_type = 'UNIQUE'
    `);
    const constraintNames = new Set(namedConstraints.map((c) => c.constraint_name));
    for (const ix of oldMatches) {
      if (constraintNames.has(ix.index_name)) {
        await sequelize.query(`ALTER TABLE departments DROP CONSTRAINT "${ix.index_name}"`);
      } else {
        await sequelize.query(`DROP INDEX "${ix.index_name}"`);
      }
    }
    if (!alreadyWidened) {
      await sequelize.query(`ALTER TABLE departments ADD CONSTRAINT unique_dept_code_clinic_branch UNIQUE (department_code, clinic_id, branch_id)`);
    }
    console.log(`✅ [${label}] departments department_code uniqueness widened to (department_code, clinic_id, branch_id)`);
  } catch (e) {
    console.warn(`[${label}] departments uniqueness migration warning:`, e.message);
  }
}

module.exports = { ensureDepartmentCodeUniqueness };

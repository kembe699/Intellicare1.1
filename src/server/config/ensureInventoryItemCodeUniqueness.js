/**
 * inventory_items has a unique constraint on (clinic_id, item_code) — see
 * migrateInventoryTables.js's `unique_inv_clinic_code`. Since clinic_id is
 * always 1 in this schema-per-tenant app (one clinic per tenant), that
 * constraint actually enforces uniqueness of item_code ACROSS THE WHOLE
 * TENANT, not per branch — so Branch B can never create "PARA-500" once
 * Branch A already has it, even though inventory_items is otherwise fully
 * branch-isolated (branch_id column, branch-filtered list route). The fix is
 * to widen the constraint to (clinic_id, branch_id, item_code).
 *
 * Same idempotent, per-tenant self-migration shape as
 * ensureInpatientBedUniqueness.js — see tenantDb.js's buildTenantConnection
 * for why this runs per tenant connection rather than once at boot.
 *
 * Constraint names aren't assumed — a given tenant's constraint may have
 * been auto-renamed or never created under `unique_inv_clinic_code` at all,
 * so the actual name is looked up via information_schema before dropping it.
 *
 * Existing rows are checked for conflicts before the new constraint is
 * added: if two rows already share (clinic_id, branch_id, item_code) with a
 * non-NULL branch_id (Postgres already allows multiple NULLs under a UNIQUE
 * constraint, so NULL-branch rows can never conflict with each other), the
 * new constraint would fail to apply — this is logged as a warning and the
 * constraint is skipped for that tenant rather than crashing its connection,
 * matching the "never let a startup migration fail wandering app startup"
 * convention used everywhere else in this codebase.
 */
async function ensureInventoryItemCodeUniqueness(sequelize, label = 'database') {
  try {
    const [[tableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'inventory_items'`
    );
    if (Number(tableCheck.cnt) === 0) return; // table doesn't exist in this tenant/version yet

    const [[colCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inventory_items' AND column_name = 'branch_id'`
    );
    if (Number(colCheck.cnt) === 0) return; // branch_id migration hasn't reached this tenant yet — retried on next connection build

    // Find every UNIQUE constraint currently on inventory_items and the
    // column set each one covers, so we can recognize the old
    // (clinic_id, item_code) shape and the new (clinic_id, branch_id,
    // item_code) shape regardless of what they're actually named.
    const [constraints] = await sequelize.query(`
      SELECT tc.constraint_name AS name,
             array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_schema = current_schema()
        AND tc.table_name = 'inventory_items'
        AND tc.constraint_type = 'UNIQUE'
      GROUP BY tc.constraint_name
    `);

    const sameCols = (cols, expected) =>
      Array.isArray(cols) && cols.length === expected.length &&
      expected.every(c => cols.includes(c));

    const alreadyFixed = constraints.find(c => sameCols(c.cols, ['clinic_id', 'branch_id', 'item_code']));
    if (alreadyFixed) return; // a prior run (or manual fix) already widened this constraint

    const oldConstraint = constraints.find(c => sameCols(c.cols, ['clinic_id', 'item_code']));

    // Conflict check: would (clinic_id, branch_id, item_code) actually be
    // unique across existing rows? Only non-NULL branch_id rows can
    // conflict — Postgres permits any number of NULLs under a UNIQUE
    // constraint.
    const [conflicts] = await sequelize.query(`
      SELECT clinic_id, branch_id, item_code, COUNT(*) AS cnt
      FROM inventory_items
      WHERE branch_id IS NOT NULL
      GROUP BY clinic_id, branch_id, item_code
      HAVING COUNT(*) > 1
    `);
    if (conflicts.length > 0) {
      console.warn(
        `⚠️  [${label}] Skipping inventory_items (clinic_id, branch_id, item_code) uniqueness fix — ` +
        `${conflicts.length} existing item_code conflict(s) within the same branch (e.g. clinic ${conflicts[0].clinic_id}, ` +
        `branch ${conflicts[0].branch_id}, item_code "${conflicts[0].item_code}"). Resolve these duplicates manually, then this will apply on the next connection.`
      );
      return;
    }

    if (oldConstraint) {
      await sequelize.query(`ALTER TABLE inventory_items DROP CONSTRAINT "${oldConstraint.name}"`);
    }
    await sequelize.query(`ALTER TABLE inventory_items ADD CONSTRAINT unique_inv_clinic_branch_code UNIQUE (clinic_id, branch_id, item_code)`);
    console.log(`✅ [${label}] inventory_items item_code uniqueness widened to (clinic_id, branch_id, item_code)`);
  } catch (e) {
    console.warn(`[${label}] inventory_items uniqueness migration warning:`, e.message);
  }
}

module.exports = { ensureInventoryItemCodeUniqueness };

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
 * Looks at pg_index directly (not information_schema.table_constraints),
 * because table_constraints only reports NAMED constraints — a bare
 * `CREATE UNIQUE INDEX` with no backing constraint (found on production:
 * `inventory_items_clinic_id_item_code_idx`, old-shaped, never created by
 * anything in this codebase, presumably a leftover from an earlier ORM-sync
 * era) is invisible to it. An earlier version of this file used
 * table_constraints and `.find()` (first match only) — it correctly dropped
 * the NAMED old constraint but had no way to see, and so never dropped, a
 * second bare old-shaped index sitting right next to it, which kept
 * silently enforcing tenant-wide uniqueness even after this "fix" had
 * supposedly already run. All old-shaped matches are now dropped, not just
 * the first.
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
async function getNonPrimaryUniqueIndexes(sequelize, table) {
  // string_agg + split, not array_agg — Sequelize's raw query path doesn't run the pg
  // array-type parser on an array_agg() result here, so it comes back as the literal
  // string "{clinic_id,item_code}" instead of a JS array (same gotcha documented in
  // ensureSchemeUniqueness.js, found the same way — by testing against a real tenant).
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

    const sameCols = (cols, expected) =>
      Array.isArray(cols) && cols.length === expected.length &&
      expected.every((c) => cols.includes(c));

    const indexes = await getNonPrimaryUniqueIndexes(sequelize, 'inventory_items');
    const oldMatches = indexes.filter((ix) => sameCols(ix.cols, ['clinic_id', 'item_code']));
    const alreadyWidened = indexes.some((ix) => sameCols(ix.cols, ['clinic_id', 'branch_id', 'item_code']));
    if (oldMatches.length === 0) return; // nothing in the old shape left to widen (or already fixed)

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

    // A unique index backing a NAMED constraint can't be dropped with plain DROP INDEX —
    // Postgres rejects it ("cannot drop index X because constraint X ... requires it",
    // confirmed against a real tenant) — it has to go through DROP CONSTRAINT instead. A
    // bare index (no backing constraint, e.g. the leftover inventory_items_clinic_id_item_
    // code_idx this file exists to clean up) takes plain DROP INDEX. Every old-shaped match
    // is dropped, not just the first, using whichever form it actually needs.
    const [namedConstraints] = await sequelize.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = current_schema() AND table_name = 'inventory_items' AND constraint_type = 'UNIQUE'
    `);
    const constraintNames = new Set(namedConstraints.map((c) => c.constraint_name));
    for (const ix of oldMatches) {
      if (constraintNames.has(ix.index_name)) {
        await sequelize.query(`ALTER TABLE inventory_items DROP CONSTRAINT "${ix.index_name}"`);
      } else {
        await sequelize.query(`DROP INDEX "${ix.index_name}"`);
      }
    }
    if (!alreadyWidened) {
      await sequelize.query(`ALTER TABLE inventory_items ADD CONSTRAINT unique_inv_clinic_branch_code UNIQUE (clinic_id, branch_id, item_code)`);
    }
    console.log(`✅ [${label}] inventory_items item_code uniqueness widened to (clinic_id, branch_id, item_code)`);
  } catch (e) {
    console.warn(`[${label}] inventory_items uniqueness migration warning:`, e.message);
  }
}

module.exports = { ensureInventoryItemCodeUniqueness };

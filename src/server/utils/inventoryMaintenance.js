// One-time-per-database repair: items auto-created by the GRN-accept flow
// (procurement.js) and the CSV bulk-import flow (inventory.js) before those
// paths stamped branch_id on insert are invisible to any non-admin,
// branch-scoped user — GET /api/inventory/items and GET /api/pharmacy/drugs
// both filter with `i.branch_id = :branchId`, and NULL never satisfies that,
// so the item silently disappears from Item Master/Pharmacy for everyone
// except admins (branchFilter.js gives 'admin' an unconditional bypass).
//
// This used to run only once, at server boot, against the single default
// database — before this app became multi-tenant (see tenantDb.js), that WAS
// every database there was. Now each client gets its own separate MySQL
// database via getTenantConnection(), and this repair was never wired into
// that path, so it silently never ran for any tenant except whichever one
// happens to be the default/demo connection. Every other tenant — including
// ones auto-provisioned with zero starting data — was permanently exposed to
// this bug the moment a GRN or CSV import created its first orphaned item,
// with no code path that would ever clean it up. Call this once per tenant
// connection (see tenantDb.js's buildTenantConnection) as well as once for
// the default connection (inventory.js's boot IIFE) to close that gap.
async function backfillInventoryBranchIds(sequelize, label = 'database') {
  try {
    const [[{ cnt: orphanCountRaw }]] = await sequelize.query(
      "SELECT COUNT(*) as cnt FROM inventory_items WHERE branch_id IS NULL"
    );
    // Postgres COUNT(*) comes back as the string "0" (bigint), which is
    // truthy in JS — `if (!orphanCount) return` on the raw string never
    // actually short-circuited.
    const orphanCount = Number(orphanCountRaw);
    if (orphanCount === 0) return;

    const [branches] = await sequelize.query('SELECT id FROM branches WHERE is_active = true');
    if (branches.length === 1) {
      await sequelize.query('UPDATE inventory_items SET branch_id = :bid WHERE branch_id IS NULL', {
        replacements: { bid: branches[0].id },
      });
      console.log(`✅ [${label}] Backfilled branch_id on ${orphanCount} inventory_items (single-branch deployment, branch ${branches[0].id})`);
    } else {
      console.warn(`⚠️  [${label}] ${orphanCount} inventory_items have no branch_id and this deployment has ${branches.length} branches — skipping auto-backfill (ambiguous). These items are invisible to non-admin branch-scoped users in Item Master/Pharmacy until manually assigned a branch.`);
    }
  } catch (e) {
    console.warn(`Could not backfill inventory_items.branch_id for ${label}:`, e.message);
  }
}

// General-purpose version of the same repair, for the LIS/Inpatient/Accounting/
// Procurement tables ensureBranchIsolationColumns.js just added branch_id to.
// Same reasoning as backfillInventoryBranchIds above: a tenant with exactly one
// active branch has no real ambiguity (every pre-existing row belongs to it by
// definition, since no other branch existed yet), so it's safe to auto-backfill.
// A tenant with more than one active branch is left alone — guessing which
// branch an old accounting/procurement/inpatient record belongs to would risk
// misattributing real financial/clinical history, so those are surfaced as a
// warning for a human to resolve instead.
async function backfillBranchIds(sequelize, schema, tables) {
  try {
    const [branches] = await sequelize.query('SELECT id FROM branches WHERE is_active = true');
    for (const table of tables) {
      try {
        // Same Postgres-COUNT-returns-a-string gotcha as ensureBranchIsolationColumns.js
        // — every check below is an explicit Number() comparison because of it.
        const [[tableCheck]] = await sequelize.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table`,
          { replacements: { table } }
        );
        if (Number(tableCheck.cnt) === 0) continue;

        const [[colCheck]] = await sequelize.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = 'branch_id'`,
          { replacements: { table } }
        );
        if (Number(colCheck.cnt) === 0) continue; // migration hasn't reached this tenant/table yet

        const [[{ cnt: orphanCountRaw }]] = await sequelize.query(
          `SELECT COUNT(*) as cnt FROM ${table} WHERE branch_id IS NULL`
        );
        const orphanCount = Number(orphanCountRaw);
        if (orphanCount === 0) continue;

        if (branches.length === 1) {
          await sequelize.query(`UPDATE ${table} SET branch_id = :bid WHERE branch_id IS NULL`, {
            replacements: { bid: branches[0].id },
          });
          console.log(`✅ [${schema}] Backfilled branch_id on ${orphanCount} ${table} rows (single-branch deployment, branch ${branches[0].id})`);
        } else {
          console.warn(`⚠️  [${schema}] ${orphanCount} ${table} rows have no branch_id and this deployment has ${branches.length} branches — skipping auto-backfill (ambiguous). Assign these a branch manually.`);
        }
      } catch (e) {
        console.warn(`Could not backfill ${table}.branch_id for ${schema}:`, e.message);
      }
    }
  } catch (e) {
    console.warn(`Could not backfill branch_id for ${schema}:`, e.message);
  }
}

module.exports = { backfillInventoryBranchIds, backfillBranchIds };

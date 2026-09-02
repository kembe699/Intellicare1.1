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
    const [[{ cnt: orphanCount }]] = await sequelize.query(
      "SELECT COUNT(*) as cnt FROM inventory_items WHERE branch_id IS NULL"
    );
    if (!orphanCount) return;

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

module.exports = { backfillInventoryBranchIds };

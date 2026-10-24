/**
 * approval_permissions.sole_approver per tenant. routes/approvals.js only
 * added it on the default connection at module load, so tenants other than
 * the default never got it and the expense / supplier-bill approval chain
 * failed with "column sole_approver does not exist" (found on production:
 * demo, dpoc, gudele). Additive, defaults to false — nobody becomes a sole
 * approver by this. Also the optional daily_expenses.supplier_id/_name.
 */
async function ensureApprovalPermissionColumns(db) {
  const [[t]] = await db.query(`SELECT to_regclass(current_schema() || '.approval_permissions') IS NOT NULL AS ok`);
  if (t?.ok) await db.query(`ALTER TABLE approval_permissions ADD COLUMN IF NOT EXISTS sole_approver BOOLEAN NOT NULL DEFAULT FALSE`);

  // Optional supplier on a daily expense (Record Daily Expense › Supplier).
  // Same per-tenant reason as above: daily-expenses.js's own ensureColumn
  // calls only ever reach the default connection.
  const [[d]] = await db.query(`SELECT to_regclass(current_schema() || '.daily_expenses') IS NOT NULL AS ok`);
  if (d?.ok) {
    await db.query(`ALTER TABLE daily_expenses ADD COLUMN IF NOT EXISTS supplier_id INTEGER`);
    await db.query(`ALTER TABLE daily_expenses ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255)`);
  }
}

module.exports = { ensureApprovalPermissionColumns };

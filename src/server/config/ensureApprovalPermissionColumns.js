/**
 * approval_permissions.sole_approver per tenant. routes/approvals.js only
 * added it on the default connection at module load, so tenants other than
 * the default never got it and the expense / supplier-bill approval chain
 * failed with "column sole_approver does not exist" (found on production:
 * demo, dpoc, gudele). Additive, defaults to false — nobody becomes a sole
 * approver by this.
 */
async function ensureApprovalPermissionColumns(db) {
  const [[t]] = await db.query(`SELECT to_regclass(current_schema() || '.approval_permissions') IS NOT NULL AS ok`);
  if (!t?.ok) return;
  await db.query(`ALTER TABLE approval_permissions ADD COLUMN IF NOT EXISTS sole_approver BOOLEAN NOT NULL DEFAULT FALSE`);
}

module.exports = { ensureApprovalPermissionColumns };

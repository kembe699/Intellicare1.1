// Adds branch_id to every transactional table that's missing it, so LIS,
// Inpatient, Accounting, and Procurement records can finally be scoped by
// branch the same way patients/bills/receipts/lab requests already are (see
// middleware/branchFilter.js). Deliberately excludes master/catalog/config
// tables (chart_of_accounts, exchange_rates, suppliers, procurement_settings,
// lab_tests) — isolating those would fragment a facility's shared ledger
// structure, price lists, and vendor directory instead of protecting real
// per-branch data.
//
// Same idempotent, MySQL/Postgres-safe pattern already proven in index.js's
// own `tablesNeedingBranchId` loop (information_schema checks before ALTER,
// one table's failure doesn't block the rest) — see the comment there for
// why "ADD COLUMN IF NOT EXISTS" isn't used directly. Called once per tenant
// from tenantDb.js's buildTenantConnection, the same way ensureHRTables.js
// and friends are.
const TABLES_NEEDING_BRANCH_ID = [
  // LIS
  'lis_participants', 'lis_test_orders', 'lis_specimens', 'lis_specimen_qc', 'lis_results',
  // Inpatient
  'wards', 'rooms', 'beds', 'inpatient_admissions',
  'inpatient_prescriptions', 'inpatient_lab_requests', 'inpatient_radiology_requests',
  // Accounting (transactional only — chart_of_accounts/exchange_rates stay shared)
  'journal_entries', 'journal_entry_lines', 'account_ledger', 'patient_receivables',
  'credit_notes', 'cash_transfers', 'cashier_shifts', 'daily_expenses', 'daily_expense_approvals',
  'expense_invoices', 'expense_invoice_lines',
  // Procurement (transactional only — suppliers/procurement_settings stay shared)
  'purchase_requisitions', 'pr_line_items', 'purchase_orders', 'purchase_order_items',
  'goods_receipt_notes', 'grn_line_items', 'supplier_bill_approvals', 'supplier_bill_payments',
];

async function ensureBranchIsolationColumns(sequelize, label = 'database') {
  let added = 0;
  for (const tbl of TABLES_NEEDING_BRANCH_ID) {
    try {
      // Postgres COUNT(*) comes back as the string "0"/"1" (bigint, not a JS
      // number, to avoid precision loss) — "0" is truthy in JS, so a bare
      // `if (x.cnt)` silently does the opposite of what it looks like. Every
      // check here is an explicit Number() comparison because of that.
      const [[tableCheck]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :tbl`,
        { replacements: { tbl } }
      );
      if (Number(tableCheck.cnt) === 0) continue; // table doesn't exist in this tenant/version

      const [[colCheck]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :tbl AND column_name = 'branch_id'`,
        { replacements: { tbl } }
      );
      if (Number(colCheck.cnt) > 0) continue; // already has it

      await sequelize.query(`ALTER TABLE ${tbl} ADD COLUMN branch_id INTEGER NULL`);

      const idxName = `idx_${tbl.replace(/_/g, '')}_branch`;
      const [[idxCheck]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = :tbl AND indexname = :idx`,
        { replacements: { tbl, idx: idxName } }
      );
      if (Number(idxCheck.cnt) === 0) {
        await sequelize.query(`CREATE INDEX ${idxName} ON ${tbl}(branch_id)`);
      }
      added++;
    } catch (e) {
      console.warn(`[${label}] branch_id migration warning for ${tbl}:`, e.message);
    }
  }
  if (added > 0) {
    console.log(`✅ [${label}] branch_id added to ${added} table(s) (LIS/Inpatient/Accounting/Procurement)`);
  }
}

module.exports = { ensureBranchIsolationColumns, TABLES_NEEDING_BRANCH_ID };

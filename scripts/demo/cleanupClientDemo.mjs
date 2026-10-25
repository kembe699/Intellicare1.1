// Removes the client-demo dataset seeded by seedClientDemo.mjs (and correctDemoLedger.mjs) from the
// demo tenant — and nothing else. DRY RUN BY DEFAULT: everything runs inside one transaction that is
// rolled back, printing what would be removed per table. --apply --confirm=tenant_demo commits it.
//
// Why SQL and not the API: the app deliberately cannot delete posted ledger entries, paid bills or
// receipts. Every row removed is identified from the seed's own records — the ids in
// scripts/demo/.demo-state.json, the demo users (@intellicare-demo.ss), notes/refs tagged
// "DEMO DATA" — and the rows that reference them. Data that existed before the seed (the catalogue's
// services and lab tests, CIC Insurance, the chart of accounts, other users) is left alone.
//
//   DATABASE_URL=postgres://… node scripts/demo/cleanupClientDemo.mjs                 # dry run
//   DATABASE_URL=postgres://… node scripts/demo/cleanupClientDemo.mjs --apply --confirm=tenant_demo
//
// Not reverted automatically (listed at the end of every run): CIC's credit settings, the Night
// shift's new hours, the categories re-saved, privileges granted to existing roles, the demo admin's
// password, document-number counters (numbering just continues), and the admin's own Analytics
// Assistant conversations.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { HERE, TAG } from './lib.mjs';

const require = createRequire(path.resolve(HERE, '../../src/server/package.json'));
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const SCHEMA = process.env.DEMO_SCHEMA || 'tenant_demo';
if (APPLY && !process.argv.includes(`--confirm=${SCHEMA}`)) {
  console.error(`--apply also needs --confirm=${SCHEMA}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1); }
const host = new URL(process.env.DATABASE_URL).hostname;
const local = ['localhost', '127.0.0.1'].includes(host);
// Only the demo tenant, except against a local database (for testing the SQL).
if (SCHEMA !== 'tenant_demo' && !local) { console.error('Only tenant_demo can be cleaned on a remote database.'); process.exit(1); }

const STATE_FILE = path.join(HERE, '.demo-state.json');
if (!fs.existsSync(STATE_FILE)) { console.error(`No ${STATE_FILE} — nothing identifies the seeded data.`); process.exit(1); }
const S = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
const ids = (...v) => v.flat().filter((x) => x !== undefined && x !== null && x !== '').map(String);

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: local ? undefined : { rejectUnauthorized: false }, query_timeout: 120000 });
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const col = async (sql, params) => (await q(sql, params)).map((r) => String(Object.values(r)[0]));
const removed = [];
async function del(table, where, params) {
  const [{ exists }] = await q(`SELECT to_regclass($1) IS NOT NULL AS exists`, [`${SCHEMA}.${table}`]);
  if (!exists) return 0;
  const r = await c.query(`DELETE FROM "${table}" WHERE ${where}`, params);
  if (r.rowCount) removed.push([table, r.rowCount]);
  return r.rowCount;
}
const ANY = (n) => `::text = ANY($${n}::text[])`;

async function run() {
  await c.query(`SET LOCAL search_path TO "${SCHEMA}", public`);
  await c.query(`SET LOCAL lock_timeout = '20s'`);

  // ── what the seed created ──
  const users = ids(Object.values(S.users || {}).map((u) => u.id), await col(`SELECT id FROM users WHERE email LIKE '%@intellicare-demo.ss'`));
  const [{ start }] = await q(`SELECT MIN(created_at) AS start FROM users WHERE id${ANY(1)}`, [users]);
  if (!start) throw new Error('Demo users not found — has this tenant been seeded?');
  // When the seed ran: first demo user created → last step it completed (+5 min). Activity the
  // seed caused under existing accounts (the admin's audit trail, roster notifications) falls in it.
  const seedEnd = new Date(Math.max(...Object.values(S.done || {}).map((t) => Date.parse(t)).filter(Number.isFinite)) + 5 * 60000);
  const patients = ids(S.p1?.id, S.p2?.id, await col(`SELECT id FROM lis_participants WHERE study_ref = $1`, [TAG]));
  const bills = await col(`SELECT id FROM patient_bills WHERE patient_id${ANY(1)}`, [patients]);
  const receipts = await col(`SELECT id FROM receipts WHERE bill_id${ANY(1)}`, [bills]);
  const invoices = await col(`SELECT id FROM invoices WHERE bill_id${ANY(1)}`, [bills]);
  const claims = await col(`SELECT DISTINCT claim_id FROM insurance_batch_claim_items WHERE invoice_id${ANY(1)} OR bill_id${ANY(2)}`, [invoices, bills]);
  const orders = await col(`SELECT id FROM lis_test_orders WHERE participant_id${ANY(1)}`, [patients]);
  const specimens = await col(`SELECT id FROM lis_specimens WHERE order_id${ANY(1)}`, [orders]);
  const rxs = await col(`SELECT id FROM pharmacy_prescriptions WHERE patient_id${ANY(1)}`, [patients]);
  const dispensings = await col(`SELECT id FROM dispensing_records WHERE patient_id${ANY(1)}`, [patients]);
  const dispensingNumbers = await col(`SELECT dispensing_number FROM dispensing_records WHERE id${ANY(1)}`, [dispensings]);
  const transfers = await col(`SELECT id FROM cash_transfers WHERE notes LIKE $1`, [`%${TAG}%`]);
  const expenses = ids(S.expense?.id, await col(`SELECT id FROM daily_expenses WHERE notes LIKE $1`, [`%${TAG}%`]));
  const items = ids(Object.values(S.items || {}));
  const employees = ids(Object.values(S.employees || {}).map((e) => e.id));
  const rosters = await col(`SELECT id FROM duty_rosters WHERE created_by${ANY(1)}`, [users]);
  const jes = await col(`SELECT id FROM journal_entries WHERE reference = ANY($1::text[]) OR reference LIKE 'DEMO-%'`,
    [[...receipts.map((r) => `RCP-${r}`), ...transfers.map((t) => `CT-${t}`)]]);
  const jeNumbers = await col(`SELECT je_number FROM journal_entries WHERE id${ANY(1)}`, [jes]);
  const glRefs = ids(bills, receipts, claims, dispensings, expenses, jes, S.grn?.id, S.supplierPayment?.id, S.po?.id);
  const gls = await col(`SELECT id FROM general_ledger WHERE reference_id${ANY(1)}`, [glRefs]);
  const ownServices = ids(S.services?.specialist, S.services?.rdt, S.services?.rbs);
  const ownLabTests = ids(Object.values(S.labTests || {}));

  // ── ledger ──
  await del('account_ledger', `transaction_id${ANY(1)} OR reference_number${ANY(2)}`, [gls, jeNumbers]);
  await del('gl_line_items', `gl_id${ANY(1)}`, [gls]);
  await del('journal_entry_lines', `je_id${ANY(1)}`, [jes]);
  await del('journal_entries', `id${ANY(1)}`, [jes]);
  await del('pharmacy_charges', `patient_id${ANY(1)}`, [patients]);
  await del('receipts', `id${ANY(1)}`, [receipts]);
  await del('general_ledger', `id${ANY(1)}`, [gls]);

  // ── insurance: claim, invoice ──
  await del('insurance_batch_claim_status_history', `claim_id${ANY(1)}`, [claims]);
  await del('insurance_batch_claim_items', `claim_id${ANY(1)}`, [claims]);
  await del('insurance_batch_claims', `id${ANY(1)}`, [claims]);
  await del('invoice_items', `invoice_id${ANY(1)}`, [invoices]);
  await del('invoices', `id${ANY(1)}`, [invoices]);

  // ── clinical ──
  await del('lis_results', `specimen_id${ANY(1)}`, [specimens]);
  await del('lis_specimens', `id${ANY(1)}`, [specimens]);
  await del('visit_diagnoses', `order_id${ANY(1)} OR participant_id${ANY(2)}`, [orders, patients]);
  await del('nursing_procedures', `participant_id${ANY(1)} OR order_id${ANY(2)}`, [patients, orders]);
  await del('lab_requests', `patient_id${ANY(1)}`, [patients]);
  await del('patient_queue', `patient_id${ANY(1)}`, [patients]);
  await del('dispensing_records', `id${ANY(1)}`, [dispensings]);
  await del('pharmacy_audit_log', `reference_id${ANY(1)}`, [ids(rxs, dispensings, dispensingNumbers)]);
  await del('prescription_lines', `prescription_id${ANY(1)}`, [rxs]);
  await del('pharmacy_prescriptions', `id${ANY(1)}`, [rxs]);
  await del('scheme_membership', `patient_id${ANY(1)}`, [patients]);
  await del('patient_bills', `id${ANY(1)}`, [bills]);
  await del('lis_test_orders', `id${ANY(1)}`, [orders]);
  await del('lis_participants', `id${ANY(1)}`, [patients]);

  // ── procurement and stock ──
  await del('supplier_bill_approvals', `po_id${ANY(1)}`, [ids(S.po?.id)]);
  await del('supplier_bill_payments', `po_id${ANY(1)} OR id${ANY(2)}`, [ids(S.po?.id), ids(S.supplierPayment?.id)]);
  await del('inventory_transactions', `item_id${ANY(1)}`, [items]);
  await del('grn_line_items', `grn_id${ANY(1)}`, [ids(S.grn?.id)]);
  await del('inventory_batches', `item_id${ANY(1)}`, [items]);
  await del('goods_receipt_notes', `id${ANY(1)}`, [ids(S.grn?.id)]);
  await del('purchase_order_items', `purchase_order_id${ANY(1)}`, [ids(S.po?.id)]);
  await del('purchase_orders', `id${ANY(1)}`, [ids(S.po?.id)]);
  await del('pr_line_items', `pr_id${ANY(1)}`, [ids(S.pr?.id)]);
  await del('purchase_requisitions', `id${ANY(1)}`, [ids(S.pr?.id)]);
  await del('scheme_product_pricing_history', `product_id${ANY(1)}`, [items]);
  await del('scheme_product_pricing', `product_id${ANY(1)}`, [items]);
  await del('stock_by_location', `item_id${ANY(1)}`, [items]);
  await del('inventory_items', `id${ANY(1)}`, [items]);
  await del('suppliers', `id${ANY(1)}`, [ids(S.supplier?.id)]);
  // (checked first: a failed statement would abort the whole transaction)
  const [hasDefaultStore] = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'pharmacy_settings' AND column_name = 'default_pharmacy_location_id'`, [SCHEMA]);
  if (hasDefaultStore) await c.query(`UPDATE pharmacy_settings SET default_pharmacy_location_id = NULL WHERE default_pharmacy_location_id${ANY(1)}`, [ids(S.pharmacyStore?.id)]);
  await del('stock_locations', `id${ANY(1)}`, [ids(S.pharmacyStore?.id)]);

  // ── money: expense, transfer, cashier shift ──
  await del('daily_expense_approvals', `expense_id${ANY(1)}`, [expenses]);
  await del('daily_expenses', `id${ANY(1)}`, [expenses]);
  await del('cash_transfers', `id${ANY(1)}`, [transfers]);
  await del('cashier_shifts', `id${ANY(1)} OR cashier_id${ANY(2)}`, [ids(S.cashierShift?.id), users]);

  // ── HR ──
  await del('duty_roster_entries', `roster_id${ANY(1)}`, [rosters]);
  await del('duty_roster_events', `roster_id${ANY(1)}`, [rosters]);
  await del('duty_rosters', `id${ANY(1)}`, [rosters]);
  await del('attendance_records', `employee_id${ANY(1)}`, [employees]);
  await del('portal_login_attempts', `employee_id${ANY(1)}`, [employees]);
  await del('portal_notifications', `employee_id${ANY(1)}`, [employees]);
  await del('employee_salary_components', `employee_id${ANY(1)}`, [employees]);
  await c.query(`UPDATE departments SET head_employee_id = NULL WHERE head_employee_id${ANY(1)}`, [employees]);
  await del('employees', `id${ANY(1)}`, [employees]);
  await del('salary_structure_components', `salary_structure_id${ANY(1)}`, [ids(S.salaryStructure?.id)]);
  await del('salary_structures', `id${ANY(1)}`, [ids(S.salaryStructure?.id)]);
  await del('shifts', `id${ANY(1)} AND NOT EXISTS (SELECT 1 FROM duty_roster_entries e WHERE e.shift_id::text = shifts.id::text)`, [ids(S.shifts?.M, S.shifts?.E)]);

  // ── setup the seed added (not the catalogue that was already there) ──
  await del('scheme_service_pricing_history', `scheme_id${ANY(1)} AND service_id${ANY(2)}`, [ids(S.cic?.id), ownServices]);
  await del('scheme_service_pricing', `scheme_id${ANY(1)} AND created_at >= $2::timestamptz`, [ids(S.cic?.id), start]);
  await del('lab_test_components', `lab_test_id${ANY(1)}`, [ownLabTests]);
  await del('lab_tests', `id${ANY(1)}`, [ownLabTests]);
  await del('services', `id${ANY(1)}`, [ownServices]);
  await del('departments', `department_name = 'Nursing' AND created_at >= $1::timestamptz`, [start]);

  // ── demo users and their trail ──
  await del('chatbot_messages', `conversation_id IN (SELECT id FROM chatbot_conversations WHERE user_id${ANY(1)})`, [users]);
  await del('chatbot_conversations', `user_id${ANY(1)}`, [users]);
  await del('app_notifications', `user_id${ANY(1)} OR created_at BETWEEN $2::timestamptz AND $3::timestamptz`, [users, start, seedEnd]);
  await del('audit_logs', `user_id${ANY(1)} OR created_at BETWEEN $2::timestamptz AND $3::timestamptz`, [users, start, seedEnd]);
  await del('user_branches', `user_id${ANY(1)}`, [users]);
  await del('user_additional_roles', `user_id${ANY(1)}`, [users]);
  await del('user_permissions', `user_id${ANY(1)}`, [users]);
  await del('users', `id${ANY(1)}`, [users]);
  const hrRole = ids(S.roleHr?.id);
  const [{ n: hrUsers }] = await q(`SELECT COUNT(*)::int n FROM users u JOIN roles r ON r.role_key = u.role WHERE r.id${ANY(1)}`, [hrRole]);
  if (!hrUsers) {
    await del('role_privileges', `role_id${ANY(1)}`, [hrRole]);
    await del('roles', `id${ANY(1)}`, [hrRole]);
  }

  // Anything still pointing at what was just removed means a link this script does not know.
  const [{ n: orphans }] = await q(`SELECT COUNT(*)::int n FROM account_ledger al
    WHERE al.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM general_ledger gl WHERE gl.id = al.transaction_id)`);
  return { start, orphans };
}

(async () => {
  await c.connect();
  try {
    await c.query('BEGIN');
    const { start, orphans } = await run();
    console.log(`${SCHEMA}: seeded data from ${new Date(start).toISOString()}`);
    for (const [t, n] of removed) console.log(`  ${t.padEnd(38)} ${String(n).padStart(5)}`);
    console.log(`  ${'total rows'.padEnd(38)} ${String(removed.reduce((s, [, n]) => s + n, 0)).padStart(5)}`);
    if (orphans) throw new Error(`${orphans} ledger row(s) would be left pointing at removed entries — not applied.`);
    await c.query(APPLY ? 'COMMIT' : 'ROLLBACK');
    console.log(APPLY ? '\nAPPLIED.' : '\nDry run — rolled back, nothing changed. Re-run with --apply --confirm=tenant_demo to remove.');
    console.log('Not reverted: CIC credit settings, Night shift hours, re-saved categories, privileges granted to existing roles, the demo admin password,'
      + ' document-number counters, and the admin\'s own Analytics Assistant conversations.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('FAILED, nothing changed:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();

#!/usr/bin/env node
/**
 * Give ledger rows posted without a branch the branch of the document they
 * came from. Branch-scoped reports (income statement, cash flow, GL) filter on
 * account_ledger.branch_id, so a row with none — manual journal entries,
 * dispensing, claim payments and a few other paths posted that way until they
 * were fixed — was missing from every branch's books.
 *
 * Each row's branch comes from its own document: the bill (billing, payments,
 * bill COGS), the dispensing record, the claim (or its bills), the journal
 * entry, the expense, supplier payment, GRN, credit note's bill, consultant
 * bill, salary advance or asset. Rows whose document has no branch either are
 * left alone and counted.
 *
 * DRY RUN BY DEFAULT (read-only): counts per source. --apply needs --schema
 * and changes one tenant at a time.
 *
 *   DATABASE_URL=… node src/server/scripts/backfillLedgerBranches.js --all
 *   DATABASE_URL=… node src/server/scripts/backfillLedgerBranches.js --schema tenant_demo --apply
 */
const { Client } = require('pg');
const { clientConfig, listTenantSchemas } = require('./scanFxRevenueSync');

// source_module/reference_module → SQL giving the document's branch for ledger row `al` (and its GL `gl`).
const RESOLVERS = {
  bill: `(SELECT pb.branch_id FROM patient_bills pb WHERE pb.id::text = gl.reference_id)`,
  dispensing: `(SELECT d.branch_id FROM dispensing_records d WHERE d.id::text = gl.reference_id)`,
  claim: `COALESCE(
      (SELECT c.branch_id FROM insurance_batch_claims c WHERE c.id::text = gl.reference_id),
      (SELECT pb.branch_id FROM insurance_batch_claim_items ci
         LEFT JOIN invoices i ON i.id::text = ci.invoice_id::text
         JOIN patient_bills pb ON pb.id::text = COALESCE(ci.bill_id::text, i.bill_id::text)
        WHERE ci.claim_id::text = gl.reference_id AND pb.branch_id IS NOT NULL LIMIT 1))`,
  journal: `(SELECT je.branch_id FROM journal_entries je WHERE je.id::text = gl.reference_id)`,
  expense: `(SELECT de.branch_id FROM daily_expenses de WHERE de.id::text = gl.reference_id)`,
  supplierPayment: `(SELECT sp.branch_id FROM supplier_bill_payments sp WHERE sp.id::text = gl.reference_id)`,
  grn: `(SELECT g.branch_id FROM goods_receipt_notes g WHERE g.id::text = gl.reference_id)`,
  creditNote: `(SELECT pb.branch_id FROM credit_notes cn JOIN patient_bills pb ON pb.id::text = COALESCE(cn.applied_to_bill_id, cn.original_bill_id)::text WHERE cn.id::text = gl.reference_id)`,
  consultantBill: `(SELECT cb.branch_id FROM consultant_bills cb WHERE cb.id::text = gl.reference_id)`,
  salaryAdvance: `(SELECT sa.branch_id FROM salary_advances sa WHERE sa.id::text = gl.reference_id)`,
  asset: `(SELECT fa.branch_id FROM fixed_assets fa WHERE fa.id::text = gl.reference_id)`,
};
const MODULE_RESOLVER = {
  patient_billing: 'bill', bill_item_void: 'bill', bill_revenue_adjustment: 'bill', pharmacy_bill_cogs: 'bill', patient_bill_payment: 'bill', bill_write_off: 'bill',
  pharmacy_dispensing: 'dispensing',
  insurance_claims: 'claim',
  journal_entry: 'journal',
  daily_expense: 'expense',
  supplier_bill_payment: 'supplierPayment',
  procurement_grn: 'grn',
  credit_note: 'creditNote',
  consultant_bill: 'consultantBill',
  salary_advance: 'salaryAdvance',
  fixed_asset: 'asset',
};

async function tableExists(c, schema, table) {
  const [{ ok }] = (await c.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`${schema}.${table}`])).rows;
  return ok;
}

/** The CASE choosing a resolver by the GL entry's module, skipping resolvers whose table is absent. */
async function resolverCase(c, schema) {
  const tables = { bill: 'patient_bills', dispensing: 'dispensing_records', claim: 'insurance_batch_claims', journal: 'journal_entries', expense: 'daily_expenses',
    supplierPayment: 'supplier_bill_payments', grn: 'goods_receipt_notes', creditNote: 'credit_notes', consultantBill: 'consultant_bills', salaryAdvance: 'salary_advances', asset: 'fixed_assets' };
  const parts = [];
  for (const [module, key] of Object.entries(MODULE_RESOLVER)) {
    if (!(await tableExists(c, schema, tables[key]))) continue;
    const match = module === 'fixed_asset' ? `gl.reference_module LIKE 'fixed_asset%'` : `gl.reference_module = '${module}'`;
    parts.push(`WHEN ${match} THEN ${RESOLVERS[key]}`);
  }
  return `CASE ${parts.join('\n      ')} END`;
}

async function runTenant(c, schema, apply) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`invalid schema ${schema}`);
  await c.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    await c.query(`SET LOCAL search_path TO "${schema}", public`);
    const resolve = await resolverCase(c, schema);
    // GL-backed rows, and journal-entry rows (no GL entry; linked by JE number).
    const candidates = `
      SELECT al.id, gl.reference_module AS module, ${resolve} AS branch
        FROM account_ledger al JOIN general_ledger gl ON gl.id = al.transaction_id
       WHERE al.branch_id IS NULL
      UNION ALL
      SELECT al.id, 'journal_entries (payments, transfers)', je.branch_id
        FROM account_ledger al JOIN journal_entries je ON je.je_number = al.reference_number
       WHERE al.branch_id IS NULL AND al.transaction_id IS NULL`;
    const { rows } = await c.query(`
      SELECT module, COUNT(*)::int AS rows, COUNT(branch)::int AS resolvable FROM (${candidates}) x GROUP BY 1 ORDER BY 2 DESC`);
    let updated = 0;
    if (apply) {
      const r = await c.query(`UPDATE account_ledger al SET branch_id = x.branch FROM (${candidates}) x WHERE x.id = al.id AND x.branch IS NOT NULL`);
      updated = r.rowCount;
    }
    await c.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { schema, rows, updated };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf('--schema');
  const one = si !== -1 ? args[si + 1] : null;
  const apply = args.includes('--apply');
  if ((!one && !args.includes('--all')) || (apply && !one)) {
    console.error('Usage: backfillLedgerBranches.js (--schema <tenant> [--apply] | --all)   — --apply needs one --schema');
    process.exit(1);
  }
  const c = new Client({ ...clientConfig(), query_timeout: 300000 });
  await c.connect();
  try {
    const schemas = one ? [one] : await listTenantSchemas(c);
    for (const s of schemas) {
      try {
        const r = await runTenant(c, s, apply);
        const total = r.rows.reduce((a, x) => a + x.rows, 0);
        const fixable = r.rows.reduce((a, x) => a + x.resolvable, 0);
        console.log(`\n■ ${s}: ${total} ledger row(s) with no branch, ${fixable} can take their document's branch${apply ? ` — ${r.updated} updated` : ''}`);
        for (const x of r.rows) console.log(`   ${String(x.module).padEnd(40)} ${String(x.rows).padStart(6)}  resolvable ${x.resolvable}`);
      } catch (e) {
        console.error(`✗ ${s}: ${e.message}`);
      }
    }
    if (!apply) console.log('\nDry run — nothing changed.');
  } finally { await c.end(); }
}

main().catch((e) => { console.error(e); process.exit(1); });

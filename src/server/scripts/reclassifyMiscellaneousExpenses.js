// ══════════════════════════════════════════════════════════════════════════
// One-time correction script: reclassify historical Miscellaneous Expenses
// (account 5900) postings onto the real expense/COGS account they belong to,
// wherever that can be confidently inferred — NOT a blanket sweep.
//
// Background: daily-expenses.js's POST /supplier-bill-payment handler used to
// post every pre-GRN supplier payment to 5900 unconditionally; it now infers
// a real account from the PO's own line items (see inferExpenseAccountFromPOItems
// in that file) — but that fix only changed behavior for NEW payments going
// forward. Anything posted to 5900 BEFORE that fix shipped is still sitting
// there. This script re-runs the exact same inference logic against each
// historical 5900 posting and, in --apply mode, moves it to the account it
// should have landed on — a pure reclassification: same amount, same date,
// same transaction, only the expense account changes. Net financial impact
// is zero; this does not alter the clinic's total expenses, only which line
// they show up under.
//
// Two source types are traceable, because AccountingService.createGLEntry
// stamps every account_ledger row with source_module/reference_number
// pointing back to the record that caused the posting (see that function,
// ~line 220 of AccountingService.js):
//   - source_module = 'supplier_bill_payment', reference_number = the
//     supplier_bill_payments.id — re-run inferExpenseAccountFromPOItems
//     against that payment's PO.
//   - source_module = 'daily_expense', reference_number = the
//     daily_expenses.id — re-check its category against CATEGORY_EXPENSE_CODE
//     (this one should rarely change anything: a category not in that map is
//     SUPPOSED to fall to Miscellaneous — e.g. Catering/Cleaning/Security —
//     so this just re-confirms rather than reclassifies those).
// Anything else (e.g. consultant_bill_payment, or no source_module at all)
// has no reliable way to infer a better account and is left untouched,
// reported as "no confident reclassification" rather than guessed at.
//
// Usage:
//   node src/server/scripts/reclassifyMiscellaneousExpenses.js <tenant_schema> [--clinic-id=1] [--apply]
//
// Without --apply, this is READ-ONLY: it prints exactly what it would change
// and nothing is written. Run it once without --apply, review the report,
// then re-run with --apply to actually move the money. Every change made in
// --apply mode is also written to a timestamped JSON log file alongside this
// script's output for an audit trail.
// ══════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { getTenantConnection } = require('../tenantDb');

const CATEGORY_EXPENSE_CODE = {
  'Doctor Fees': '5110',
  'Allowance': '5120',
  'Office Supplies': '5400',
  'Utilities': '5310',
  'Maintenance': '5330',
  'Transport': '5800',
  'Medical Supplies': '5200',
  'Administrative Expenses': '5440',
};

const PO_ITEM_CATEGORY_EXPENSE_CODE = {
  drugs: '5210',
  reagents: '5220',
  consumables: '5200',
  supplies: '5200',
  surgical: '5200',
};

// Identical to inferExpenseAccountFromPOItems in daily-expenses.js — kept as
// its own copy here rather than imported, so this one-time script has no
// runtime dependency on that route file's internals changing underneath it.
async function inferExpenseAccountFromPOItems(sequelize, poId) {
  try {
    const [lines] = await sequelize.query(
      `SELECT item_name, total_price FROM purchase_order_items WHERE purchase_order_id = :poId`,
      { replacements: { poId } }
    );
    if (lines.length === 0) return null;
    const valueByCategory = {};
    for (const line of lines) {
      const name = (line.item_name || '').trim();
      if (!name) continue;
      const [matches] = await sequelize.query(
        `SELECT item_category FROM inventory_items WHERE is_active = true AND item_name ILIKE :pattern ORDER BY length(item_name) DESC LIMIT 1`,
        { replacements: { pattern: `%${name}%` } }
      );
      const category = matches[0]?.item_category;
      const code = category && PO_ITEM_CATEGORY_EXPENSE_CODE[category];
      if (code) valueByCategory[code] = (valueByCategory[code] || 0) + (parseFloat(line.total_price) || 0);
    }
    const codes = Object.keys(valueByCategory);
    if (codes.length === 0) return null;
    return codes.reduce((best, code) => (valueByCategory[code] > valueByCategory[best] ? code : best), codes[0]);
  } catch (e) {
    console.warn('inferExpenseAccountFromPOItems failed:', e.message);
    return null;
  }
}

async function getAccountByCode(sequelize, clinicId, code) {
  const [[row]] = await sequelize.query(
    `SELECT id, account_code, account_name FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code AND is_active = true`,
    { replacements: { clinicId, code } }
  );
  return row || null;
}

async function main() {
  const args = process.argv.slice(2);
  const schema = args.find(a => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const clinicIdArg = args.find(a => a.startsWith('--clinic-id='));
  const clinicId = clinicIdArg ? parseInt(clinicIdArg.split('=')[1], 10) : 1;

  if (!schema) {
    console.error('Usage: node reclassifyMiscellaneousExpenses.js <tenant_schema> [--clinic-id=1] [--apply]');
    process.exit(1);
  }

  const { sequelize } = await getTenantConnection(schema);
  console.log(`\nSchema: ${schema} | Clinic: ${clinicId} | Mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (read-only)'}\n`);

  const misc = await getAccountByCode(sequelize, clinicId, '5900');
  if (!misc) {
    console.log('No active Miscellaneous Expenses (5900) account for this clinic — nothing to do.');
    process.exit(0);
  }

  const [rows] = await sequelize.query(
    `SELECT id, transaction_id, transaction_date, debit_amount, description, source_module, reference_number
     FROM account_ledger
     WHERE account_id = :accountId AND clinic_id = :clinicId AND debit_amount > 0
     ORDER BY transaction_date ASC`,
    { replacements: { accountId: misc.id, clinicId } }
  );

  console.log(`Found ${rows.length} debit posting(s) to Miscellaneous Expenses.\n`);
  if (rows.length === 0) process.exit(0);

  const accountCache = new Map();
  const proposals = [];
  const unclassified = [];

  for (const row of rows) {
    let inferredCode = null;

    if (row.source_module === 'supplier_bill_payment' && row.reference_number) {
      const [[payment]] = await sequelize.query(
        `SELECT po_id FROM supplier_bill_payments WHERE id = :id`,
        { replacements: { id: row.reference_number } }
      );
      if (payment?.po_id) inferredCode = await inferExpenseAccountFromPOItems(sequelize, parseInt(payment.po_id));
    } else if (row.source_module === 'daily_expense' && row.reference_number) {
      const [[expense]] = await sequelize.query(
        `SELECT category FROM daily_expenses WHERE id = :id`,
        { replacements: { id: parseInt(row.reference_number) } }
      );
      inferredCode = expense?.category ? (CATEGORY_EXPENSE_CODE[expense.category] || null) : null;
    }

    if (!inferredCode || inferredCode === '5900') {
      unclassified.push(row);
      continue;
    }

    if (!accountCache.has(inferredCode)) {
      accountCache.set(inferredCode, await getAccountByCode(sequelize, clinicId, inferredCode));
    }
    const targetAccount = accountCache.get(inferredCode);
    if (!targetAccount) {
      unclassified.push({ ...row, _reason: `inferred account ${inferredCode} is missing/inactive` });
      continue;
    }

    proposals.push({
      ledgerEntryId: row.id,
      transactionId: row.transaction_id,
      date: row.transaction_date,
      amount: parseFloat(row.debit_amount),
      description: row.description,
      sourceModule: row.source_module,
      referenceNumber: row.reference_number,
      fromAccountId: misc.id,
      fromAccountCode: '5900',
      toAccountId: targetAccount.id,
      toAccountCode: targetAccount.account_code,
      toAccountName: targetAccount.account_name,
    });
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const byTarget = new Map();
  for (const p of proposals) {
    const key = `${p.toAccountCode} ${p.toAccountName}`;
    if (!byTarget.has(key)) byTarget.set(key, { count: 0, total: 0 });
    const agg = byTarget.get(key);
    agg.count += 1;
    agg.total += p.amount;
  }
  console.log('── Proposed reclassifications ──────────────────────────────');
  for (const [target, agg] of byTarget) {
    console.log(`  -> ${target}: ${agg.count} entr${agg.count === 1 ? 'y' : 'ies'}, total ${agg.total.toFixed(2)}`);
  }
  const proposedTotal = proposals.reduce((s, p) => s + p.amount, 0);
  console.log(`  TOTAL to reclassify: ${proposedTotal.toFixed(2)} across ${proposals.length} entr${proposals.length === 1 ? 'y' : 'ies'}\n`);

  console.log('── Left in Miscellaneous (no confident reclassification) ───');
  const unclassifiedTotal = unclassified.reduce((s, r) => s + parseFloat(r.debit_amount || 0), 0);
  console.log(`  ${unclassified.length} entr${unclassified.length === 1 ? 'y' : 'ies'}, total ${unclassifiedTotal.toFixed(2)}`);
  for (const r of unclassified.slice(0, 20)) {
    console.log(`    [${r.transaction_date}] ${r.debit_amount} — ${r.description || '(no description)'} (source: ${r.source_module || 'none'}${r._reason ? `, ${r._reason}` : ''})`);
  }
  if (unclassified.length > 20) console.log(`    ...and ${unclassified.length - 20} more`);
  console.log('');

  if (!apply) {
    console.log('Dry run only — nothing was changed. Re-run with --apply to write these changes.\n');
    process.exit(0);
  }

  if (proposals.length === 0) {
    console.log('Nothing to apply.\n');
    process.exit(0);
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  const transaction = await sequelize.transaction();
  const changeLog = [];
  try {
    for (const p of proposals) {
      await sequelize.query(
        `UPDATE account_ledger SET account_id = :toAccountId, description = :newDesc WHERE id = :id`,
        {
          replacements: {
            toAccountId: p.toAccountId,
            newDesc: `${p.description || ''} [reclassified from Miscellaneous Expenses (5900) on ${new Date().toISOString().slice(0, 10)}]`.trim(),
            id: p.ledgerEntryId,
          },
          transaction,
        }
      );
      const [result] = await sequelize.query(
        `UPDATE gl_line_items SET account_id = :toAccountId WHERE gl_id = :glId AND account_id = :fromAccountId`,
        { replacements: { toAccountId: p.toAccountId, glId: p.transactionId, fromAccountId: p.fromAccountId }, transaction }
      );
      changeLog.push({ ...p, appliedAt: new Date().toISOString() });
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    console.error('Apply failed — rolled back, nothing was changed:', err.message);
    process.exit(1);
  }

  const logPath = path.join(__dirname, `reclassify-miscellaneous-${schema}-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(changeLog, null, 2));
  console.log(`Applied ${proposals.length} reclassification(s), totaling ${proposedTotal.toFixed(2)}.`);
  console.log(`Audit log written to: ${logPath}\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});

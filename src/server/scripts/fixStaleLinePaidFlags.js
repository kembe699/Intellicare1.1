// ══════════════════════════════════════════════════════════════════════════
// One-off correction for the historical case receiptVoidReversalMissingPaidServices's
// R1 fix (receipts.js's applyVoidReversal) only fixes going forward: a bill
// whose only receipt was voided/refunded BEFORE that fix shipped, while
// receipt.paid_services was empty, ended up correctly fully reversed at the
// bill level (paid_amount=0, balance_amount=total_amount, status='pending')
// but with its line items still carrying a stale paid:true from before the
// reversal — e.g. BILL-2026-949716 (Nation tenant, "Mach Ajak"), which the
// client reported as "completely cancelled but still shows paid".
//
// Deliberately scoped to the ONLY case this can resolve without guessing: a
// bill with paid_amount=0 AND zero currently-active receipts has no payment
// backing ANY line's "paid" claim — every paid:true line on it is provably
// stale and safe to clear. A bill with a nonzero paid_amount, or one with an
// active receipt despite paid_amount=0 (its own, separate inconsistency),
// is left untouched and flagged for manual review — same conservative stance
// the code fix itself takes, which never guesses which lines a voided
// receipt covered.
//
// Usage:
//   node src/server/scripts/fixStaleLinePaidFlags.js <tenant_schema> [--clinic-id=1] [--apply]
//
// Without --apply this is READ-ONLY: it prints what it would clear and
// writes nothing.
// ══════════════════════════════════════════════════════════════════════════

const { getTenantConnection } = require('../tenantDb');
const { normalizeServices } = require('../utils/normalizeServices');

async function main() {
  const args = process.argv.slice(2);
  const schema = args.find(a => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const clinicIdArg = args.find(a => a.startsWith('--clinic-id='));
  const clinicId = clinicIdArg ? parseInt(clinicIdArg.split('=')[1], 10) : 1;

  if (!schema) {
    console.error('Usage: node fixStaleLinePaidFlags.js <tenant_schema> [--clinic-id=1] [--apply]');
    process.exit(1);
  }

  const { sequelize } = await getTenantConnection(schema);

  console.log(`\nSchema: ${schema} | Clinic: ${clinicId} | Mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (read-only)'}\n`);

  // Pre-filter in SQL on the raw text — cheap and avoids parsing every bill
  // in the clinic. The real paid-flag check happens below in JS, after
  // normalizeServices, since this column has accumulated both plain-array
  // and (historically) double-encoded-string rows.
  const [candidates] = await sequelize.query(
    `SELECT id, bill_number, patient_name, total_amount, paid_amount, balance_amount, status, services
     FROM patient_bills
     WHERE clinic_id = :clinicId
       AND paid_amount = 0
       AND services::text LIKE '%"paid":true%'`,
    { replacements: { clinicId } }
  );

  console.log(`Found ${candidates.length} candidate bill(s) with paid_amount=0 but a line item mentioning paid:true.\n`);

  let fixedCount = 0;
  let skippedCount = 0;
  const report = [];

  for (const bill of candidates) {
    const [[activeCount]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM receipts WHERE bill_id = :billId AND status = 'active'`,
      { replacements: { billId: bill.id } }
    );
    if (parseInt(activeCount.cnt, 10) > 0) {
      // paid_amount=0 with an active receipt is its own, separate
      // inconsistency — not the stale-paid-flag case this script resolves.
      // Don't touch it; flag for a human to look at.
      skippedCount++;
      report.push({ bill: bill.bill_number, action: 'SKIPPED — needs manual review', reason: `paid_amount=0 but ${activeCount.cnt} active receipt(s) exist` });
      continue;
    }

    const services = normalizeServices(bill.services);
    const paidLines = services.filter(s => s && s.paid);
    if (paidLines.length === 0) continue; // the SQL pre-filter can false-positive on malformed/old text

    report.push({
      bill: bill.bill_number,
      patient: bill.patient_name,
      action: apply ? 'FIXED' : 'WOULD FIX',
      staleLines: paidLines.map(s => `${s.serviceName || s.name || 'item'} (${s.totalPrice ?? s.unitPrice ?? 0})`),
    });

    if (apply) {
      const updated = services.map(s => {
        if (s && s.paid) {
          const { paid, paidAt, status, ...rest } = s;
          return rest;
        }
        return s;
      });
      await sequelize.query(
        `UPDATE patient_bills SET services = :services, updated_at = NOW() WHERE id = :id`,
        { replacements: { services: JSON.stringify(updated), id: bill.id } }
      );
    }
    fixedCount++;
  }

  console.log(JSON.stringify(report, null, 2));
  console.log(`\n${apply ? 'Fixed' : 'Would fix'} ${fixedCount} bill(s). Skipped (needs manual review): ${skippedCount}.`);
  if (!apply) console.log('Dry run only — re-run with --apply to write changes.');

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

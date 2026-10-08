// ══════════════════════════════════════════════════════════════════════════
// One-time backfill: posts Cost of Goods Sold for historical bills whose
// line items match the pharmacy/inventory catalog but never went through
// the Pharmacy module's own /dispensing endpoint (see
// src/server/utils/pharmacyCogsOnBill.js for the full story — that same
// shared function is what this script and the new real-time billing hook
// both run, so a bill backfilled here gets identical treatment to one
// billed today going forward).
//
// Usage:
//   node src/server/scripts/backfillPharmacyCogs.js <tenant_schema> [--clinic-id=1] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]
//
// Without --apply this is READ-ONLY: it prints what it would post (real
// inferred amounts/accounts, not estimates) and writes nothing. --from/--to
// are optional — omitted means "every bill this tenant has ever had".
//
// Safe to re-run: already-flagged line items (cogsPosted: true) are skipped
// instantly, so running this again after new bills come in only processes
// what's new.
// ══════════════════════════════════════════════════════════════════════════

const { getTenantConnection } = require('../tenantDb');
const tenantContext = require('../tenantContext');
const { postPharmacyCogsForBill } = require('../utils/pharmacyCogsOnBill');

async function main() {
  const args = process.argv.slice(2);
  const schema = args.find(a => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const clinicIdArg = args.find(a => a.startsWith('--clinic-id='));
  const clinicId = clinicIdArg ? parseInt(clinicIdArg.split('=')[1], 10) : 1;
  const fromArg = args.find(a => a.startsWith('--from='));
  const toArg = args.find(a => a.startsWith('--to='));
  const dateFrom = fromArg ? fromArg.split('=')[1] : null;
  const dateTo = toArg ? toArg.split('=')[1] : null;

  if (!schema) {
    console.error('Usage: node backfillPharmacyCogs.js <tenant_schema> [--clinic-id=1] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]');
    process.exit(1);
  }

  const conn = await getTenantConnection(schema);
  const { sequelize } = conn;

  console.log(`\nSchema: ${schema} | Clinic: ${clinicId} | Range: ${dateFrom || '(all time)'} to ${dateTo || '(all time)'} | Mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (read-only)'}\n`);

  let dateSql = '';
  const replacements = { clinicId };
  if (dateFrom) { dateSql += ' AND bill_date::date >= :dateFrom'; replacements.dateFrom = dateFrom; }
  if (dateTo) { dateSql += ' AND bill_date::date <= :dateTo'; replacements.dateTo = dateTo; }

  const [bills] = await sequelize.query(
    `SELECT id, bill_number, bill_date, branch_id, notes, services
     FROM patient_bills
     WHERE clinic_id = :clinicId ${dateSql}
     ORDER BY bill_date ASC`,
    { replacements }
  );

  console.log(`Found ${bills.length} bill(s) in range.\n`);
  if (bills.length === 0) process.exit(0);

  const accountCache = new Map();
  let totalPosted = 0;
  let totalAmount = 0;
  const previewByItem = new Map(); // item name -> { count, total }
  const toWrite = []; // { billId, services } — only in apply mode
  const affectedBillIds = new Set();

  await tenantContext.run(conn, async () => {
    for (const bill of bills) {
      let services = bill.services;
      if (typeof services === 'string') {
        try { services = JSON.parse(services); } catch { continue; }
      }
      if (!Array.isArray(services) || services.length === 0) continue;

      const result = await postPharmacyCogsForBill(sequelize, {
        clinicId, branchId: bill.branch_id, billId: bill.id, billDate: bill.bill_date,
        billNotes: bill.notes, services, userId: 'backfill-script', accountCache, dryRun: !apply,
      });

      if (!apply) {
        for (const p of result.previewed) {
          const key = p.itemName;
          const agg = previewByItem.get(key) || { count: 0, total: 0 };
          agg.count += 1;
          agg.total += p.cogsAmount;
          previewByItem.set(key, agg);
        }
        if (result.previewed.length > 0) affectedBillIds.add(bill.id);
      } else if (result.changed) {
        toWrite.push({ billId: bill.id, services: result.services });
        affectedBillIds.add(bill.id);
      }

      totalPosted += result.postedCount;
      totalAmount += result.postedTotal;
    }

    if (apply && toWrite.length > 0) {
      for (const w of toWrite) {
        await sequelize.query(`UPDATE patient_bills SET services = :services WHERE id = :id`, {
          replacements: { services: JSON.stringify(w.services), id: w.billId },
        });
      }
    }
  });

  if (!apply) {
    console.log('── Proposed COGS postings, by item ──────────────────────────');
    const sorted = [...previewByItem.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [name, agg] of sorted) {
      console.log(`  ${name}: ${agg.count} line(s), total ${agg.total.toFixed(2)}`);
    }
    console.log(`\n  TOTAL: ${totalPosted} line(s) across ${affectedBillIds.size} bill(s), ${totalAmount.toFixed(2)}\n`);
    console.log('Dry run only — nothing was changed. Re-run with --apply to write these changes.\n');
  } else {
    console.log(`Applied: posted COGS for ${totalPosted} line(s) across ${toWrite.length} bill(s), totaling ${totalAmount.toFixed(2)}.\n`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});

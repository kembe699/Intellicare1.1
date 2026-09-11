/**
 * Put each bill's revenue on the accounts its own lines call for.
 *
 * A correction that split a shortfall across accounts in proportion to what they
 * already held produced amounts matching no real price — a 3,000 adjustment
 * became 321.72 consultation, 1,126.01 laboratory and 1,552.27 pharmacy. The
 * totals were right and the income statement was unreadable: consultation
 * revenue of 237,257.76 for a service that costs 20,000 or 50,000.
 *
 * The bill says what each line is worth and which account it belongs to, so this
 * moves revenue between accounts until each holds its share. Nothing is created
 * or destroyed — every entry nets to zero, the bill's total revenue is unchanged,
 * and the receivable is not touched. Only the classification moves.
 *
 * A bill whose lines do not add up to its posted revenue is reported and left
 * alone: that is a different problem (a void, an edit after posting) and
 * reclassifying it would hide the discrepancy rather than fix it.
 *
 *   node src/server/scripts/reclassifyBillRevenueLines.js --schema tenant_nation
 *   node src/server/scripts/reclassifyBillRevenueLines.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si >= 0 ? args[si + 1] : null;
if (!SCHEMA) {
  console.error('Usage: reclassifyBillRevenueLines.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

const DB = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase())
    ? { rejectUnauthorized: false } : false,
};


/**
 * The revenue account a bill line belongs on.
 *
 * Mirrors utils/resolveRevenueAccount.js, which is what posting uses: look the
 * line up as a service, a lab test, then a stock item, and fall back to matching
 * its name. Bills do not store the account on the line, so this has to be
 * re-derived the same way or the targets would not match what posting produced.
 */
async function resolveAccountForLine(db, line, clinicId, cache) {
  const id = line.serviceId ?? line.service_id ?? null;
  const name = String(line.serviceName || line.service_name || line.item_name || '').trim();
  if (!id && !name) return null;

  let category = null;
  const lookups = [
    id ? ['SELECT category FROM services WHERE id = $1 LIMIT 1', [String(id)], null] : null,
    name ? ['SELECT category FROM services WHERE LOWER(service_name) = LOWER($1) LIMIT 1', [name], null] : null,
    name ? ['SELECT 1 FROM lab_tests WHERE LOWER(test_name) = LOWER($1) LIMIT 1', [name], 'laboratory'] : null,
    id ? ['SELECT 1 FROM inventory_items WHERE id::text = $1 LIMIT 1', [String(id)], 'pharmacy'] : null,
    name ? ['SELECT 1 FROM inventory_items WHERE LOWER(item_name) = LOWER($1) LIMIT 1', [name], 'pharmacy'] : null,
  ].filter(Boolean);

  for (const [sql, params, forced] of lookups) {
    try {
      const { rows } = await db.query(sql, params);
      if (!rows[0]) continue;
      category = forced || rows[0].category;
      if (category) break;
    } catch { /* a table this tenant does not have */ }
  }
  if (!category) category = name;

  const cat = String(category).toLowerCase();
  let code = '4100';
  if (/lab|laboratory|diagnostic|patholog|haemat|hemat/.test(cat)) code = '4110';
  else if (/pharma|drug|medic|dispens/.test(cat)) code = '4120';
  else if (/radio|imaging|xray|x-ray|scan|ultrasound|ct |mri/.test(cat)) code = '4130';
  else if (/proced|surgery|theater|theatre|operation|minor op/.test(cat)) code = '4140';
  else if (/inpatient|admission|bed|ward|nursing care/.test(cat)) code = '4150';
  else if (/consult|opd|outpatient|review|clinic visit/.test(cat)) code = '4105';

  const key = `${clinicId}:${code}`;
  if (!cache.has(key)) {
    const { rows } = await db.query(
      'SELECT id FROM chart_of_accounts WHERE clinic_id = $1 AND account_code = $2 LIMIT 1', [clinicId, code]);
    const { rows: fb } = rows[0] ? { rows: [] }
      : await db.query("SELECT id FROM chart_of_accounts WHERE account_code = '4100' LIMIT 1");
    cache.set(key, rows[0]?.id || fb[0]?.id || null);
  }
  return cache.get(key);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  const db = new Client(DB);
  await db.connect();
  await db.query(`SET search_path TO "${SCHEMA}", public`);

  console.log(`\n  schema: ${SCHEMA}`);
  console.log(`  mode:   ${APPLY ? 'APPLY (writing)' : 'dry run (no writes)'}\n`);

  // Bills carrying revenue that is not a whole currency unit. Those are the ones
  // a proportional split touched; a genuinely fractional price is rare and shows
  // up on the bill's own lines, which this checks against before moving anything.
  const { rows: suspects } = await db.query(`
    SELECT DISTINCT b.id, b.bill_number, b.clinic_id
      FROM patient_bills b
      JOIN general_ledger gl ON gl.reference_id = b.id::text
      JOIN account_ledger al ON al.transaction_id = gl.id
      JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
     WHERE gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
       AND (al.credit_amount - al.debit_amount) <> ROUND(al.credit_amount - al.debit_amount)
     ORDER BY b.bill_number
  `);

  if (suspects.length === 0) {
    console.log('  No bill carries a fractional revenue amount.\n');
    await db.end();
    return;
  }

  let moved = 0;
  const skipped = [];
  const accountCache = new Map();

  for (const bill of suspects) {
    // What the lines say each account should hold.
    const { rows: [row] } = await db.query('SELECT services FROM patient_bills WHERE id = $1', [bill.id]);
    let services = row?.services;
    if (typeof services === 'string') { try { services = JSON.parse(services); } catch { services = []; } }
    if (!Array.isArray(services) || services.length === 0) {
      skipped.push(`${bill.bill_number}: no service lines to classify against`);
      continue;
    }

    const target = new Map();
    let unclassified = false;
    for (const line of services) {
      if (!line || line.isVoided) continue;
      const amount = Number(line.totalPrice ?? line.total_price ?? 0) || 0;
      if (amount <= 0) continue;
      const acct = line.revenue_account_id || await resolveAccountForLine(db, line, bill.clinic_id, accountCache);
      if (!acct) { unclassified = true; break; }
      target.set(String(acct), round2((target.get(String(acct)) || 0) + amount));
    }
    if (unclassified || target.size === 0) {
      skipped.push(`${bill.bill_number}: a line carries no revenue account`);
      continue;
    }

    const { rows: postedRows } = await db.query(`
      SELECT al.account_id, SUM(al.credit_amount) - SUM(al.debit_amount) AS amount
        FROM account_ledger al
        JOIN general_ledger gl ON gl.id = al.transaction_id
        JOIN chart_of_accounts c ON c.id = al.account_id AND c.account_type = 'revenue'
       WHERE gl.reference_id = $1
         AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
       GROUP BY 1`, [bill.id]);
    const posted = new Map(postedRows.map((r) => [String(r.account_id), round2(r.amount)]));

    const targetTotal = round2([...target.values()].reduce((a, b) => a + b, 0));
    const postedTotal = round2([...posted.values()].reduce((a, b) => a + b, 0));
    if (Math.abs(targetTotal - postedTotal) >= 0.01) {
      skipped.push(`${bill.bill_number}: lines total ${targetTotal} but ${postedTotal} is posted — needs reconciling, not reclassifying`);
      continue;
    }

    const moves = [];
    for (const key of new Set([...target.keys(), ...posted.keys()])) {
      const diff = round2((target.get(key) || 0) - (posted.get(key) || 0));
      if (Math.abs(diff) >= 0.01) moves.push({ account_id: key, diff });
    }
    if (moves.length === 0) continue;

    console.log(`  ${bill.bill_number}`);
    for (const m of moves) {
      console.log(`      ${m.diff > 0 ? '+' : ''}${m.diff}  ->  ${(target.get(m.account_id) || 0)} (was ${(posted.get(m.account_id) || 0)})`);
    }

    if (!APPLY) { moved += 1; continue; }

    await db.query('BEGIN');
    try {
      const glId = uuidv4();
      const { rows: taken } = await db.query(
        'SELECT gl_number FROM general_ledger WHERE gl_number LIKE $1', [`GL-RECLASS-${bill.bill_number}%`]);
      const glNumber = taken.length === 0
        ? `GL-RECLASS-${bill.bill_number}`
        : `GL-RECLASS-${bill.bill_number}-${taken.length + 1}`;
      const magnitude = round2(moves.reduce((s, m) => s + Math.abs(m.diff), 0) / 2);

      await db.query(`
        INSERT INTO general_ledger (id, clinic_id, gl_number, transaction_date, transaction_type,
          description, reference_id, reference_module, transaction_currency, base_currency,
          exchange_rate, total_debit, total_credit, base_total_debit, base_total_credit,
          is_balanced, status, is_posted, created_by, posted_by, posted_date)
        VALUES ($1,$2,$3,(SELECT bill_date FROM patient_bills WHERE id=$4),'bill_revenue_adjustment',
          $5,$4,'bill_revenue_adjustment','SSP','SSP',1.0,$6,$6,$6,$6,TRUE,'posted',TRUE,'system','system',NOW())`,
        [glId, bill.clinic_id, glNumber, bill.id,
         `Revenue reclassified to the bill's own lines - ${bill.bill_number}`, magnitude]);

      for (const m of moves) {
        await db.query(`
          INSERT INTO gl_line_items (id, gl_id, account_id, debit_amount, credit_amount, line_description)
          VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), glId, m.account_id, m.diff < 0 ? Math.abs(m.diff) : 0, m.diff > 0 ? m.diff : 0,
           `Reclassification - ${bill.bill_number}`]);
        await db.query(`
          INSERT INTO account_ledger (id, clinic_id, account_id, transaction_id, transaction_date,
            debit_amount, credit_amount, description, is_posted, posted_date, source_module)
          VALUES ($1,$2,$3,$4,(SELECT bill_date FROM patient_bills WHERE id=$5),$6,$7,$8,TRUE,NOW(),'bill_revenue_adjustment')`,
          [uuidv4(), bill.clinic_id, m.account_id, glId, bill.id,
           m.diff < 0 ? Math.abs(m.diff) : 0, m.diff > 0 ? m.diff : 0,
           `Reclassification - ${bill.bill_number}`]);
      }
      await db.query('COMMIT');
      moved += 1;
    } catch (e) {
      await db.query('ROLLBACK');
      skipped.push(`${bill.bill_number}: ${e.message.slice(0, 90)}`);
    }
  }

  console.log('');
  console.log(`  ${moved} bill(s) ${APPLY ? 'reclassified' : 'would be reclassified'}.`);
  if (skipped.length) {
    console.log('\n  left alone:');
    for (const s of skipped) console.log(`    ${s}`);
  }
  if (!APPLY) console.log('\n  Re-run with --apply to write.\n'); else console.log('');
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Split historical revenue that was all credited to 4100 into service lines.
 *
 * Every bill posted before the chart of accounts separated revenue credited
 * "4100 Patient Services Revenue", so the income statement shows one
 * undifferentiated total and cannot answer what the lab or the pharmacy earned.
 * Going forward each bill line carries its own revenue account; this is for what
 * is already on the books.
 *
 * Attribution, in order of confidence:
 *
 *   exact       the GL entry's credit equals exactly one of the bill's service
 *               lines, and only one — that line's category is used.
 *   proportional the entry is split across the bill's categories in the same
 *               proportions as the bill itself.
 *
 * Every entry keeps its original total, because each split is carved out of the
 * one 4100 credit rather than added alongside it. The ledger therefore stays
 * balanced and the income statement's bottom line does not move — only the
 * breakdown above it appears.
 *
 * Dry-run by default.
 *
 *   node src/server/scripts/reclassifyRevenue.js --schema tenant_nation
 *   node src/server/scripts/reclassifyRevenue.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');

const DB_ENV = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  ssl: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase()),
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si !== -1 ? args[si + 1] : null;
if (!SCHEMA || !/^[a-z_][a-z0-9_]{0,62}$/.test(SCHEMA)) {
  console.error('Usage: reclassifyRevenue.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

/** Same rules as utils/resolveRevenueAccount.js — keep the two in step. */
function codeForCategory(cat) {
  const c = (cat || '').toLowerCase();
  if (/lab|laboratory|diagnostic|patholog|haemat|hemat/.test(c)) return '4110';
  if (/pharma|drug|medic|dispens/.test(c)) return '4120';
  if (/radio|imaging|xray|x-ray|scan|ultrasound/.test(c)) return '4130';
  if (/proced|surgery|theater|theatre|operation/.test(c)) return '4140';
  if (/inpatient|admission|bed|ward/.test(c)) return '4150';
  if (/consult|opd|outpatient|review/.test(c)) return '4105';
  return '4100';
}

const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const { ssl, ...rest } = DB_ENV;
  const db = new Client({ ...rest, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  await db.connect();
  try {
    console.log(`target: ${DB_ENV.user}@${DB_ENV.host}/${DB_ENV.database}  schema ${SCHEMA}${APPLY ? '' : '   [dry run]'}`);

    const { rows: accts } = await db.query(
      `SELECT id, account_code FROM "${SCHEMA}".chart_of_accounts WHERE account_type = 'revenue'`
    );
    const byCode = Object.fromEntries(accts.map((a) => [a.account_code, a.id]));
    const acct4100 = byCode['4100'];
    if (!acct4100) throw new Error('4100 not found in this schema');

    // Every service name this tenant knows, mapped to a revenue code. Drugs and
    // lab tests are catalogues of their own, not rows in `services`.
    const nameToCode = new Map();
    const add = (name, code) => { if (name) nameToCode.set(String(name).trim().toLowerCase(), code); };
    for (const r of (await db.query(`SELECT service_name, category, service_category FROM "${SCHEMA}".services`)).rows) {
      add(r.service_name, codeForCategory(r.category || r.service_category));
    }
    for (const r of (await db.query(`SELECT test_name FROM "${SCHEMA}".lab_tests`)).rows) add(r.test_name, '4110');
    for (const r of (await db.query(`SELECT item_name FROM "${SCHEMA}".inventory_items`)).rows) add(r.item_name, '4120');

    // Bills, with their service lines.
    const { rows: bills } = await db.query(
      `SELECT id, services FROM "${SCHEMA}".patient_bills WHERE services IS NOT NULL`
    );
    const billLines = new Map();
    for (const b of bills) {
      let svcs = b.services;
      if (typeof svcs === 'string') { try { svcs = JSON.parse(svcs); } catch { svcs = []; } }
      if (!Array.isArray(svcs)) continue;
      const lines = svcs
        .filter((s) => s && typeof s === 'object' && !s.isVoided)
        .map((s) => ({
          amount: parseFloat(s.totalPrice || s.total_price || 0) || 0,
          // Catalogue first; failing that, read the line's own name the way
          // utils/resolveRevenueAccount.js does at runtime, so a line typed by
          // hand ("Consultation Fee") lands where the application would now put
          // it rather than defaulting to 4100 and disagreeing with new postings.
          code: nameToCode.get(String(s.serviceName || s.name || '').trim().toLowerCase())
                || codeForCategory(String(s.serviceName || s.name || '')),
        }))
        .filter((l) => l.amount > 0);
      if (lines.length) billLines.set(b.id, lines);
    }

    // Both revenue tables. account_ledger is what the income statement reads;
    // gl_line_items is the entry detail behind it. Reclassifying only one would
    // leave the statement and the ledger detail telling different stories.
    const { rows: glLines } = await db.query(
      `SELECT li.id, li.gl_id, li.credit_amount::float AS amount, gl.reference_id AS bill_id,
              'gl_line_items' AS src
         FROM "${SCHEMA}".gl_line_items li
         JOIN "${SCHEMA}".general_ledger gl ON gl.id = li.gl_id
        WHERE li.account_id = $1 AND li.credit_amount > 0
          AND gl.reference_module = 'patient_billing'
       UNION ALL
       SELECT al.id, al.transaction_id AS gl_id, al.credit_amount::float, gl.reference_id,
              'account_ledger'
         FROM "${SCHEMA}".account_ledger al
         JOIN "${SCHEMA}".general_ledger gl ON gl.id = al.transaction_id
        WHERE al.account_id = $1 AND al.credit_amount > 0
          AND gl.reference_module = 'patient_billing'`,
      [acct4100]
    );

    const tally = {};
    let exact = 0, proportional = 0, unattributed = 0;
    const plan = [];

    for (const line of glLines) {
      const lines = billLines.get(line.bill_id);
      if (!lines || !lines.length) { unattributed++; tally['4100'] = (tally['4100'] || 0) + line.amount; continue; }

      // Exact: one service line, and only one, matches this credit.
      const matches = lines.filter((l) => Math.abs(l.amount - line.amount) < 0.005);
      let split;
      if (matches.length === 1) {
        split = [{ code: matches[0].code, amount: line.amount }];
        exact++;
      } else {
        const total = lines.reduce((s, l) => s + l.amount, 0);
        if (total <= 0) { unattributed++; tally['4100'] = (tally['4100'] || 0) + line.amount; continue; }
        const byCodeAmt = {};
        for (const l of lines) byCodeAmt[l.code] = (byCodeAmt[l.code] || 0) + l.amount;
        const codes = Object.keys(byCodeAmt);
        split = codes.map((c) => ({ code: c, amount: round2((byCodeAmt[c] / total) * line.amount) }));
        // Rounding remainder goes on the largest share, so the entry total is
        // preserved to the cent and the ledger stays balanced.
        const diff = round2(line.amount - split.reduce((s, x) => s + x.amount, 0));
        if (diff !== 0) split.sort((a, b) => b.amount - a.amount)[0].amount = round2(split[0].amount + diff);
        proportional++;
      }
      if (line.src === 'account_ledger') for (const part of split) tally[part.code] = (tally[part.code] || 0) + part.amount;
      plan.push({ lineId: line.id, glId: line.gl_id, split, src: line.src });
    }

    const names = { '4100': 'Patient Services', '4105': 'Consultation', '4110': 'Laboratory',
                    '4120': 'Pharmacy', '4130': 'Radiology', '4140': 'Procedure', '4150': 'Inpatient' };
    console.log(`\n  GL revenue lines on 4100: ${glLines.length}`);
    console.log(`  exact match: ${exact}   proportional: ${proportional}   left on 4100: ${unattributed}\n`);
    console.log('  Revenue would break down as:');
    for (const [code, amt] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${code}  ${(names[code] || code).padEnd(18)} ${round2(amt).toLocaleString()}`);
    }
    console.log(`    ${''.padEnd(24)} ${round2(Object.values(tally).reduce((s, n) => s + n, 0)).toLocaleString()}  (total unchanged)`);

    if (!APPLY) { console.log('\n  Re-run with --apply to write.'); return; }

    await db.query('BEGIN');
    let rewritten = 0, inserted = 0;
    for (const p of plan) {
      const first = p.split[0];
      // The original row is repointed rather than deleted, so its id — which
      // other rows may reference — survives.
      if (p.src === 'gl_line_items') {
        await db.query(
          `UPDATE "${SCHEMA}".gl_line_items SET account_id = $1, credit_amount = $2, base_credit_amount = $2 WHERE id = $3`,
          [byCode[first.code] || acct4100, first.amount, p.lineId]
        );
        rewritten++;
        for (const part of p.split.slice(1)) {
          await db.query(
            `INSERT INTO "${SCHEMA}".gl_line_items
               (id, gl_id, account_id, debit_amount, credit_amount, base_debit_amount, base_credit_amount, line_description, created_at, updated_at)
             SELECT gen_random_uuid()::text, $1, $2, 0, $3, 0, $3, line_description, NOW(), NOW()
               FROM "${SCHEMA}".gl_line_items WHERE id = $4`,
            [p.glId, byCode[part.code] || acct4100, part.amount, p.lineId]
          );
          inserted++;
        }
      } else {
        await db.query(
          `UPDATE "${SCHEMA}".account_ledger SET account_id = $1, credit_amount = $2 WHERE id = $3`,
          [byCode[first.code] || acct4100, first.amount, p.lineId]
        );
        rewritten++;
        for (const part of p.split.slice(1)) {
          await db.query(
            `INSERT INTO "${SCHEMA}".account_ledger
               (id, clinic_id, account_id, transaction_id, transaction_date, debit_amount, credit_amount,
                reference_number, description, posted_by, posted_date, is_posted, source_module, created_at, updated_at)
             SELECT gen_random_uuid()::text, clinic_id, $1, transaction_id, transaction_date, 0, $2,
                    reference_number, description, posted_by, posted_date, is_posted, source_module, NOW(), NOW()
               FROM "${SCHEMA}".account_ledger WHERE id = $3`,
            [byCode[part.code] || acct4100, part.amount, p.lineId]
          );
          inserted++;
        }
      }
    }
    await db.query('COMMIT');
    console.log(`\n  ✅ applied — ${rewritten} lines repointed, ${inserted} added`);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });

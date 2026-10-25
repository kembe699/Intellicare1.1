#!/usr/bin/env node
/**
 * Put back the revenue the old bill-revenue sync wrongly reversed on
 * foreign-currency bills (see scanFxRevenueSync.js). One tenant at a time.
 *
 * DRY RUN BY DEFAULT: shows, per bill, the correcting entry that would be
 * posted — account by account, in base currency — and writes nothing (the
 * connection is opened read-only, so the database refuses any write).
 *
 * --apply posts it: a "Revenue brought in line" entry per bill, produced by the
 * app's own (fixed) AccountingService.syncBillRevenueToGL — the same entry the
 * app would post — dated to the bill's own day, crediting the revenue/tax
 * accounts and debiting the bill's receivable. Then it scans again.
 *
 *   DATABASE_URL=postgres://… node src/server/scripts/repairFxRevenueSync.js --schema tenant_demo
 *   DATABASE_URL=postgres://… node src/server/scripts/repairFxRevenueSync.js --schema tenant_demo --apply
 * Without DATABASE_URL it uses DB_* from src/server/.env / production.env.
 */
const path = require('path');

const args = process.argv.slice(2);
const si = args.indexOf('--schema');
const SCHEMA = si !== -1 ? args[si + 1] : null;
const APPLY = args.includes('--apply');
if (!SCHEMA || args.includes('--all')) {
  console.error('Usage: repairFxRevenueSync.js --schema <tenant> [--apply]   (one tenant at a time)');
  process.exit(1);
}

// Point the app's connection settings at DATABASE_URL, and stop config/database.js's
// dotenv override from swapping them back to whatever the local .env says.
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  Object.assign(process.env, {
    DB_HOST: u.hostname, DB_PORT: u.port || '5432', DB_NAME: u.pathname.slice(1),
    DB_USER: decodeURIComponent(u.username), DB_PASSWORD: decodeURIComponent(u.password), DB_SSL: ['localhost', '127.0.0.1'].includes(u.hostname) ? 'false' : 'true',
  });
}
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../production.env') });
const originalConfig = dotenv.config.bind(dotenv);
dotenv.config = (opts) => originalConfig({ ...opts, override: false });
// This is an explicit, approved repair — it runs whatever the kill switch says.
if (APPLY) process.env.LEDGER_SWEEPER_REVENUE_SYNC = 'true';

const { Client } = require('pg');
const { scanTenant, clientConfig } = require('./scanFxRevenueSync');

const fmt = (n) => Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const c = new Client(clientConfig());
  await c.connect();
  const before = await scanTenant(c, SCHEMA);
  const todo = before.bills.filter((b) => b.needs_repair);
  console.log(`${SCHEMA} (base ${before.base}): ${todo.length} bill(s) to repair, revenue missing ${before.base} ${fmt(before.totals.missing || 0)}`
    + (before.cancelled.length ? `; cancelled bills left alone: ${before.cancelled.map((b) => b.bill_number).join(', ')}` : ''));
  if (!todo.length) { await c.end(); return; }

  const { buildSequelize } = require('../config/dbConnectionOptions');
  const { createModels } = require('../models');
  const tenantContext = require('../tenantContext');
  const sequelize = buildSequelize(SCHEMA, { logging: false });
  if (!APPLY) {
    sequelize.addHook('afterConnect', async (connection) => {
      await connection.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    });
  }
  const models = createModels(sequelize);
  const AccountingService = require('../services/AccountingService');

  const codes = new Map((await sequelize.query('SELECT id::text id, account_code, account_name FROM chart_of_accounts'))[0].map((a) => [a.id, a]));
  const name = (id) => { const a = codes.get(String(id)); return a ? `${a.account_code} ${a.account_name}` : id; };

  await tenantContext.run({ sequelize, models }, async () => {
    for (const b of todo) {
      console.log(`\n${b.bill_number} (${b.bill_date}) ${b.currency} ${fmt(b.total)} @ ${b.booked_rate} = ${before.base} ${fmt(b.worth_base)}; posted ${fmt(b.posted_base)}; missing ${fmt(b.missing_base)}`);
      if (!APPLY) {
        const plan = await AccountingService.syncBillRevenueToGL(b.bill_id, 'fx-repair', { dryRun: true });
        if (!plan || typeof plan !== 'object') { console.log('  nothing would be posted'); continue; }
        console.log(`  would post "Revenue brought in line with bill ${plan.billNumber}", dated ${plan.billDay}, ${before.base}:`);
        for (const l of plan.lineItems) {
          console.log(`    ${name(l.account_id).padEnd(40)} Dr ${fmt(l.debit_amount || 0).padStart(14)}  Cr ${fmt(l.credit_amount || 0).padStart(14)}`);
        }
      } else {
        const net = await AccountingService.syncBillRevenueToGL(b.bill_id, 'fx-repair');
        console.log(`  posted: revenue ${net >= 0 ? '+' : ''}${fmt(net)} ${before.base}`);
      }
    }
  });
  await sequelize.close();

  if (APPLY) {
    const after = await scanTenant(c, SCHEMA);
    console.log(`\nAfter: ${after.bills.filter((b) => b.needs_repair).length} bill(s) still need repair, revenue missing ${after.base} ${fmt(after.totals.missing || 0)}`);
  } else {
    console.log('\nDry run — nothing written. Re-run with --apply to post.');
  }
  await c.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });

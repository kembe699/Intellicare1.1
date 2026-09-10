/**
 * Dispense the backlog of prescriptions that were already paid for.
 *
 * Payment now dispenses automatically, but prescriptions raised before that sit
 * 'pending' with the medicine long since handed over the counter — the record
 * was simply never made, and stock was never reduced for it either.
 *
 * Uses the same matching and the same writes as the automatic path, so the
 * backlog is cleared exactly the way a payment taken today would clear it.
 *
 *   node src/server/scripts/dispensePaidBacklog.js --schema tenant_nation
 *   node src/server/scripts/dispensePaidBacklog.js --schema tenant_nation --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Sequelize } = require('sequelize');
const { dispensePaidFor } = require('../services/autoDispense');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si >= 0 ? args[si + 1] : null;

if (!SCHEMA) {
  console.error('Usage: dispensePaidBacklog.js --schema <tenant_schema> [--apply]');
  process.exit(1);
}

async function main() {
  const sequelize = new Sequelize(
    process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD || '',
    {
      host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : (process.env.DB_HOST || '127.0.0.1'),
      port: parseInt(process.env.DB_PORT || '5432', 10),
      dialect: 'postgres',
      logging: false,
      dialectOptions: ['true', 'require'].includes(String(process.env.DB_SSL || '').toLowerCase())
        ? { ssl: { require: true, rejectUnauthorized: false } } : {},
      hooks: { async afterConnect(conn) { await conn.query(`SET search_path TO "${SCHEMA}", public`); } },
      pool: { max: 4, min: 0, acquire: 30000, idle: 10000 },
    }
  );

  console.log(`\n  schema: ${SCHEMA}`);
  console.log(`  mode:   ${APPLY ? 'APPLY (dispensing, stock will move)' : 'dry run (no writes)'}\n`);

  const [patients] = await sequelize.query(`
    SELECT DISTINCT p.patient_id
      FROM pharmacy_prescriptions p
      JOIN prescription_lines pl ON pl.prescription_id = p.id
     WHERE p.status IN ('pending', 'partial_dispensed')
       AND pl.status IN ('pending', 'partial')
       AND p.patient_id IS NOT NULL
  `);

  let dispensed = 0;
  let skipped = 0;
  const reasons = new Map();

  for (const { patient_id } of patients) {
    const outcome = await dispensePaidFor(sequelize, patient_id, null, { dryRun: !APPLY });
    dispensed += outcome.dispensed.length;
    skipped += outcome.skipped.length;
    for (const s of outcome.skipped) {
      const key = s.reason.slice(0, 60);
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
    for (const d of outcome.dispensed) {
      console.log(`  ${APPLY ? 'dispensed' : 'would dispense'}  ${d.prescription.padEnd(16)} ${String(d.quantity).padStart(4)}  ${d.drug}`);
    }
  }

  console.log('');
  console.log(`  ${patients.length} patient(s) checked.`);
  console.log(`  ${dispensed} line(s) ${APPLY ? 'dispensed' : 'would be dispensed'}, ${skipped} left pending.`);
  if (reasons.size) {
    console.log('\n  left pending because:');
    for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)}  ${reason}`);
    }
  }
  if (!APPLY) console.log('\n  Re-run with --apply to dispense and move stock.\n');
  else console.log('');

  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

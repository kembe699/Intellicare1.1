/**
 * Grant a named user the sole_approver exemption for the multi-level
 * approval chains on the Expenses page (see feature/sole-approver-exemption,
 * routes/daily-expenses.js).
 *
 * Requested: let user malok (an admin) in tenant "nation" clear every level
 * of the 2-level Daily Expense approval and 3-level Supplier Bill approval
 * alone, and still pay once fully approved — admins already bypass every
 * authorize()/requireApprovalPermission() gate unconditionally, so payment
 * (POST /:id/pay, authorize('expenses.write') only, no co-approver check at
 * all) already works for an admin with no change needed. The one thing
 * that still blocked malok was the segregation-of-duties check inside the
 * approve routes themselves, which only lets a second approval through for
 * the SAME user when that user holds an explicit sole_approver=true grant
 * in approval_permissions for that approval_type. This script sets exactly
 * that grant — a data change, not a code change — upserting the same way
 * POST /api/approvals/permissions does (see routes/approvals.js), which is
 * also reachable through Setup > Approval Permissions in the UI now that
 * admins are listed there too.
 *
 * The third Expenses-page tab (Consultant Bills) has no multi-level
 * approval chain at all — POST /consultant-bill-payment is a single
 * authorize('expenses.write') check with no co-approver restriction — so
 * there's nothing to grant there; an admin can already do it.
 *
 * Matches a user by email OR display_name (case-insensitive substring) —
 * refuses to guess if that matches more than one person.
 *
 *   node src/server/scripts/grantSoleApprover.js --schema tenant_nation --user malok
 *   node src/server/scripts/grantSoleApprover.js --schema tenant_nation --user malok --apply
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../production.env') });

const { Client } = require('pg');
const crypto = require('crypto');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const si = args.indexOf('--schema');
const SCHEMA = si >= 0 ? args[si + 1] : null;
const ui = args.indexOf('--user');
const USER_QUERY = ui >= 0 ? args[ui + 1] : null;
const ti = args.indexOf('--types');
const TYPES = (ti >= 0 ? args[ti + 1] : 'expense_approve,supplier_bill_approve').split(',').map((s) => s.trim()).filter(Boolean);

if (!SCHEMA || !USER_QUERY) {
  console.error('Usage: grantSoleApprover.js --schema <tenant_schema> --user <email-or-name fragment> [--types expense_approve,supplier_bill_approve] [--apply]');
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

async function main() {
  const db = new Client(DB);
  await db.connect();
  await db.query(`SET search_path TO "${SCHEMA}", public`);

  console.log(`\n  schema: ${SCHEMA}`);
  console.log(`  mode:   ${APPLY ? 'APPLY (writing)' : 'dry run (no writes)'}`);
  console.log(`  types:  ${TYPES.join(', ')}\n`);

  await db.query(`ALTER TABLE approval_permissions ADD COLUMN IF NOT EXISTS sole_approver BOOLEAN NOT NULL DEFAULT FALSE`);

  const { rows: matches } = await db.query(
    `SELECT id, display_name, email, role, clinic_id FROM users WHERE is_active IS NOT FALSE AND (email ILIKE $1 OR display_name ILIKE $1)`,
    [`%${USER_QUERY}%`]
  );
  if (matches.length === 0) {
    console.log(`  No active user matches "${USER_QUERY}". Nothing to do.\n`);
    await db.end();
    return;
  }
  if (matches.length > 1) {
    console.log(`  "${USER_QUERY}" matches more than one user — refusing to guess:`);
    for (const m of matches) console.log(`    id=${m.id}  ${m.display_name} <${m.email}>  role=${m.role}`);
    console.log('\n  Re-run with a more specific --user value.\n');
    await db.end();
    return;
  }

  const user = matches[0];
  console.log(`  Target: id=${user.id}  ${user.display_name} <${user.email}>  role=${user.role}  clinic_id=${user.clinic_id}\n`);

  const { rows: existing } = await db.query(
    `SELECT approval_type, sole_approver FROM approval_permissions WHERE clinic_id = $1 AND user_id = $2 AND approval_type = ANY($3::text[])`,
    [user.clinic_id, user.id, TYPES]
  );
  for (const type of TYPES) {
    const row = existing.find((r) => r.approval_type === type);
    console.log(`  ${type.padEnd(24)} ${row ? (row.sole_approver ? 'already granted + sole_approver' : 'granted, sole_approver NOT set yet') : 'not granted at all yet'}`);
  }

  if (!APPLY) {
    console.log('\n  Re-run with --apply to write.\n');
    await db.end();
    return;
  }

  for (const type of TYPES) {
    await db.query(
      `INSERT INTO approval_permissions (id, clinic_id, user_id, approval_type, granted_by, sole_approver)
       VALUES ($1, $2, $3, $4, $3, true)
       ON CONFLICT (clinic_id, user_id, approval_type) DO UPDATE SET sole_approver = true, updated_at = NOW()`,
      [crypto.randomUUID(), user.clinic_id, user.id, type]
    );
  }

  console.log('\n  Done:');
  const { rows: after } = await db.query(
    `SELECT approval_type, sole_approver FROM approval_permissions WHERE clinic_id = $1 AND user_id = $2 AND approval_type = ANY($3::text[])`,
    [user.clinic_id, user.id, TYPES]
  );
  for (const r of after) console.log(`    ${r.approval_type.padEnd(24)} sole_approver=${r.sole_approver}`);
  console.log('');
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * auditBranchIsolation.js
 *
 * Run this script to:
 *   1. Identify records with NULL branch_id (data leakage risk).
 *   2. Optionally migrate them to a target branch.
 *
 * Usage:
 *   # Audit only (safe — no changes):
 *   node src/server/scripts/auditBranchIsolation.js
 *
 *   # Migrate NULL records to a specific branch:
 *   MIGRATE=true TARGET_BRANCH_ID=<uuid> node src/server/scripts/auditBranchIsolation.js
 *
 *   # Find users with no branch assignment:
 *   node src/server/scripts/auditBranchIsolation.js --users
 */

require('dotenv').config();
const { sequelize } = require('../models');

const MIGRATE = process.env.MIGRATE === 'true';
const TARGET_BRANCH_ID = process.env.TARGET_BRANCH_ID || null;
const CHECK_USERS = process.argv.includes('--users');

// Tables that carry a branch_id column
const BRANCH_TABLES = [
  'patients',
  'visits',
  'patient_queue',
  'lab_requests',
  'lab_results',
  'patient_bills',
  'receipts',
  'inventory_items',
  'inventory_batches',
  'prescriptions',
];

async function auditTable(table) {
  try {
    const [[{ null_count }]] = await sequelize.query(
      `SELECT COUNT(*) AS null_count FROM ${table} WHERE branch_id IS NULL`
    );
    return parseInt(null_count, 10);
  } catch (err) {
    // Table may not have branch_id column yet
    return null;
  }
}

async function migrateTable(table, branchId) {
  const [[{ updated }]] = await sequelize.query(
    `UPDATE ${table} SET branch_id = ? WHERE branch_id IS NULL`,
    { replacements: [branchId] }
  );
  return updated;
}

async function checkUnassignedUsers() {
  const [rows] = await sequelize.query(`
    SELECT u.id, u.email, u.role, u.is_active,
           COUNT(ub.branch_id) AS branch_count
    FROM users u
    LEFT JOIN user_branches ub ON u.id = ub.user_id
    GROUP BY u.id, u.email, u.role, u.is_active
    HAVING COUNT(ub.branch_id) = 0
    ORDER BY u.email
  `);
  return rows;
}

async function listBranches() {
  const [rows] = await sequelize.query(
    `SELECT id, name FROM branches ORDER BY name`
  );
  return rows;
}

async function main() {
  console.log('\n========================================');
  console.log(' IntelliCare Branch Isolation Audit');
  console.log('========================================\n');

  // ── 1. NULL branch_id records ──────────────────────────────
  console.log('📋 STEP 1: Checking for NULL branch_id records...\n');

  let totalNulls = 0;
  const results = [];

  for (const table of BRANCH_TABLES) {
    const count = await auditTable(table);
    if (count === null) {
      results.push({ table, count: 'N/A (no branch_id column)' });
    } else {
      results.push({ table, count });
      totalNulls += count;
    }
  }

  console.table(results);

  if (totalNulls === 0) {
    console.log('✅ No NULL branch_id records found. Data isolation is clean.\n');
  } else {
    console.log(`⚠️  FOUND ${totalNulls} records with NULL branch_id across ${BRANCH_TABLES.length} tables.\n`);
    console.log('   These records are currently hidden from non-admin users (after the security fix).');
    console.log('   To make them visible again, run migration with MIGRATE=true TARGET_BRANCH_ID=<id>\n');
  }

  // ── 2. Available branches (helpful for migration) ──────────
  console.log('📋 STEP 2: Available branches in the system:\n');
  try {
    const branches = await listBranches();
    if (branches.length === 0) {
      console.log('   No branches found in the database!\n');
    } else {
      console.table(branches.map(b => ({ id: b.id, name: b.name })));
    }
  } catch (err) {
    console.log('   Could not fetch branches:', err.message, '\n');
  }

  // ── 3. Unassigned users ────────────────────────────────────
  if (CHECK_USERS) {
    console.log('📋 STEP 3: Checking for users with NO branch assignment...\n');
    try {
      const unassigned = await checkUnassignedUsers();
      if (unassigned.length === 0) {
        console.log('✅ All users have at least one branch assignment.\n');
      } else {
        console.log(`🚨 FOUND ${unassigned.length} users with NO branch assigned:\n`);
        console.table(unassigned.map(u => ({
          id: u.id,
          email: u.email,
          role: u.role,
          is_active: u.is_active,
        })));
        console.log('\n   These users will receive a 403 "no branch assigned" error when they log in.');
        console.log('   Fix: assign them to a branch via the admin panel or run:');
        console.log('   INSERT INTO user_branches (user_id, branch_id, is_primary) VALUES (...)\n');
      }
    } catch (err) {
      console.log('   Could not check unassigned users:', err.message, '\n');
    }
  }

  // ── 4. Optional migration ──────────────────────────────────
  if (MIGRATE && TARGET_BRANCH_ID) {
    console.log(`\n📋 STEP 4: Migrating NULL branch_id records → branch ${TARGET_BRANCH_ID}...\n`);

    for (const table of BRANCH_TABLES) {
      try {
        const nullCount = await auditTable(table);
        if (nullCount === null || nullCount === 0) continue;

        // Use raw query to get actual rows affected from UPDATE
        const [, meta] = await sequelize.query(
          `UPDATE ${table} SET branch_id = ? WHERE branch_id IS NULL`,
          { replacements: [TARGET_BRANCH_ID] }
        );
        const affected = meta?.rowCount ?? meta ?? 0;
        console.log(`  ✅ ${table}: migrated ${nullCount} records → branch ${TARGET_BRANCH_ID}`);
      } catch (err) {
        console.log(`  ❌ ${table}: failed — ${err.message}`);
      }
    }

    console.log('\nMigration complete. Re-run without MIGRATE=true to verify.\n');
  } else if (MIGRATE && !TARGET_BRANCH_ID) {
    console.log('\n❌ MIGRATE=true but TARGET_BRANCH_ID not set. Skipping migration.');
    console.log('   Set TARGET_BRANCH_ID=<branch-uuid> to proceed.\n');
  }

  console.log('========================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script error:', err);
    process.exit(1);
  });

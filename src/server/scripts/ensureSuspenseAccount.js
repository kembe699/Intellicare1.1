const { sequelize } = require('../models');
const { healthcareChartOfAccounts: CATALOGUE } = require('./initializeChartOfAccounts');

// Account 9999 "Suspense - Unclassified" is AccountResolver.js's last-resort
// posting target (Part 3 of the central-categories feature) — used only when
// an item/service/expense has no override, no category account, and no
// clinic default, so a posting still happens (balanced, visible, logged as
// an accounting_exceptions row) instead of being silently skipped the way
// several call sites used to. Added to the main catalogue/ESSENTIAL set for
// brand-new tenants, same as every other essential code — but, same
// reasoning as ensureDailyExpenseAccounts.js (which this mirrors exactly),
// adding a code to that list alone never reaches an already-provisioned
// tenant, so this runs once per real tenant on every boot via
// migrateAcrossTenants in index.js's migration list.
const REQUIRED_CODE = '9999';

async function ensureSuspenseAccount(db = sequelize) {
  const def = CATALOGUE.find((a) => a.account_code === REQUIRED_CODE);
  if (!def) return; // kept in sync with initializeChartOfAccounts.js's catalogue

  const [clinics] = await db.query(`SELECT DISTINCT clinic_id FROM chart_of_accounts`);
  const clinicIds = clinics.map((c) => c.clinic_id).length ? clinics.map((c) => c.clinic_id) : [1];

  for (const clinicId of clinicIds) {
    const [existing] = await db.query(
      `SELECT id, is_active FROM chart_of_accounts WHERE clinic_id = :cid AND account_code = :code LIMIT 1`,
      { replacements: { cid: clinicId, code: REQUIRED_CODE } }
    );
    if (existing.length === 0) {
      await db.query(
        `INSERT INTO chart_of_accounts
           (id, clinic_id, account_code, account_name, account_type, sub_account_type,
            balance_type, opening_balance, is_active, description, created_at, updated_at)
         VALUES (gen_random_uuid()::text, :cid, :code, :name, :type, :subType, :balanceType, 0, TRUE, :description, NOW(), NOW())`,
        {
          replacements: {
            cid: clinicId, code: REQUIRED_CODE, name: def.account_name, type: def.account_type,
            subType: def.sub_account_type || null, balanceType: def.balance_type,
            description: def.description || null,
          },
        }
      );
    } else if (!existing[0].is_active) {
      await db.query(`UPDATE chart_of_accounts SET is_active = TRUE WHERE id = :id`, {
        replacements: { id: existing[0].id },
      });
    }
  }
}

module.exports = { ensureSuspenseAccount };

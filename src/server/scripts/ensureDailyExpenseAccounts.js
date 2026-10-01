const { sequelize } = require('../models');
const { healthcareChartOfAccounts: CATALOGUE } = require('./initializeChartOfAccounts');

// Every chart-of-accounts code routes/daily-expenses.js's CATEGORY_EXPENSE_CODE
// posts to, besides the ones already covered elsewhere in this app (5110/5120
// by ensureHRTables.js's payroll force-activation, 5610/5900/5400 already
// essential). A tenant provisioned before a category's account was added to
// ESSENTIAL_ACCOUNT_CODES has the account seeded but INACTIVE (or, for 5440,
// Administrative Expenses, added after that tenant was provisioned at all, so
// it may not exist yet) — getAccountByCode only returns active accounts, so
// paying an expense in that category silently fails to post to GL (the
// expense is still marked paid; only a console.error is logged). Adding a
// code here alone never retroactively fixes an already-provisioned tenant —
// see migrateAcrossTenants.js's own docs — so this runs on every boot, same
// as the Fixed Assets/Theatre self-heal.
const REQUIRED_CODES = ['5200', '5310', '5330', '5440', '5800'];

async function ensureDailyExpenseAccounts(db = sequelize) {
  const [clinics] = await db.query(`SELECT DISTINCT clinic_id FROM chart_of_accounts`);
  const clinicIds = clinics.map((c) => c.clinic_id).length ? clinics.map((c) => c.clinic_id) : [1];

  for (const code of REQUIRED_CODES) {
    const def = CATALOGUE.find((a) => a.account_code === code);
    if (!def) continue; // kept in sync with initializeChartOfAccounts.js's catalogue

    for (const clinicId of clinicIds) {
      const [existing] = await db.query(
        `SELECT id, is_active FROM chart_of_accounts WHERE clinic_id = :cid AND account_code = :code LIMIT 1`,
        { replacements: { cid: clinicId, code } }
      );
      if (existing.length === 0) {
        await db.query(
          `INSERT INTO chart_of_accounts
             (id, clinic_id, account_code, account_name, account_type, sub_account_type,
              balance_type, opening_balance, is_active, description, created_at, updated_at)
           VALUES (gen_random_uuid()::text, :cid, :code, :name, :type, :subType, :balanceType, 0, TRUE, :description, NOW(), NOW())`,
          {
            replacements: {
              cid: clinicId, code, name: def.account_name, type: def.account_type,
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
}

module.exports = { ensureDailyExpenseAccounts };

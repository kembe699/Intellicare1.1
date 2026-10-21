/**
 * Best-effort ALTERs adding employee-portal-login columns to the existing
 * employees table. Same idempotent, information_schema-checked shape as
 * employees.consultation_fee_percentage/salary_structure_id in
 * ensureHRTables.js — see tenantDb.js's buildTenantConnection for why this
 * runs per tenant connection rather than as a one-off boot migration.
 *
 * portal_code_hash/portal_pin_hash are bcrypt hashes only — the HR-issued
 * 6-digit code and the employee's own PIN are never stored in the clear.
 * portal_pin_set_at is null until the employee completes the first-login
 * "set your PIN" step; portal_code_hash is cleared (set to null) the moment
 * that happens, so the one-time code stops working as designed.
 */
async function addColumnIfMissing(sequelize, table, column, ddl) {
  try {
    const [[col]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { replacements: { table, column } }
    );
    // COUNT(*) comes back as the string "0" via the pg driver — parseInt,
    // not a truthiness check, same gotcha noted in ensureHRTables.js.
    if (parseInt(col.cnt, 10) === 0) {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  } catch (e) { /* best-effort column add */ }
}

async function ensureEmployeePortalAccess(sequelize) {
  await addColumnIfMissing(sequelize, 'employees', 'portal_access_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumnIfMissing(sequelize, 'employees', 'portal_code_hash', 'VARCHAR(255)');
  await addColumnIfMissing(sequelize, 'employees', 'portal_pin_hash', 'VARCHAR(255)');
  await addColumnIfMissing(sequelize, 'employees', 'portal_pin_set_at', 'TIMESTAMPTZ');
  await addColumnIfMissing(sequelize, 'employees', 'portal_locked_until', 'TIMESTAMPTZ');
  await addColumnIfMissing(sequelize, 'employees', 'portal_failed_attempts', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(sequelize, 'employees', 'portal_last_login_at', 'TIMESTAMPTZ');
}

module.exports = { ensureEmployeePortalAccess, addColumnIfMissing };

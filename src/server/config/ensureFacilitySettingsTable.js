/**
 * Per-facility operational toggles that used to be hardcoded tenant checks
 * in the frontend (e.g. `user.tenantCode === 'kuelmc'` for the billing
 * redirect after queuing) — now a real, admin-editable settings row instead
 * of something only a code change could flip. One row per clinic_id, same
 * clinic-scoping convention as billing_settings. Ensured per-tenant the same
 * way as every other ensureXxxTable call in tenantDb.js.
 */
async function ensureFacilitySettingsTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS facility_settings (
      clinic_id INTEGER PRIMARY KEY,
      queue_receipt_enabled BOOLEAN NOT NULL DEFAULT true,
      billing_redirect_after_queue_enabled BOOLEAN NOT NULL DEFAULT true,
      patient_number_prefix VARCHAR(20) NOT NULL DEFAULT 'PTN',
      patient_number_suffix VARCHAR(20) NOT NULL DEFAULT '',
      updated_by VARCHAR(36),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Setup › Configurations › Approvals & controls. Every default is the
  // behaviour the system had before the setting existed, so adding a column
  // never changes how a facility works until an admin flips it.
  const add = (col, ddl) => sequelize.query(`ALTER TABLE facility_settings ADD COLUMN IF NOT EXISTS ${col} ${ddl}`).catch(() => {});
  await add('approvals_allow_same_person', 'BOOLEAN NOT NULL DEFAULT false');
  await add('expense_approvals_required', 'INTEGER NOT NULL DEFAULT 2');
  await add('supplier_bill_approvals_required', 'INTEGER NOT NULL DEFAULT 3');
  await add('receipt_void_requires_approval', 'BOOLEAN NOT NULL DEFAULT true');
  await add('credit_note_separate_approver', 'BOOLEAN NOT NULL DEFAULT false');
}

module.exports = { ensureFacilitySettingsTable };

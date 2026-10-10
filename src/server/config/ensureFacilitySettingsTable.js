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
}

module.exports = { ensureFacilitySettingsTable };

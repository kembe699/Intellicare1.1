/**
 * DDL only — creates the clinical_insights table if it doesn't exist yet.
 * Same shape as ensureHRTables.js/ensureNotificationsTable.js: safe to call
 * repeatedly, safe to call per-tenant (see tenantDb.js's buildTenantConnection
 * for why per-tenant call sites, not a one-off boot migration, are how a
 * brand-new table actually reaches every schema).
 *
 * One row per generation attempt, not one row per visit — "regenerate" always
 * inserts a new row rather than overwriting the previous result, so the
 * history of what was suggested is never lost. order_id/clinic_id/branch_id
 * match lis_test_orders' own column types (order_id/clinic_id are VARCHAR
 * there, branch_id INTEGER) since this table is keyed off that one.
 */
async function ensureClinicalInsightsTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS clinical_insights (
      id VARCHAR(36) PRIMARY KEY,
      order_id VARCHAR(36) NOT NULL,
      clinic_id VARCHAR(50),
      branch_id INTEGER,
      requested_by INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      model VARCHAR(100),
      response JSONB,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_clinical_insights_order_id ON clinical_insights(order_id, created_at DESC)
  `);
}

module.exports = { ensureClinicalInsightsTable };

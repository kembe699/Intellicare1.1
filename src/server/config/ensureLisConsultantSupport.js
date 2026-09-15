/**
 * Lets a visit be attributed to a consultant who has no linked user account —
 * lis_test_orders.doctor_id is a plain FK to users.id, so a consultant with
 * no account (linking one is optional, see hr.js) has no valid value to put
 * there. consultant_id is a parallel, nullable FK to employees.id used only
 * when the selected provider has no user_id; a consultant who does have a
 * linked account is still recorded via doctor_id as before, so a visit only
 * ever sets one of the two.
 *
 * Same per-tenant self-migration shape as ensureHRTables.js — see
 * tenantDb.js's buildTenantConnection for why this needs to be called per
 * tenant connection rather than as a boot-time IIFE against one static
 * database (lisModule.js's own module-scope IIFEs are exactly that older,
 * single-tenant-only pattern, which is why this lives here instead of
 * alongside them).
 */
async function ensureLisConsultantSupport(sequelize) {
  try {
    const [[col]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'lis_test_orders' AND column_name = 'consultant_id'`
    );
    if (parseInt(col.cnt, 10) === 0) {
      await sequelize.query(`ALTER TABLE lis_test_orders ADD COLUMN consultant_id VARCHAR(36)`);
    }
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant */ }

  try {
    const [[idx]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'lis_test_orders_consultant_idx'`
    );
    if (parseInt(idx.cnt, 10) === 0) {
      await sequelize.query(`CREATE INDEX lis_test_orders_consultant_idx ON lis_test_orders(consultant_id)`);
    }
  } catch (e) { /* best-effort */ }
}

module.exports = { ensureLisConsultantSupport };

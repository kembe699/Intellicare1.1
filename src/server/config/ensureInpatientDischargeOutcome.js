/**
 * Records what actually happened to a discharged patient — alive, dead, or
 * absconded — as its own column, separate from inpatient_admissions.status
 * (active/discharged, which only tracks whether the bed is still occupied).
 * Conflating the two would make "discharged" ambiguous between a normal
 * discharge and a death or an unauthorized departure, which the ward and
 * records teams need to tell apart and filter on separately.
 *
 * Same per-tenant self-migration shape as ensureInpatientConsultantSupport.js
 * — see tenantDb.js's buildTenantConnection for why this runs per tenant
 * connection rather than as a boot-time IIFE against one static database.
 */
async function ensureInpatientDischargeOutcome(sequelize) {
  try {
    const [[col]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inpatient_admissions' AND column_name = 'discharge_outcome'`
    );
    if (parseInt(col.cnt, 10) === 0) {
      await sequelize.query(`ALTER TABLE inpatient_admissions ADD COLUMN discharge_outcome VARCHAR(20)`);
    }
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant */ }
}

module.exports = { ensureInpatientDischargeOutcome };

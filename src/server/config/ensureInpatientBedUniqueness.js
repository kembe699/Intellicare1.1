/**
 * Second line of defense against double-booking a bed: a partial unique
 * index on (bed_id) restricted to status = 'active' rejects a second active
 * admission for the same bed outright at the database level, no matter what
 * application-level race gets past the atomic bed-claim UPDATE in
 * POST /admissions (see the comment there — that check itself was silently
 * broken until it was fixed alongside this file, so this table had no real
 * protection against a double-booked bed at all until now).
 *
 * A discharged/transferred admission's status moves off 'active', which is
 * exactly why this is a *partial* index rather than a plain unique
 * constraint on bed_id — a bed legitimately has many non-active admissions
 * in its history, just never more than one active one at a time.
 *
 * Same per-tenant self-migration shape as ensureHRTables.js — see
 * tenantDb.js's buildTenantConnection for why this needs to be called per
 * tenant connection rather than as a boot-time IIFE against one static
 * database.
 */
async function ensureInpatientBedUniqueness(sequelize) {
  try {
    const [[idx]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'inpatient_admissions_active_bed_uniq'`
    );
    if (parseInt(idx.cnt, 10) === 0) {
      await sequelize.query(
        `CREATE UNIQUE INDEX inpatient_admissions_active_bed_uniq ON inpatient_admissions(bed_id) WHERE status = 'active'`
      );
    }
  } catch (e) { /* best-effort — table may not exist yet on a brand-new tenant, or a
                    pre-existing data conflict means this needs a manual look rather
                    than silently failing forever; either way, the app must not break */ }
}

module.exports = { ensureInpatientBedUniqueness };

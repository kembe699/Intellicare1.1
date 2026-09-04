const { sequelize } = require('../models');

/**
 * Which clinic_id this tenant's records are actually filed under.
 *
 * clinic_id scopes nearly every operational query, so a user pinned to a clinic
 * the tenant holds no data in signs in successfully and then sees empty screens:
 * no products to dispense, no patients to bill, no error anywhere. That is not
 * hypothetical — a pharmacy account sat on clinic 1 while all 558 inventory
 * items and every other user on that tenant were on clinic 6.
 *
 * The value is derived from the tenant's own rows rather than assumed, in
 * descending order of confidence:
 *
 *   1. inventory — stock is created by the facility itself, never chosen from a
 *      dropdown at a registration desk, so it is the least ambiguous signal;
 *   2. the clinic most existing users already share;
 *   3. the first configured clinic;
 *
 * and only then a bare 1, which is the historical single-tenant default and is
 * wrong often enough that reaching it is worth logging.
 */
async function resolveTenantClinicId() {
  const attempts = [
    ['inventory', `SELECT clinic_id AS id FROM inventory_items WHERE clinic_id IS NOT NULL
                    GROUP BY clinic_id ORDER BY count(*) DESC LIMIT 1`],
    ['users',     `SELECT clinic_id AS id FROM users WHERE clinic_id IS NOT NULL
                    GROUP BY clinic_id ORDER BY count(*) DESC LIMIT 1`],
    ['clinic_names', `SELECT id FROM clinic_names ORDER BY id LIMIT 1`],
  ];
  for (const [source, sql] of attempts) {
    try {
      const [[row]] = await sequelize.query(sql);
      if (row?.id) return { clinicId: parseInt(row.id, 10), source };
    } catch { /* table may not exist on a bare tenant — try the next signal */ }
  }
  return { clinicId: 1, source: 'fallback' };
}

/** True when this clinic_id is one the tenant has actually configured. */
async function clinicExists(clinicId) {
  if (!clinicId) return false;
  try {
    const [[row]] = await sequelize.query(
      'SELECT 1 AS ok FROM clinic_names WHERE id = :id LIMIT 1',
      { replacements: { id: clinicId } });
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Warn when an account is pinned to a clinic holding none of the tenant's stock.
 * Returns the canonical clinic when the account looks stranded, otherwise null.
 */
async function checkUserCanSeeData(user) {
  const { clinicId: canonical } = await resolveTenantClinicId();
  if (!user?.clinic_id || parseInt(user.clinic_id, 10) === canonical) return null;
  try {
    const [[row]] = await sequelize.query(
      'SELECT count(*)::int AS n FROM inventory_items WHERE clinic_id = :cid',
      { replacements: { cid: user.clinic_id } });
    if ((row?.n || 0) > 0) return null;  // a real second clinic with its own stock
  } catch { /* fall through to the warning */ }
  return canonical;
}

module.exports = { resolveTenantClinicId, clinicExists, checkUserCanSeeData };

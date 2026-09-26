const { radiologyServices } = require('./radiologyServicesData');

/**
 * Seeds the curated radiology exam catalog for a clinic, as `services` rows
 * under category='Radiology' (kept distinct from the existing 'Diagnostic'
 * category so it can be fetched/filtered separately by the Radiology module
 * and excluded from the generic services picker). Safely re-runnable — same
 * shape as seedLabServices.js: skips any exam whose name already exists
 * (case-insensitive, scoped to the caller's own branch or tenant-wide for
 * admins) instead of failing on a duplicate.
 */
async function seedRadiologyServices(clinicId, createdBy, { Service, resolveRevenueAccount }, branchId, isAdmin) {
  const { Op } = require('sequelize');
  const existing = await Service.findAll({
    attributes: ['service_name'],
    where: (isAdmin || !branchId)
      ? undefined
      : { [Op.or]: [{ branch_id: branchId }, { branch_id: null }] },
  });
  const existingNames = new Set(existing.map((s) => s.service_name.toLowerCase()));

  const toCreate = radiologyServices.filter((s) => !existingNames.has(s.name.toLowerCase()));
  if (toCreate.length === 0) {
    return { success: false, message: 'All radiology exams are already in the catalog', created: 0, skipped: radiologyServices.length };
  }

  const revenueAccountId = await resolveRevenueAccount('Radiology', clinicId);

  const rows = toCreate.map((s) => ({
    service_name: s.name,
    category: 'Radiology',
    price: s.price,
    description: `Radiology — ${s.sub}`,
    is_active: true,
    created_by: createdBy || 'system',
    revenue_account_id: revenueAccountId || null,
    branch_id: branchId || null,
  }));

  const created = await Service.bulkCreate(rows);

  return {
    success: true,
    message: `Added ${created.length} radiology exam${created.length === 1 ? '' : 's'}${toCreate.length < radiologyServices.length ? ` (${radiologyServices.length - toCreate.length} already existed)` : ''}`,
    created: created.length,
    skipped: radiologyServices.length - toCreate.length,
  };
}

module.exports = { seedRadiologyServices };

const { labServices } = require('./labServicesData');

/**
 * Seeds the curated lab-test catalog for a clinic. Safely re-runnable —
 * skips any service whose name already exists (case-insensitive) instead of
 * failing on the services table's unique constraint, so clicking the button
 * again after adding a few by hand just fills in whatever's still missing.
 *
 * The "already exists" check used to look at every service in the tenant
 * regardless of branch — once services.service_name became branch-scoped
 * (see ensureServiceNameUniqueness.js), that meant Branch A seeding the
 * catalog first made Branch B's own seed attempt see every name as already
 * taken and silently create nothing, even though Branch B had zero services
 * of its own yet. This is the same fix seedCommonLabTests.js got for
 * lab_tests: the existence check is now scoped to the caller's own branch
 * (or tenant-wide for admins), and every created row is stamped with the
 * caller's branch_id.
 */
async function seedLabServices(clinicId, createdBy, { Service, resolveRevenueAccount }, branchId, isAdmin) {
  const { Op } = require('sequelize');
  const existing = await Service.findAll({
    attributes: ['service_name'],
    where: (isAdmin || !branchId)
      ? undefined
      : { [Op.or]: [{ branch_id: branchId }, { branch_id: null }] },
  });
  const existingNames = new Set(existing.map((s) => s.service_name.toLowerCase()));

  const toCreate = labServices.filter((s) => !existingNames.has(s.name.toLowerCase()));
  if (toCreate.length === 0) {
    return { success: false, message: 'All lab services are already in the catalog', created: 0, skipped: labServices.length };
  }

  const revenueAccountId = await resolveRevenueAccount('Diagnostic', clinicId);

  const rows = toCreate.map((s) => ({
    service_name: s.name,
    category: 'Diagnostic',
    price: s.price,
    description: `Laboratory — ${s.sub}`,
    is_active: true,
    created_by: createdBy || 'system',
    revenue_account_id: revenueAccountId || null,
    branch_id: branchId || null,
  }));

  const created = await Service.bulkCreate(rows);

  return {
    success: true,
    message: `Added ${created.length} lab service${created.length === 1 ? '' : 's'}${toCreate.length < labServices.length ? ` (${labServices.length - toCreate.length} already existed)` : ''}`,
    created: created.length,
    skipped: labServices.length - toCreate.length,
  };
}

module.exports = { seedLabServices };

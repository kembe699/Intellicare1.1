const crypto = require('crypto');
const { labTestsSeed } = require('./labTestsSeedData');

/**
 * Seeds the curated common lab-test catalog (see labTestsSeedData.js), each
 * with one component matching the test itself (the source sheet has no
 * finer breakdown) and linked to a Service — found by exact name match
 * against the existing catalog, or created on the spot if nothing matches,
 * so every seeded test is billable immediately rather than only sometimes
 * getting linked depending on whether a same-named service happens to
 * already exist.
 *
 * Safely re-runnable: an existing test_code is updated in place (price,
 * category, service link refreshed) rather than duplicated, matching the
 * same idempotent pattern as the chart-of-accounts and services seeders.
 *
 * branchId scopes the existing-test-code lookup and stamps new rows the
 * same way — which lab tests a branch offers is a real per-branch
 * capability, not shared reference data, so seeding the common catalog at
 * one branch must not silently update or shadow another branch's tests.
 * null (an admin with no branch selected) falls back to a tenant-wide,
 * branch-less row — same convention labTests.js's other routes use.
 */
async function seedCommonLabTests(clinicId, createdBy, { LabTest, Service, resolveRevenueAccount }, branchId = null) {
  const sequelize = LabTest.sequelize;
  const { Op } = require('sequelize');
  let created = 0;
  let updated = 0;
  let servicesCreated = 0;

  for (const row of labTestsSeed) {
    // Find-or-create the linked service — scoped to this branch (NULL-inclusive, so an
    // existing not-yet-backfilled shared service still matches) the same way the
    // lab_tests lookup below already is. Without this, seeding the catalog at Branch A
    // first would make Branch B's later seed run find Branch A's same-named service by
    // this unscoped name match and silently link to (and never create its own copy of)
    // it, even though services are now branch-isolated.
    let service = await Service.findOne({
      where: {
        [Op.and]: [
          sequelize.where(sequelize.fn('LOWER', sequelize.col('service_name')), row.service.toLowerCase()),
          branchId ? { [Op.or]: [{ branch_id: branchId }, { branch_id: null }] } : {},
        ],
      },
    });
    if (!service) {
      const revenueAccountId = await resolveRevenueAccount('Diagnostic', clinicId);
      service = await Service.create({
        service_name: row.service,
        category: 'Diagnostic',
        price: row.price,
        description: `Laboratory — ${row.category}`,
        is_active: true,
        created_by: createdBy || 'system',
        revenue_account_id: revenueAccountId || null,
        branch_id: branchId || null,
      });
      servicesCreated += 1;
    }

    const existingReplacements = [row.code, clinicId];
    const branchSql = branchId ? ' AND branch_id = ?' : ' AND branch_id IS NULL';
    if (branchId) existingReplacements.push(branchId);
    const [[existingTest]] = await sequelize.query(
      `SELECT id FROM lab_tests WHERE test_code = ? AND clinic_id = ?${branchSql}`,
      { replacements: existingReplacements }
    );

    let testId;
    if (existingTest) {
      testId = existingTest.id;
      await sequelize.query(
        `UPDATE lab_tests SET test_name = ?, category = ?, price = ?, service_id = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [row.name, row.category, row.price, service.id, testId] }
      );
      updated += 1;
    } else {
      testId = crypto.randomUUID();
      await sequelize.query(
        `INSERT INTO lab_tests (id, test_code, test_name, category, price, service_id, clinic_id, branch_id, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())`,
        { replacements: [testId, row.code, row.name, row.category, row.price, service.id, clinicId, branchId] }
      );
      created += 1;
    }

    // Most rows get one component matching the test itself — the source
    // sheet has no finer breakdown to seed from — but a handful (e.g. CBC)
    // carry their own real component panel in row.components. Replace
    // rather than duplicate on re-run either way.
    const components = row.components && row.components.length > 0
      ? row.components
      : [{ name: row.name, unit: '', range: '' }];

    await sequelize.query('DELETE FROM lab_test_components WHERE lab_test_id = ?', { replacements: [testId] });
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      await sequelize.query(
        `INSERT INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        { replacements: [crypto.randomUUID(), testId, comp.name, comp.unit || '', comp.range || '', i + 1] }
      );
    }
  }

  return {
    success: created + updated > 0,
    message: `${created} test${created === 1 ? '' : 's'} added, ${updated} updated${servicesCreated > 0 ? `, ${servicesCreated} new service${servicesCreated === 1 ? '' : 's'} created` : ''}`,
    created,
    updated,
    servicesCreated,
  };
}

module.exports = { seedCommonLabTests };

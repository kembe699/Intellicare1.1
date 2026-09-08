const { sequelize } = require('../models');

// Resolve revenue_account_id for a service/lab-test based on its category.
// Shared by routes/services.js and scripts/seedCommonLabTests.js so both
// pick the same chart-of-accounts revenue line for the same kind of category.
async function resolveRevenueAccount(category, clinicId) {
  const cat = (category || '').toLowerCase();
  // Order matters: the first match wins, so the more specific patterns are
  // tested before the broad ones. 4100 stays the catch-all for anything that
  // does not clearly belong to a service line, rather than a default everything
  // silently lands in.
  let code = '4100';
  if (/lab|laboratory|diagnostic|patholog|haemat|hemat/.test(cat)) code = '4110';
  else if (/pharma|drug|medic|dispens/.test(cat)) code = '4120';
  else if (/radio|imaging|xray|x-ray|scan|ultrasound|ct |mri/.test(cat)) code = '4130';
  else if (/proced|surgery|theater|theatre|operation|minor op/.test(cat)) code = '4140';
  else if (/inpatient|admission|bed|ward|nursing care/.test(cat)) code = '4150';
  else if (/consult|opd|outpatient|review|clinic visit/.test(cat)) code = '4105';
  const cid = clinicId || 1;
  const [[row]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE account_code = '${code}' AND clinic_id = ${cid} AND is_active = true LIMIT 1`
  ).catch(() => [[]]);
  if (row) return row.id;
  // Fallback: any revenue account
  const [[fallback]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE account_code = '4100' LIMIT 1`
  ).catch(() => [[]]);
  return fallback?.id || null;
}

/**
 * Work out which revenue account a bill line belongs to when nobody said.
 *
 * A bill stores its lines as JSON on patient_bills.services, and most callers
 * write only a name, a quantity and a price — the pharmacy and billing screens
 * post exactly that. AccountingService then grouped every line without a
 * revenue_account_id under one key and credited the lot to 4100, which is why
 * an income statement could show millions in "Patient Services Revenue" and
 * almost nothing against pharmacy or laboratory even though every sale was one
 * or the other.
 *
 * Rather than requiring each caller to remember a category, the line is
 * identified here from what the tenant already knows about it:
 *
 *   1. an account the caller supplied            — always wins
 *   2. the services catalogue, by id then name   — it carries a real category
 *   3. the lab test catalogue, by name           — laboratory
 *   4. the inventory catalogue, by id then name  — dispensed stock, pharmacy
 *   5. the words in the line's own name          — last resort before 4100
 *
 * Anything still unidentified keeps falling to 4100, which stays the honest
 * "we don't know" bucket rather than a silent default for everything.
 */
async function resolveRevenueAccountForLine(line, clinicId) {
  if (!line) return null;
  if (line.revenue_account_id) return line.revenue_account_id;
  if (line.revenueCategory) return resolveRevenueAccount(line.revenueCategory, clinicId);

  const id = line.serviceId ?? line.service_id ?? null;
  const name = (line.serviceName || line.service_name || line.item_name || '').trim();
  if (!id && !name) return null;

  const lookups = [
    // [sql, replacements, category-or-null]  — null category means "use the row's own"
    id   ? ['SELECT category FROM services WHERE id = :id LIMIT 1', { id }, null] : null,
    name ? ['SELECT category FROM services WHERE LOWER(service_name) = LOWER(:name) LIMIT 1', { name }, null] : null,
    name ? ['SELECT 1 AS hit FROM lab_tests WHERE LOWER(test_name) = LOWER(:name) LIMIT 1', { name }, 'laboratory'] : null,
    id   ? ['SELECT 1 AS hit FROM inventory_items WHERE id = :id LIMIT 1', { id: String(id) }, 'pharmacy'] : null,
    name ? ['SELECT 1 AS hit FROM inventory_items WHERE LOWER(item_name) = LOWER(:name) LIMIT 1', { name }, 'pharmacy'] : null,
  ].filter(Boolean);

  for (const [sql, replacements, forcedCategory] of lookups) {
    try {
      const [[row]] = await sequelize.query(sql, { replacements });
      if (!row) continue;
      const category = forcedCategory || row.category;
      if (category) return resolveRevenueAccount(category, clinicId);
    } catch (e) {
      // A catalogue this tenant does not have is not an error — try the next.
    }
  }

  // Nothing matched a catalogue: fall back to reading the name itself, which
  // catches things like "Consultation Fee" that were typed rather than picked.
  return resolveRevenueAccount(name, clinicId);
}

module.exports = { resolveRevenueAccount, resolveRevenueAccountForLine };


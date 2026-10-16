const { v4: uuidv4 } = require('uuid');

// Deducts whatever reagent/consumable a lab test is linked to, the moment
// that test is actually performed — mirrors the transactional pattern
// pharmacy dispensing already uses (routes/pharmacyModule.js's dispense
// handler): update the item, update its stock-by-location row, log an
// inventory_transactions entry. A test with no linked consumable is a no-op
// (the link is optional, per design).
//
// Never throws — a misconfigured link (bad tests_per_unit, missing item)
// must never block a lab result from being recorded. Callers should invoke
// this fire-and-forget after the result write succeeds, same as pharmacy's
// own GL-posting calls elsewhere in this codebase.
async function deductLabTestConsumables({ sequelize, clinicId, labTestId, quantityOfTests = 1, referenceType, referenceId, createdBy, branchId, transaction }) {
  if (!labTestId || !quantityOfTests) return { deducted: [] };

  const opts = transaction ? { transaction } : {};
  const deducted = [];

  try {
    const [links] = await sequelize.query(
      `SELECT ltc.id, ltc.inventory_item_id, ltc.location_id, ltc.tests_per_unit, ii.item_name
       FROM lab_test_consumables ltc
       JOIN inventory_items ii ON ii.id = ltc.inventory_item_id
       WHERE ltc.lab_test_id = :labTestId AND ltc.is_active = true`,
      { replacements: { labTestId }, ...opts }
    );

    for (const link of links) {
      try {
        const amount = Number(quantityOfTests) / Number(link.tests_per_unit);

        await sequelize.query(
          `UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :amount), updated_at = NOW() WHERE id = :itemId`,
          { replacements: { amount, itemId: link.inventory_item_id }, ...opts }
        );

        if (link.location_id) {
          await sequelize.query(
            `UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :amount), updated_at = NOW() WHERE item_id = :itemId AND location_id = :locationId`,
            { replacements: { amount, itemId: link.inventory_item_id, locationId: link.location_id }, ...opts }
          );
        }

        await sequelize.query(
          `INSERT INTO inventory_transactions
             (id, clinic_id, transaction_number, item_id, transaction_type, quantity_change,
              from_location_id, reference_type, reference_id, transaction_date, notes,
              lab_test_consumable_id, created_by, created_at, branch_id)
           VALUES
             (:txnId, :clinicId, :txnNumber, :itemId, 'lab_test_consumption', :quantityChange,
              :locationId, :referenceType, :referenceId, CURRENT_DATE, :notes,
              :linkId, :createdBy, NOW(), :branchId)`,
          {
            replacements: {
              txnId: uuidv4(), clinicId, txnNumber: `LTC-${Date.now()}`, itemId: link.inventory_item_id,
              quantityChange: -amount, locationId: link.location_id || null,
              referenceType: referenceType || 'lab_test', referenceId: referenceId || null,
              notes: `${link.item_name} — ${amount.toFixed(4)} unit(s) consumed for ${quantityOfTests} test(s) (${link.tests_per_unit} tests/unit)`,
              linkId: link.id, createdBy: createdBy || null, branchId: branchId || null,
            },
            ...opts,
          }
        );

        deducted.push({ inventory_item_id: link.inventory_item_id, item_name: link.item_name, amount });
      } catch (linkErr) {
        console.error(`deductLabTestConsumables: failed for link ${link.id} (item ${link.inventory_item_id}):`, linkErr.message);
      }
    }
  } catch (err) {
    console.error('deductLabTestConsumables: lookup failed for lab test', labTestId, ':', err.message);
  }

  return { deducted };
}

// Whether a lab test's linked consumable(s) can still cover at least one
// more test. A test with no links at all is always available.
async function getUnavailableLabTestIds(sequelize, clinicId) {
  const [rows] = await sequelize.query(
    `SELECT ltc.lab_test_id
     FROM lab_test_consumables ltc
     JOIN inventory_items ii ON ii.id = ltc.inventory_item_id
     WHERE ltc.is_active = true AND ltc.clinic_id = :clinicId
     GROUP BY ltc.lab_test_id
     HAVING MIN(ii.quantity_on_hand * ltc.tests_per_unit) < 1`,
    { replacements: { clinicId } }
  );
  return new Set(rows.map(r => r.lab_test_id));
}

module.exports = { deductLabTestConsumables, getUnavailableLabTestIds };

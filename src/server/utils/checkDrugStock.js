/**
 * Requested: a prescription must never be saved for more than what's
 * actually available in stock — enforced server-side (the authoritative
 * check; the UI's own quantity-vs-stock warnings, where they exist, are
 * just an earlier heads-up, not the real gate) rather than relying on each
 * caller to remember to check. Used by both POST /pharmacy-module/
 * prescriptions and POST /inpatient/prescriptions, which previously had no
 * stock check of any kind in either place.
 *
 * External lines (bought at an outside pharmacy, no drug_id) are always
 * skipped — there's no inventory item to check against, and that's the
 * whole point of marking a line external.
 *
 * Checks against the drug's current quantity_on_hand — not quantity_on_hand
 * minus reserved_quantity — matching how stock is already shown to a
 * prescriber in the drug picker (see pharmacyModule.js's GET /drugs,
 * stock_on_hand) and the one pre-existing client-side warning this already
 * had (LISTestOrders.tsx): reserved_quantity in this codebase tracks a
 * different workflow (see routes/inventory.js), not anything a pending
 * prescription itself puts on hold, so checking against it here would make
 * this check disagree with what the prescriber was just shown.
 */
async function findInsufficientStockLine(sequelize, lines) {
  for (const line of lines) {
    if (line.isExternal || !line.drugId) continue;
    const qty = parseFloat(line.quantity) || 0;
    if (qty <= 0) continue;

    let stockOnHand;
    let drugName;
    if (line.locationId) {
      const [[row]] = await sequelize.query(
        `SELECT i.item_name AS name, COALESCE(sbl.quantity_on_hand, 0) AS stock
         FROM inventory_items i
         LEFT JOIN stock_by_location sbl ON sbl.item_id = i.id AND sbl.location_id = :locationId
         WHERE i.id = :id`,
        { replacements: { id: line.drugId, locationId: line.locationId } }
      );
      if (!row) continue; // drug_id not found — let the INSERT's own error handling deal with it
      stockOnHand = parseFloat(row.stock) || 0;
      drugName = row.name;
    } else {
      const [[row]] = await sequelize.query(
        `SELECT item_name AS name, quantity_on_hand AS stock FROM inventory_items WHERE id = :id`,
        { replacements: { id: line.drugId } }
      );
      if (!row) continue;
      stockOnHand = parseFloat(row.stock) || 0;
      drugName = row.name;
    }

    if (qty > stockOnHand) {
      return { drugName, requested: qty, available: stockOnHand };
    }
  }
  return null;
}

module.exports = { findInsufficientStockLine };

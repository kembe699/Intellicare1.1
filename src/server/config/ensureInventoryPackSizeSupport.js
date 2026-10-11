/**
 * Fixes the pack-vs-dose-unit bug: a drug stocked as "Strip" (10 tablets)
 * had no way to record that a strip IS 10 tablets, so a prescription for
 * "2 tablets BID x 5 days" (= 20 tablets, correctly computed by
 * calculateQuantity()) got dispensed and deducted from stock as 20 whole
 * strips instead of 2 — the same conflation hits any packaged form (tubes,
 * bottles, vials), not just tablets/strips.
 *
 * units_per_pack: how many individual dosing units (tablets/mL/etc.) are in
 * one unit_of_measure pack. Defaults to 1 — a no-op for every existing item
 * until an admin explicitly sets a real pack size for a given drug (Setup >
 * Item Master), so nothing about current stock levels or dispensing changes
 * until that's done deliberately, per item.
 *
 * dose_unit_label: what to call one dosing unit on the prescription/receipt
 * (e.g. "Tablet") instead of the stocking unit_of_measure ("Strip") — purely
 * cosmetic/clarity, no arithmetic depends on it.
 *
 * quantity_on_hand (here and on stock_by_location/inventory_batches) widens
 * from INTEGER to NUMERIC so a dispense that uses part of a pack (e.g. 15
 * tablets from 10-per-strip packs = 1.5 strips) can be tracked exactly,
 * rather than rounding every dispense and drifting the stock count over
 * time. Existing whole-number values are unaffected — INTEGER -> NUMERIC is
 * a safe widening with no data rewrite.
 */
async function ensureInventoryPackSizeSupport(sequelize) {
  await sequelize.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS units_per_pack INTEGER NOT NULL DEFAULT 1`);
  await sequelize.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS dose_unit_label VARCHAR(30)`);
  await sequelize.query(`ALTER TABLE inventory_items ALTER COLUMN quantity_on_hand TYPE NUMERIC`);
  await sequelize.query(`ALTER TABLE stock_by_location ALTER COLUMN quantity_on_hand TYPE NUMERIC`);
  await sequelize.query(`ALTER TABLE inventory_batches ALTER COLUMN quantity_received TYPE NUMERIC`);
  await sequelize.query(`ALTER TABLE inventory_batches ALTER COLUMN quantity_used TYPE NUMERIC`);
}

module.exports = { ensureInventoryPackSizeSupport };

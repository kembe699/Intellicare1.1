/**
 * The tenant's base currency — the one currency every ledger amount is
 * reported in. Never assume it is SSP: at least one tenant runs a USD base.
 *
 * FALLBACK is used only when a tenant has no base currency configured at all
 * (same default CurrencyService.getBaseCurrency has always returned).
 */
const FALLBACK = 'SSP';

async function getBaseCurrencyCode(transaction) {
  const { sequelize } = require('../models');
  const [[row]] = await sequelize.query(
    'SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1',
    transaction ? { transaction } : {}
  );
  return row?.code || FALLBACK;
}

/** For SQL: COALESCE(some_currency_col, ${BASE_CURRENCY_SQL}) */
const BASE_CURRENCY_SQL = `COALESCE((SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1), '${FALLBACK}')`;

module.exports = { getBaseCurrencyCode, BASE_CURRENCY_SQL, FALLBACK_BASE_CURRENCY: FALLBACK };

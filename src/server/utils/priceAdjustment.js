// Shared logic for bulk price-adjustment endpoints (inventory items, services).
// Supports two modes:
//   - percentage: raise/lower price by a % (existing behavior)
//   - rate: reprice against a new currency exchange rate, holding the
//     USD-equivalent value constant. E.g. if the system's current active
//     USD→SSP rate is 6000 and the user enters 6500 as the new rate, every
//     price effectively priced at the old rate gets scaled by 6500/6000.
async function getAdjustmentMultiplier({ sequelize, mode, percentage, direction, new_rate, from_currency = 'USD', to_currency = 'SSP' }) {
  if (mode === 'rate') {
    const rate = parseFloat(new_rate);
    if (isNaN(rate) || rate <= 0) {
      const err = new Error('Enter a valid exchange rate greater than 0');
      err.isValidation = true;
      throw err;
    }

    const [[current]] = await sequelize.query(
      `SELECT COALESCE(spot_rate, rate) AS effective_rate FROM exchange_rates
       WHERE from_currency = :from_currency AND to_currency = :to_currency AND is_active = true
       ORDER BY effective_date DESC LIMIT 1`,
      { replacements: { from_currency, to_currency } }
    );
    if (!current) {
      const err = new Error(`No active exchange rate configured for ${from_currency} → ${to_currency}. Set one in Exchange Rates first.`);
      err.isValidation = true;
      throw err;
    }

    const currentRate = parseFloat(current.effective_rate);
    return { multiplier: rate / currentRate, currentRate, newRate: rate };
  }

  const pct = parseFloat(percentage);
  if (isNaN(pct) || pct <= 0) {
    const err = new Error('Enter a valid percentage greater than 0');
    err.isValidation = true;
    throw err;
  }
  if (!['increase', 'decrease'].includes(direction)) {
    const err = new Error('direction must be "increase" or "decrease"');
    err.isValidation = true;
    throw err;
  }
  const multiplier = direction === 'increase' ? (1 + pct / 100) : (1 - pct / 100);
  return { multiplier };
}

module.exports = { getAdjustmentMultiplier };

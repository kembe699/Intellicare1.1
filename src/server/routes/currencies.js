const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const CurrencyService = require('../services/CurrencyService');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// Get base currency
router.get('/base', async (req, res) => {
  try {
    const [currency] = await sequelize.query(`
      SELECT code, symbol, name, decimal_places
      FROM currencies
      WHERE is_base_currency = true
      LIMIT 1
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    if (!currency) {
      // Fallback to USD if no base currency is set
      return res.json({
        code: 'USD',
        symbol: '$',
        name: 'US Dollar',
        decimal_places: 2
      });
    }

    res.json(currency);
  } catch (error) {
    console.error('Error fetching base currency:', error);
    res.status(500).json({ error: 'Failed to fetch base currency' });
  }
});

// Get all active currencies
router.get('/', async (req, res) => {
  try {
    const currencies = await sequelize.query(`
      SELECT id, code, symbol, name, decimal_places, is_base_currency, is_active
      FROM currencies
      WHERE is_active = true
      ORDER BY is_base_currency DESC, name ASC
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    res.json(currencies);
  } catch (error) {
    console.error('Error fetching currencies:', error);
    res.status(500).json({ error: 'Failed to fetch currencies' });
  }
});

// Display-only secondary-currency conversion for billing/pharmacy screens —
// "if the patient wants to pay in the secondary currency, what would that
// be" — never affects what actually posts (billing/dispensing always post
// in the base currency). Picks the first active, non-base currency as "the"
// secondary one; a tenant with more than two currencies configured still
// only gets one secondary shown, since that's what was asked for. No
// privilege gate beyond normal auth (matches /base and / above) — this is a
// read-only display convenience any billing/pharmacy staff needs, not a
// financial-configuration view.
router.get('/secondary-rate', async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const base = await CurrencyService.getBaseCurrency();
    const [secondary] = await sequelize.query(`
      SELECT code, symbol, name, decimal_places
      FROM currencies
      WHERE is_active = true AND code != :baseCode
      ORDER BY code ASC
      LIMIT 1
    `, {
      replacements: { baseCode: base.code },
      type: sequelize.QueryTypes.SELECT,
    });

    if (!secondary) return res.json({ base, secondary: null, rate: null });

    const rate = await CurrencyService.getExchangeRate(clinicId, base.code, secondary.code);
    res.json({ base, secondary, rate });
  } catch (error) {
    console.error('Error fetching secondary currency rate:', error);
    res.status(500).json({ error: 'Failed to fetch secondary currency rate' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');

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

module.exports = router;

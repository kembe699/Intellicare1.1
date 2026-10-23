const express = require('express');
const { getBaseCurrencyCode } = require('../utils/baseCurrency');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /accounting/exchange-rates, so the API enforces what the client already assumes.
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const currencyService = require('../services/CurrencyService');

// Helper to get clinic id
function getClinicId(req) {
  return req.user?.clinicId || req.headers['x-clinic-id'] || 1;
}

// ══════════════════════════════════════════════════════════════
// GET /currencies — List all currencies
// ══════════════════════════════════════════════════════════════
router.get('/currencies', async (req, res) => {
  try {
    const currencies = await currencyService.getCurrencies();
    const baseCurrency = await currencyService.getBaseCurrency();
    res.json({ data: currencies, baseCurrency });
  } catch (err) {
    console.error('Get currencies error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /currencies — Add a new currency
// ══════════════════════════════════════════════════════════════
router.post('/currencies', authorize('fx.write'), async (req, res) => {
  try {
    const { code, name, symbol, decimal_places, is_base_currency } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name required' });

    // If setting as base, unset existing base
    if (is_base_currency) {
      await sequelize.query(`UPDATE currencies SET is_base_currency = FALSE WHERE is_base_currency = TRUE`);
    }

    await sequelize.query(`
      INSERT INTO currencies (code, name, symbol, decimal_places, is_base_currency, is_active)
      VALUES (?, ?, ?, ?, ?, TRUE)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name, symbol = EXCLUDED.symbol,
        decimal_places = EXCLUDED.decimal_places,
        is_base_currency = EXCLUDED.is_base_currency, is_active = TRUE
    `, { replacements: [code.toUpperCase(), name, symbol || '', decimal_places || 2, is_base_currency || false] });

    res.json({ success: true, message: `Currency ${code} saved` });
  } catch (err) {
    console.error('Add currency error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /currencies/:code — Update currency
// ══════════════════════════════════════════════════════════════
router.put('/currencies/:code', authorize('fx.write'), async (req, res) => {
  try {
    const { name, symbol, decimal_places, is_active, is_base_currency } = req.body;
    const fields = [], reps = [];

    if (name !== undefined) { fields.push('name = ?'); reps.push(name); }
    if (symbol !== undefined) { fields.push('symbol = ?'); reps.push(symbol); }
    if (decimal_places !== undefined) { fields.push('decimal_places = ?'); reps.push(decimal_places); }
    if (is_active !== undefined) { fields.push('is_active = ?'); reps.push(is_active); }
    if (is_base_currency) {
      await sequelize.query(`UPDATE currencies SET is_base_currency = FALSE WHERE is_base_currency = TRUE`);
      fields.push('is_base_currency = TRUE');
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    reps.push(req.params.code.toUpperCase());
    await sequelize.query(`UPDATE currencies SET ${fields.join(', ')} WHERE code = ?`, { replacements: reps });

    res.json({ success: true });
  } catch (err) {
    console.error('Update currency error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// DELETE /currencies/:code — Deactivate currency
// ══════════════════════════════════════════════════════════════
router.delete('/currencies/:code', authorize('fx.write'), async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const [base] = await sequelize.query(`SELECT is_base_currency FROM currencies WHERE code = ?`, { replacements: [code] });
    if (base[0]?.is_base_currency) return res.status(400).json({ error: 'Cannot deactivate base currency' });

    await sequelize.query(`UPDATE currencies SET is_active = FALSE WHERE code = ?`, { replacements: [code] });
    res.json({ success: true });
  } catch (err) {
    console.error('Deactivate currency error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /rates — List exchange rates
// ══════════════════════════════════════════════════════════════
router.get('/rates', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { from_currency, to_currency, active_only } = req.query;

    let where = 'WHERE er.clinic_id = ?';
    const reps = [clinicId];

    if (from_currency) { where += ' AND er.from_currency = ?'; reps.push(from_currency); }
    if (to_currency) { where += ' AND er.to_currency = ?'; reps.push(to_currency); }
    if (active_only !== 'false') { where += ' AND er.is_active = TRUE'; }

    const [rates] = await sequelize.query(`
      SELECT er.*,
        COALESCE(er.spot_rate, er.rate) as effective_rate
      FROM exchange_rates er
      ${where}
      ORDER BY er.effective_date DESC
      LIMIT 100
    `, { replacements: reps });

    res.json({ data: rates });
  } catch (err) {
    console.error('Get rates error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /rates — Add / update exchange rate
// ══════════════════════════════════════════════════════════════
router.post('/rates', authorize('fx.write'), async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { from_currency, to_currency, rate, buy_rate, sell_rate, spot_rate, effective_date, source, notes } = req.body;

    if (!from_currency || !to_currency || !rate) {
      return res.status(400).json({ error: 'from_currency, to_currency, and rate required' });
    }

    const id = await currencyService.saveExchangeRate({
      clinicId,
      fromCurrency: from_currency.toUpperCase(),
      toCurrency: to_currency.toUpperCase(),
      rate: parseFloat(rate),
      buyRate: buy_rate ? parseFloat(buy_rate) : undefined,
      sellRate: sell_rate ? parseFloat(sell_rate) : undefined,
      spotRate: spot_rate ? parseFloat(spot_rate) : undefined,
      effectiveDate: effective_date || new Date().toISOString().split('T')[0],
      source: source || 'manual',
      notes,
      createdBy: req.user?.userId,
    });

    res.json({ success: true, id, message: 'Exchange rate saved' });
  } catch (err) {
    console.error('Save rate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// DELETE /rates/:id — Deactivate exchange rate
// ══════════════════════════════════════════════════════════════
router.delete('/rates/:id', authorize('fx.write'), async (req, res) => {
  try {
    await sequelize.query(`UPDATE exchange_rates SET is_active = FALSE WHERE id = ?`, { replacements: [req.params.id] });
    res.json({ success: true });
  } catch (err) {
    console.error('Deactivate rate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /rates/history — Rate history for a pair
// ══════════════════════════════════════════════════════════════
router.get('/rates/history', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { from_currency, to_currency, days } = req.query;
    const lookback = parseInt(days) || 30;

    const [history] = await sequelize.query(`
      SELECT from_currency, to_currency, rate, buy_rate, sell_rate, spot_rate, effective_date, source
      FROM exchange_rates
      WHERE clinic_id = ?
        AND from_currency = ? AND to_currency = ?
        AND effective_date >= ((CURRENT_DATE) - ((?)::text || ' day')::interval)
      ORDER BY effective_date ASC
    `, { replacements: [clinicId, from_currency || 'USD', to_currency || (await getBaseCurrencyCode()), lookback] });

    res.json({ data: history });
  } catch (err) {
    console.error('Rate history error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /convert — Convert an amount
// ══════════════════════════════════════════════════════════════
router.post('/convert', authorize('fx.write'), async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { amount, from_currency, to_currency, date } = req.body;

    if (!amount || !from_currency || !to_currency) {
      return res.status(400).json({ error: 'amount, from_currency, to_currency required' });
    }

    const result = await currencyService.convertAmount(clinicId, parseFloat(amount), from_currency, to_currency, date);

    // Log conversion
    await currencyService.logConversion({
      clinicId,
      fromCurrency: from_currency,
      toCurrency: to_currency,
      amountSource: parseFloat(amount),
      rateUsed: result.rate,
      amountConverted: result.convertedAmount,
      method: 'manual',
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Convert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /dashboard — Multi-currency dashboard data
// ══════════════════════════════════════════════════════════════
router.get('/dashboard', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const data = await currencyService.getDashboardData(clinicId);
    res.json({ data });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /conversions — Conversion audit log
// ══════════════════════════════════════════════════════════════
router.get('/conversions', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { limit: lim } = req.query;

    const [conversions] = await sequelize.query(`
      SELECT * FROM currency_conversion_log
      WHERE clinic_id = ?
      ORDER BY conversion_date DESC
      LIMIT ?
    `, { replacements: [clinicId, parseInt(lim) || 50] });

    res.json({ data: conversions });
  } catch (err) {
    console.error('Conversions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /adjustments — Exchange gain/loss adjustments
// ══════════════════════════════════════════════════════════════
router.get('/adjustments', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { status, type } = req.query;

    let where = 'WHERE clinic_id = ?';
    const reps = [clinicId];
    if (status) { where += ' AND adjustment_status = ?'; reps.push(status); }
    if (type) { where += ' AND adjustment_type = ?'; reps.push(type); }

    const [adjustments] = await sequelize.query(`
      SELECT * FROM exchange_adjustments
      ${where}
      ORDER BY created_at DESC
      LIMIT 100
    `, { replacements: reps });

    // Summary
    const [summary] = await sequelize.query(`
      SELECT
        SUM(CASE WHEN adjustment_status = 'realized' THEN realized_gain_loss ELSE 0 END) as total_realized,
        SUM(CASE WHEN adjustment_status = 'pending' THEN unrealized_gain_loss ELSE 0 END) as total_unrealized,
        COUNT(*) as total_count
      FROM exchange_adjustments
      WHERE clinic_id = ?
    `, { replacements: [clinicId] });

    res.json({ data: adjustments, summary: summary[0] || {} });
  } catch (err) {
    console.error('Adjustments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /revalue — Revalue foreign currency balances
// ══════════════════════════════════════════════════════════════
router.post('/revalue', authorize('fx.write'), async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { date } = req.body;
    const results = await currencyService.revalueBalances(clinicId, date || new Date().toISOString().split('T')[0]);
    res.json({ success: true, data: results, message: `Revalued ${results.length} balances` });
  } catch (err) {
    console.error('Revalue error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /report-settings — Get multi-currency report settings
// ══════════════════════════════════════════════════════════════
router.get('/report-settings', async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const [settings] = await sequelize.query(`SELECT * FROM multicurrency_report_settings WHERE clinic_id = ?`, { replacements: [clinicId] });
    res.json({ data: settings[0] || null });
  } catch (err) {
    console.error('Report settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /report-settings — Update report settings
// ══════════════════════════════════════════════════════════════
router.put('/report-settings', authorize('fx.write'), async (req, res) => {
  try {
    const clinicId = getClinicId(req);
    const { base_currency_code, secondary_currencies, show_individual_currencies, show_base_currency_conversion, show_exchange_gains_losses } = req.body;

    await sequelize.query(`
      INSERT INTO multicurrency_report_settings (clinic_id, base_currency_code, secondary_currencies, show_individual_currencies, show_base_currency_conversion, show_exchange_gains_losses)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (clinic_id) DO UPDATE SET
        base_currency_code = EXCLUDED.base_currency_code,
        secondary_currencies = EXCLUDED.secondary_currencies,
        show_individual_currencies = EXCLUDED.show_individual_currencies,
        show_base_currency_conversion = EXCLUDED.show_base_currency_conversion,
        show_exchange_gains_losses = EXCLUDED.show_exchange_gains_losses
    `, { replacements: [clinicId, base_currency_code || 'SSP', JSON.stringify(secondary_currencies || ['USD']), show_individual_currencies !== false, show_base_currency_conversion !== false, show_exchange_gains_losses !== false] });

    res.json({ success: true });
  } catch (err) {
    console.error('Update report settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

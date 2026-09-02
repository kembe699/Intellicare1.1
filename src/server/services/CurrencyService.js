const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

class CurrencyService {

  // ── Get all active currencies ──────────────────────────────
  async getCurrencies() {
    const [rows] = await sequelize.query(`SELECT * FROM currencies WHERE is_active = TRUE ORDER BY is_base_currency DESC, code`);
    return rows;
  }

  // ── Get base currency ──────────────────────────────────────
  async getBaseCurrency() {
    const [rows] = await sequelize.query(`SELECT * FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
    return rows[0] || { code: 'SSP', name: 'South Sudanese Pound', symbol: '£', decimal_places: 2 };
  }

  // ── Get exchange rate for a date ───────────────────────────
  async getExchangeRate(clinicId, fromCurrency, toCurrency, date) {
    const queryDate = date || new Date().toISOString().split('T')[0];

    // Same currency → rate is 1
    if (fromCurrency === toCurrency) return 1;

    // Try direct rate
    const [direct] = await sequelize.query(`
      SELECT rate, spot_rate, buy_rate, sell_rate
      FROM exchange_rates
      WHERE clinic_id = ?
        AND from_currency = ? AND to_currency = ?
        AND effective_date <= ?
        AND is_active = TRUE
      ORDER BY effective_date DESC
      LIMIT 1
    `, { replacements: [clinicId, fromCurrency, toCurrency, queryDate] });

    if (direct.length) return parseFloat(direct[0].spot_rate || direct[0].rate);

    // Try inverse rate
    const [inverse] = await sequelize.query(`
      SELECT rate, spot_rate
      FROM exchange_rates
      WHERE clinic_id = ?
        AND from_currency = ? AND to_currency = ?
        AND effective_date <= ?
        AND is_active = TRUE
      ORDER BY effective_date DESC
      LIMIT 1
    `, { replacements: [clinicId, toCurrency, fromCurrency, queryDate] });

    if (inverse.length) {
      const r = parseFloat(inverse[0].spot_rate || inverse[0].rate);
      return r > 0 ? 1 / r : 0;
    }

    return null; // no rate found
  }

  // ── Convert amount ─────────────────────────────────────────
  async convertAmount(clinicId, amount, fromCurrency, toCurrency, date) {
    const rate = await this.getExchangeRate(clinicId, fromCurrency, toCurrency, date);
    if (rate === null) {
      throw new Error(`No exchange rate found for ${fromCurrency}→${toCurrency}`);
    }
    return {
      convertedAmount: parseFloat((amount * rate).toFixed(2)),
      rate,
      date: date || new Date().toISOString().split('T')[0],
    };
  }

  // ── Save / update exchange rate ────────────────────────────
  async saveExchangeRate({ clinicId, fromCurrency, toCurrency, rate, buyRate, sellRate, spotRate, effectiveDate, source, createdBy, notes }) {
    const [existing] = await sequelize.query(`
      SELECT id FROM exchange_rates
      WHERE clinic_id = ? AND from_currency = ? AND to_currency = ? AND effective_date = ?
    `, { replacements: [clinicId, fromCurrency, toCurrency, effectiveDate] });

    if (existing.length) {
      try {
        await sequelize.query(`
          UPDATE exchange_rates
          SET rate = ?, buy_rate = ?, sell_rate = ?, spot_rate = ?, source = ?, notes = ?, is_active = TRUE, updated_at = NOW()
          WHERE id = ?
        `, { replacements: [rate, buyRate || rate, sellRate || rate, spotRate || rate, source || 'manual', notes || null, existing[0].id] });
      } catch (e) {
        // Fallback: update without optional columns
        console.warn('Update with extended columns failed, using base columns:', e.message);
        await sequelize.query(`
          UPDATE exchange_rates SET rate = ?, source = ?, is_active = TRUE, updated_at = NOW() WHERE id = ?
        `, { replacements: [rate, source || 'manual', existing[0].id] });
      }
      return existing[0].id;
    }

    const id = uuidv4();
    try {
      await sequelize.query(`
        INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, buy_rate, sell_rate, spot_rate, effective_date, source, notes, is_active, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,TRUE,?,NOW(),NOW())
      `, { replacements: [id, clinicId, fromCurrency, toCurrency, rate, buyRate || rate, sellRate || rate, spotRate || rate, effectiveDate, source || 'manual', notes || null, createdBy || null] });
    } catch (e) {
      // Fallback: insert without optional columns (buy_rate, sell_rate, spot_rate, notes)
      console.warn('Insert with extended columns failed, using base columns:', e.message);
      await sequelize.query(`
        INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, source, is_active, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,TRUE,?,NOW(),NOW())
      `, { replacements: [id, clinicId, fromCurrency, toCurrency, rate, effectiveDate, source || 'manual', createdBy || null] });
    }
    return id;
  }

  // ── Record realized exchange gain/loss ─────────────────────
  async recordExchangeAdjustment({ clinicId, fromCurrency, toCurrency, originalAmount, originalRate, settlementAmount, settlementRate, referenceType, referenceId, notes, createdBy }) {
    const originalBase = parseFloat((originalAmount * originalRate).toFixed(2));
    const settlementBase = parseFloat(((settlementAmount || originalAmount) * settlementRate).toFixed(2));
    const realizedGainLoss = parseFloat((settlementBase - originalBase).toFixed(2));

    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO exchange_adjustments
        (id, clinic_id, transaction_date, from_currency, to_currency,
         original_amount, original_rate, original_base_amount,
         settlement_date, settlement_rate, settlement_base_amount,
         realized_gain_loss, adjustment_type, adjustment_status,
         reference_type, reference_id, notes, created_by)
      VALUES (?,?,CURRENT_DATE,?,?, ?,?,?, CURRENT_DATE,?,?, ?,'receivable','realized', ?,?,?,?)
    `, { replacements: [id, clinicId, fromCurrency, toCurrency, originalAmount, originalRate, originalBase, settlementRate, settlementBase, realizedGainLoss, referenceType, referenceId, notes || null, createdBy || null] });

    return { id, realizedGainLoss };
  }

  // ── Log a conversion (audit) ───────────────────────────────
  async logConversion({ clinicId, sourceId, sourceType, fromCurrency, toCurrency, amountSource, rateUsed, amountConverted, method }) {
    const id = uuidv4();
    await sequelize.query(`
      INSERT INTO currency_conversion_log
        (id, clinic_id, source_transaction_id, source_transaction_type,
         from_currency, to_currency, amount_source, rate_used, amount_converted,
         conversion_method, approval_status)
      VALUES (?,?,?,?, ?,?,?,?,?, ?, 'approved')
    `, { replacements: [id, clinicId, sourceId || null, sourceType || null, fromCurrency, toCurrency, amountSource, rateUsed, amountConverted, method || 'automatic'] });
    return id;
  }

  // ── Update account currency balance ────────────────────────
  async updateAccountCurrencyBalance(clinicId, accountId, currencyCode, amount, direction) {
    const signedAmount = direction === 'debit' ? amount : -amount;
    const [existing] = await sequelize.query(`
      SELECT id, balance_in_currency FROM account_currency_balances
      WHERE clinic_id = ? AND account_id = ? AND currency_code = ?
    `, { replacements: [clinicId, accountId, currencyCode] });

    if (existing.length) {
      await sequelize.query(`
        UPDATE account_currency_balances
        SET balance_in_currency = balance_in_currency + ?, last_updated = NOW()
        WHERE id = ?
      `, { replacements: [signedAmount, existing[0].id] });
    } else {
      await sequelize.query(`
        INSERT INTO account_currency_balances (id, clinic_id, account_id, currency_code, balance_in_currency)
        VALUES (?,?,?,?,?)
      `, { replacements: [uuidv4(), clinicId, accountId, currencyCode, signedAmount] });
    }
  }

  // ── Revalue foreign currency balances ──────────────────────
  async revalueBalances(clinicId, revaluationDate) {
    const baseCurrency = await this.getBaseCurrency();

    const [balances] = await sequelize.query(`
      SELECT acb.* FROM account_currency_balances acb
      WHERE acb.clinic_id = ? AND acb.currency_code != ?
    `, { replacements: [clinicId, baseCurrency.code] });

    const results = [];
    for (const bal of balances) {
      const rate = await this.getExchangeRate(clinicId, bal.currency_code, baseCurrency.code, revaluationDate);
      if (rate === null) continue;

      const baseAmount = parseFloat((bal.balance_in_currency * rate).toFixed(2));
      const oldBase = parseFloat(bal.balance_in_base_currency || 0);
      const unrealized = parseFloat((baseAmount - oldBase).toFixed(2));

      await sequelize.query(`
        UPDATE account_currency_balances
        SET balance_in_base_currency = ?, last_conversion_rate = ?, last_conversion_date = NOW(), unrealized_gain_loss = ?
        WHERE id = ?
      `, { replacements: [baseAmount, rate, unrealized, bal.id] });

      results.push({ account_id: bal.account_id, currency: bal.currency_code, baseAmount, unrealized });
    }
    return results;
  }

  // ── Dashboard summary ──────────────────────────────────────
  async getDashboardData(clinicId) {
    const baseCurrency = await this.getBaseCurrency();
    const currencies = await this.getCurrencies();

    // Latest rates
    const [rates] = await sequelize.query(`
      SELECT er.*, 
        COALESCE(er.spot_rate, er.rate) as effective_rate
      FROM exchange_rates er
      WHERE er.clinic_id = ? AND er.is_active = TRUE
      ORDER BY er.effective_date DESC
      LIMIT 20
    `, { replacements: [clinicId] });

    // Deduplicate to latest per pair
    const latestRates = {};
    for (const r of rates) {
      const key = `${r.from_currency}-${r.to_currency}`;
      if (!latestRates[key]) latestRates[key] = r;
    }

    // Account balances by currency
    const [accountBalances] = await sequelize.query(`
      SELECT 
        coa.account_name, coa.account_type, coa.account_code,
        acb.currency_code, acb.balance_in_currency, acb.balance_in_base_currency,
        acb.unrealized_gain_loss
      FROM account_currency_balances acb
      JOIN chart_of_accounts coa ON acb.account_id = coa.id
      WHERE acb.clinic_id = ?
      ORDER BY coa.account_type, coa.account_name, acb.currency_code
    `, { replacements: [clinicId] });

    // Realized gains/losses summary
    const [gainLoss] = await sequelize.query(`
      SELECT 
        from_currency,
        SUM(realized_gain_loss) as total_realized,
        SUM(unrealized_gain_loss) as total_unrealized,
        COUNT(*) as adjustment_count
      FROM exchange_adjustments
      WHERE clinic_id = ?
      GROUP BY from_currency
    `, { replacements: [clinicId] });

    // Recent conversions
    const [conversions] = await sequelize.query(`
      SELECT * FROM currency_conversion_log
      WHERE clinic_id = ?
      ORDER BY conversion_date DESC
      LIMIT 20
    `, { replacements: [clinicId] });

    // Rate history (last 30 days)
    const [rateHistory] = await sequelize.query(`
      SELECT from_currency, to_currency, rate, spot_rate, effective_date
      FROM exchange_rates
      WHERE clinic_id = ? AND effective_date >= CURRENT_DATE - INTERVAL '30 day'
      ORDER BY effective_date ASC
    `, { replacements: [clinicId] });

    return {
      baseCurrency,
      currencies,
      exchangeRates: Object.values(latestRates),
      accountBalances,
      gainLoss,
      conversions,
      rateHistory,
    };
  }
}

module.exports = new CurrencyService();

const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const AccountingService = require('./AccountingService');
const CurrencyService = require('./CurrencyService');

/**
 * Fixed asset register, depreciation and disposal/revaluation — the GL side
 * of every write here follows the same real-ACID pattern as patient billing
 * (see AccountingService.createGLFromPatientBill): the asset row and its
 * ledger entry share one transaction, so either both commit or neither does.
 */
class AssetService {
  /** FA-<year>-<sequence>, sequence per clinic per year. */
  async generateAssetCode(clinicId, transaction) {
    const year = new Date().getFullYear();
    const prefix = `FA-${year}-`;
    const [[row]] = await sequelize.query(
      `SELECT asset_code FROM fixed_assets WHERE clinic_id = :clinicId AND asset_code LIKE :prefix ORDER BY asset_code DESC LIMIT 1`,
      { replacements: { clinicId, prefix: `${prefix}%` }, transaction }
    );
    const lastSeq = row ? parseInt(row.asset_code.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
  }

  async getCategory(clinicId, categoryId) {
    const [[category]] = await sequelize.query(
      `SELECT * FROM asset_categories WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: categoryId, clinicId } }
    );
    return category || null;
  }

  /**
   * Registers a new asset. When paymentAccountCode is given, also posts
   * Dr [asset account] / Cr [payment account] (e.g. Cash, Bank, Accounts
   * Payable) in the SAME transaction as the asset row — the acquisition and
   * its ledger entry either both exist or neither does. Omit it to register
   * an asset without touching the ledger (e.g. entering assets the facility
   * already owned before this module existed — nothing to post twice for).
   */
  async createAsset(data, userId) {
    const {
      clinic_id: clinicId, branch_id: branchId, name, category_id: categoryId, description,
      serial_number: serialNumber, location, assigned_to_employee_id: assignedToEmployeeId,
      acquisition_date: acquisitionDate, acquisition_cost: acquisitionCostRaw,
      acquisition_currency: acquisitionCurrencyRaw,
      salvage_value: salvageValueRaw, useful_life_years: usefulLifeYearsRaw,
      payment_account_code: paymentAccountCode, notes,
    } = data;

    if (!clinicId) throw new Error('clinic_id is required');
    if (!name || !name.trim()) throw new Error('name is required');
    if (!categoryId) throw new Error('category_id is required');
    if (!acquisitionDate) throw new Error('acquisition_date is required');
    const acquisitionCostOriginal = parseFloat(acquisitionCostRaw);
    if (!(acquisitionCostOriginal > 0)) throw new Error('acquisition_cost must be a positive number');

    const category = await this.getCategory(clinicId, categoryId);
    if (!category) throw new Error('Asset category not found');

    // acquisition_cost is always stored/used in the clinic's base currency (matching
    // chart_of_accounts/general_ledger and every downstream depreciation/disposal
    // calculation) — acquisition_currency/acquisition_cost_original just record what
    // was actually entered, the same way patient bills keep bill_currency alongside a
    // base-currency total.
    const baseCurrencyData = await CurrencyService.getBaseCurrency();
    const baseCurrency = baseCurrencyData.code;
    const acquisitionCurrency = acquisitionCurrencyRaw || baseCurrency;
    const exchangeRate = acquisitionCurrency === baseCurrency
      ? 1
      : await AccountingService.getExchangeRate(clinicId, acquisitionCurrency, baseCurrency, acquisitionDate);
    const acquisitionCost = AccountingService.convertAmount(acquisitionCostOriginal, exchangeRate);

    const nature = category.nature;
    const usefulLifeYears = usefulLifeYearsRaw != null ? parseInt(usefulLifeYearsRaw, 10) : category.default_useful_life_years;
    if (nature === 'depreciating' && !(usefulLifeYears > 0)) {
      throw new Error('useful_life_years must be a positive number for a depreciating asset');
    }
    const salvageValue = salvageValueRaw != null
      ? parseFloat(salvageValueRaw)
      : Number((acquisitionCost * (parseFloat(category.default_salvage_percent) || 0) / 100).toFixed(2));
    if (salvageValue < 0 || salvageValue > acquisitionCost) {
      throw new Error('salvage_value must be between 0 and the acquisition cost');
    }

    const transaction = await sequelize.transaction();
    try {
      const assetId = uuidv4();
      const assetCode = await this.generateAssetCode(clinicId, transaction);

      let glEntryId = null;
      if (paymentAccountCode) {
        const assetAccount = category.asset_account_id
          ? { id: category.asset_account_id }
          : null;
        if (!assetAccount) throw new Error(`Asset category "${category.name}" has no asset GL account configured`);
        const paymentAccount = (await sequelize.query(
          `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code AND is_active = true`,
          { replacements: { clinicId, code: paymentAccountCode }, transaction }
        ))[0][0];
        if (!paymentAccount) throw new Error(`Payment account ${paymentAccountCode} not found or inactive`);

        const glEntry = await AccountingService.createGLEntry(
          {
            clinic_id: clinicId,
            transaction_date: acquisitionDate,
            transaction_type: 'fixed_asset_acquisition',
            description: `Asset acquired - ${assetCode} - ${name}`,
            reference_id: assetId,
            reference_module: 'fixed_asset_acquisition',
            transaction_currency: acquisitionCurrency,
            exchange_rate: exchangeRate,
          },
          [
            { account_id: assetAccount.id, debit_amount: acquisitionCostOriginal, credit_amount: 0, description: `Asset - ${name}` },
            { account_id: paymentAccount.id, debit_amount: 0, credit_amount: acquisitionCostOriginal, description: `Payment for asset - ${name}` },
          ],
          userId,
          transaction
        );
        glEntryId = glEntry.id;
      }

      await sequelize.query(
        `INSERT INTO fixed_assets (
           id, clinic_id, branch_id, asset_code, name, category_id, description, serial_number, location,
           assigned_to_employee_id, nature, acquisition_date, acquisition_cost, acquisition_currency,
           acquisition_cost_original, acquisition_exchange_rate, salvage_value, useful_life_years,
           depreciation_method, accumulated_depreciation, current_value, status, acquisition_gl_entry_id, notes, created_by
         ) VALUES (
           :id, :clinicId, :branchId, :assetCode, :name, :categoryId, :description, :serialNumber, :location,
           :assignedTo, :nature, :acquisitionDate, :acquisitionCost, :acquisitionCurrency,
           :acquisitionCostOriginal, :exchangeRate, :salvageValue, :usefulLifeYears,
           :method, 0, :currentValue, 'active', :glEntryId, :notes, :createdBy
         )`,
        {
          replacements: {
            id: assetId, clinicId, branchId: branchId || null, assetCode, name: name.trim(), categoryId,
            description: description || null, serialNumber: serialNumber || null, location: location || null,
            assignedTo: assignedToEmployeeId || null, nature, acquisitionDate, acquisitionCost, acquisitionCurrency,
            acquisitionCostOriginal, exchangeRate, salvageValue,
            usefulLifeYears: usefulLifeYears || null, method: nature === 'depreciating' ? (category.default_depreciation_method || 'straight_line') : 'none',
            currentValue: acquisitionCost, glEntryId, notes: notes || null, createdBy: userId || null,
          },
          transaction,
        }
      );

      await transaction.commit();
      return this.getAsset(clinicId, assetId);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  // created_by is stored as text (it also holds non-numeric values in tests/seed
  // scripts), so the join guards with a regex before casting to users.id (integer)
  // instead of letting a non-numeric value blow up the query.
  async getAsset(clinicId, assetId) {
    const [[asset]] = await sequelize.query(
      `SELECT fa.*, ac.name AS category_name, ac.nature AS category_nature, u.display_name AS registered_by_name
       FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id
       LEFT JOIN users u ON fa.created_by ~ '^[0-9]+$' AND u.id = fa.created_by::integer
       WHERE fa.id = :id AND fa.clinic_id = :clinicId`,
      { replacements: { id: assetId, clinicId } }
    );
    return asset || null;
  }

  /**
   * Runs straight-line depreciation for every active, depreciating asset for
   * one period (YYYY-MM), scoped to a branch when given. One consolidated GL
   * entry per run: one debit line per depreciation-expense account (summed
   * across every category that shares it), one credit line per accumulated-
   * depreciation account — not one GL entry per asset, which would flood the
   * ledger. Per-asset detail lives in asset_depreciation_entries, all linked
   * to that one entry. Skips (does not error on) an asset already
   * depreciated for this period — safe to re-run.
   */
  async runDepreciation(clinicId, period, userId, branchId = null) {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('period must be in YYYY-MM format');

    const [assets] = await sequelize.query(
      `SELECT fa.*, ac.depreciation_expense_account_id, ac.accumulated_depreciation_account_id
       FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.clinic_id = :clinicId AND fa.status = 'active' AND fa.nature = 'depreciating'
         ${branchId ? 'AND fa.branch_id = :branchId' : ''}
         AND fa.acquisition_date <= (:period || '-28')::date
         AND NOT EXISTS (SELECT 1 FROM asset_depreciation_entries d WHERE d.asset_id = fa.id AND d.period = :period)`,
      { replacements: { clinicId, branchId, period } }
    );

    const eligible = assets.filter((a) => {
      const depreciable = parseFloat(a.acquisition_cost) - parseFloat(a.salvage_value);
      const already = parseFloat(a.accumulated_depreciation);
      return depreciable - already > 0.01 && a.useful_life_years > 0 && a.depreciation_expense_account_id && a.accumulated_depreciation_account_id;
    });

    if (eligible.length === 0) {
      return { period, assetsDepreciated: 0, totalDepreciation: 0, glEntryId: null };
    }

    const transaction = await sequelize.transaction();
    try {
      const perAsset = [];
      const expenseTotals = {}; // account_id -> amount
      const accumTotals = {}; // account_id -> amount

      for (const asset of eligible) {
        const cost = parseFloat(asset.acquisition_cost);
        const salvage = parseFloat(asset.salvage_value);
        const alreadyAccumulated = parseFloat(asset.accumulated_depreciation);
        const depreciableBase = cost - salvage;
        const monthly = Number((depreciableBase / asset.useful_life_years / 12).toFixed(2));
        // Never depreciate past the salvage value, even if this run's normal
        // monthly amount would overshoot it (the asset's final month, or one
        // whose useful_life_years was shortened after some months already ran).
        const amount = Math.min(monthly, Number((depreciableBase - alreadyAccumulated).toFixed(2)));
        if (amount <= 0) continue;

        const newAccumulated = Number((alreadyAccumulated + amount).toFixed(2));
        const newBookValue = Number((cost - newAccumulated).toFixed(2));

        perAsset.push({ asset, amount, newAccumulated, newBookValue });
        expenseTotals[asset.depreciation_expense_account_id] = Number(((expenseTotals[asset.depreciation_expense_account_id] || 0) + amount).toFixed(2));
        accumTotals[asset.accumulated_depreciation_account_id] = Number(((accumTotals[asset.accumulated_depreciation_account_id] || 0) + amount).toFixed(2));
      }

      if (perAsset.length === 0) {
        await transaction.rollback();
        return { period, assetsDepreciated: 0, totalDepreciation: 0, glEntryId: null };
      }

      const lineItems = [
        ...Object.entries(expenseTotals).map(([account_id, amount]) => ({
          account_id, debit_amount: amount, credit_amount: 0, description: `Depreciation expense - ${period}`,
        })),
        ...Object.entries(accumTotals).map(([account_id, amount]) => ({
          account_id, debit_amount: 0, credit_amount: amount, description: `Accumulated depreciation - ${period}`,
        })),
      ];
      const totalDepreciation = Object.values(expenseTotals).reduce((s, v) => s + v, 0);

      const { periodStart, periodEnd } = (() => {
        const [y, m] = period.split('-').map(Number);
        const start = `${period}-01`;
        const end = new Date(y, m, 0).toISOString().split('T')[0];
        return { periodStart: start, periodEnd: end };
      })();

      const glEntry = await AccountingService.createGLEntry(
        {
          clinic_id: clinicId,
          transaction_date: periodEnd,
          transaction_type: 'fixed_asset_depreciation',
          description: `Depreciation run - ${period} (${perAsset.length} asset${perAsset.length === 1 ? '' : 's'})`,
          reference_id: null,
          reference_module: 'fixed_asset_depreciation',
        },
        lineItems,
        userId,
        transaction
      );

      for (const { asset, amount, newAccumulated, newBookValue } of perAsset) {
        await sequelize.query(
          `INSERT INTO asset_depreciation_entries (id, asset_id, clinic_id, period, depreciation_amount, accumulated_depreciation_after, book_value_after, gl_entry_id, posted_by)
           VALUES (:id, :assetId, :clinicId, :period, :amount, :accumAfter, :bookAfter, :glEntryId, :userId)`,
          { replacements: { id: uuidv4(), assetId: asset.id, clinicId, period, amount, accumAfter: newAccumulated, bookAfter: newBookValue, glEntryId: glEntry.id, userId: userId || null }, transaction }
        );
        await sequelize.query(
          `UPDATE fixed_assets SET accumulated_depreciation = :accum, current_value = :value, updated_at = NOW() WHERE id = :id`,
          { replacements: { accum: newAccumulated, value: newBookValue, id: asset.id }, transaction }
        );
      }

      await transaction.commit();
      return { period, assetsDepreciated: perAsset.length, totalDepreciation, glEntryId: glEntry.id };
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  /**
   * Disposes of an asset: removes it from the books (Dr accumulated
   * depreciation, Cr asset at original cost) and recognizes any gain/loss
   * against the disposal proceeds — Cr Gain (4900 Other Income) if the
   * proceeds exceed book value, Dr Loss (5910) if they fall short. Cash/bank
   * only moves if proceeds > 0.
   */
  async disposeAsset(clinicId, assetId, { disposal_date: disposalDate, proceeds: proceedsRaw, reason, payment_account_code: paymentAccountCode }, userId) {
    const asset = await this.getAsset(clinicId, assetId);
    if (!asset) throw new Error('Asset not found');
    if (asset.status === 'disposed') throw new Error('This asset has already been disposed of');

    const proceeds = proceedsRaw != null ? parseFloat(proceedsRaw) : 0;
    const cost = parseFloat(asset.acquisition_cost);
    const accumulatedDepreciation = parseFloat(asset.accumulated_depreciation);
    const bookValue = cost - accumulatedDepreciation;
    const gainOrLoss = Number((proceeds - bookValue).toFixed(2));

    const transaction = await sequelize.transaction();
    try {
      const lineItems = [];
      if (proceeds > 0) {
        if (!paymentAccountCode) throw new Error('payment_account_code is required when disposal proceeds are greater than zero');
        const [[paymentAccount]] = await sequelize.query(
          `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code AND is_active = true`,
          { replacements: { clinicId, code: paymentAccountCode }, transaction }
        );
        if (!paymentAccount) throw new Error(`Payment account ${paymentAccountCode} not found or inactive`);
        lineItems.push({ account_id: paymentAccount.id, debit_amount: proceeds, credit_amount: 0, description: `Disposal proceeds - ${asset.asset_code}` });
      }
      if (accumulatedDepreciation > 0) {
        lineItems.push({ account_id: asset.category_id ? (await this._categoryAccount(clinicId, asset.category_id, 'accumulated_depreciation_account_id', transaction)) : null, debit_amount: accumulatedDepreciation, credit_amount: 0, description: `Remove accumulated depreciation - ${asset.asset_code}` });
      }
      const assetAccountId = await this._categoryAccount(clinicId, asset.category_id, 'asset_account_id', transaction);
      lineItems.push({ account_id: assetAccountId, debit_amount: 0, credit_amount: cost, description: `Disposal of asset - ${asset.asset_code}` });

      if (gainOrLoss > 0.01) {
        const [[gainAccount]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '4900'`, { replacements: { clinicId }, transaction });
        if (gainAccount) lineItems.push({ account_id: gainAccount.id, debit_amount: 0, credit_amount: gainOrLoss, description: `Gain on disposal - ${asset.asset_code}` });
      } else if (gainOrLoss < -0.01) {
        const [[lossAccount]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '5910'`, { replacements: { clinicId }, transaction });
        if (lossAccount) lineItems.push({ account_id: lossAccount.id, debit_amount: Math.abs(gainOrLoss), credit_amount: 0, description: `Loss on disposal - ${asset.asset_code}` });
      }

      const glEntry = await AccountingService.createGLEntry(
        {
          clinic_id: clinicId,
          transaction_date: disposalDate || new Date(),
          transaction_type: 'fixed_asset_disposal',
          description: `Disposal - ${asset.asset_code} - ${asset.name}`,
          reference_id: assetId,
          reference_module: 'fixed_asset_disposal',
        },
        lineItems.filter((l) => l.account_id),
        userId,
        transaction
      );

      await sequelize.query(
        `UPDATE fixed_assets SET status = 'disposed', disposal_date = :disposalDate, disposal_proceeds = :proceeds,
           disposal_reason = :reason, current_value = 0, updated_at = NOW()
         WHERE id = :id`,
        { replacements: { disposalDate: disposalDate || new Date().toISOString().split('T')[0], proceeds, reason: reason || null, id: assetId }, transaction }
      );

      await transaction.commit();
      return { assetId, bookValue, gainOrLoss, glEntryId: glEntry.id };
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  async _categoryAccount(clinicId, categoryId, field, transaction) {
    const [[row]] = await sequelize.query(
      `SELECT ${field} AS account_id FROM asset_categories WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: categoryId, clinicId }, transaction }
    );
    return row?.account_id || null;
  }

  /**
   * Adjusts the carrying value of an appreciating/non-depreciating asset
   * (e.g. land) up or down, posting the difference against the Revaluation
   * Reserve equity account rather than income statement revenue — a
   * revaluation is not a sale.
   */
  async revalueAsset(clinicId, assetId, { new_value: newValueRaw, reason }, userId) {
    const asset = await this.getAsset(clinicId, assetId);
    if (!asset) throw new Error('Asset not found');
    if (asset.status !== 'active') throw new Error('Only an active asset can be revalued');
    if (asset.nature === 'depreciating') throw new Error('A depreciating asset is not revalued manually — use the depreciation run instead');

    const newValue = parseFloat(newValueRaw);
    if (!(newValue >= 0)) throw new Error('new_value must be a non-negative number');
    const oldValue = parseFloat(asset.current_value);
    const delta = Number((newValue - oldValue).toFixed(2));
    if (Math.abs(delta) < 0.01) throw new Error('New value is the same as the current value — nothing to revalue');

    const transaction = await sequelize.transaction();
    try {
      const assetAccountId = await this._categoryAccount(clinicId, asset.category_id, 'asset_account_id', transaction);
      const [[reserveAccount]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '3200'`, { replacements: { clinicId }, transaction });
      if (!assetAccountId || !reserveAccount) throw new Error('Asset or Revaluation Reserve account not configured');

      const lineItems = delta > 0
        ? [
            { account_id: assetAccountId, debit_amount: delta, credit_amount: 0, description: `Revaluation increase - ${asset.asset_code}` },
            { account_id: reserveAccount.id, debit_amount: 0, credit_amount: delta, description: `Revaluation increase - ${asset.asset_code}` },
          ]
        : [
            { account_id: reserveAccount.id, debit_amount: Math.abs(delta), credit_amount: 0, description: `Revaluation decrease - ${asset.asset_code}` },
            { account_id: assetAccountId, debit_amount: 0, credit_amount: Math.abs(delta), description: `Revaluation decrease - ${asset.asset_code}` },
          ];

      const glEntry = await AccountingService.createGLEntry(
        {
          clinic_id: clinicId,
          transaction_date: new Date(),
          transaction_type: 'fixed_asset_revaluation',
          description: `Revaluation - ${asset.asset_code} - ${asset.name}${reason ? ` (${reason})` : ''}`,
          reference_id: assetId,
          reference_module: 'fixed_asset_revaluation',
        },
        lineItems,
        userId,
        transaction
      );

      await sequelize.query(
        `UPDATE fixed_assets SET current_value = :newValue, last_revalued_at = CURRENT_DATE, updated_at = NOW() WHERE id = :id`,
        { replacements: { newValue, id: assetId }, transaction }
      );

      await transaction.commit();
      return { assetId, oldValue, newValue, delta, glEntryId: glEntry.id };
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }
}

module.exports = new AssetService();

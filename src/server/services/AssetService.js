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
      // F1: a legacy asset (one the facility already owned before this module
      // existed) can be partway through its useful life — captured here so
      // its depreciation schedule continues from where it really is instead
      // of restarting at 0.
      opening_accumulated_depreciation: openingAccumulatedDepreciationRaw,
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
    // F3: an explicit salvage_value is entered in the SAME currency as
    // acquisition_cost_original (the form that captures both together) — it
    // needs the same base-currency conversion acquisitionCost already gets,
    // or a foreign-currency asset's salvage value would be compared against
    // (and later subtracted from) a base-currency cost while itself still
    // sitting in the original currency, silently over/under-stating the
    // depreciable base by the exchange rate's own magnitude. The
    // percent-of-cost default needs no conversion — it's already derived
    // from acquisitionCost, which is base-currency.
    const salvageValue = salvageValueRaw != null
      ? AccountingService.convertAmount(salvageValueRaw, exchangeRate)
      : Number((acquisitionCost * (parseFloat(category.default_salvage_percent) || 0) / 100).toFixed(2));
    if (salvageValue < 0 || salvageValue > acquisitionCost) {
      throw new Error('salvage_value must be between 0 and the acquisition cost');
    }
    const openingAccumulatedDepreciation = openingAccumulatedDepreciationRaw != null
      ? AccountingService.convertAmount(openingAccumulatedDepreciationRaw, exchangeRate)
      : 0;
    if (openingAccumulatedDepreciation < 0 || openingAccumulatedDepreciation > acquisitionCost - salvageValue) {
      throw new Error('opening_accumulated_depreciation must be between 0 and (acquisition_cost - salvage_value)');
    }

    const transaction = await sequelize.transaction();
    try {
      const assetId = uuidv4();
      const assetCode = await this.generateAssetCode(clinicId, transaction);

      const assetAccount = category.asset_account_id ? { id: category.asset_account_id } : null;
      if (!assetAccount) throw new Error(`Asset category "${category.name}" has no asset GL account configured`);

      let glEntryId = null;
      if (paymentAccountCode) {
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
      } else {
        // F1: a legacy asset (no payment_account_code — nothing was actually
        // paid through this system) used to post NOTHING at all, so the
        // balance sheet's Fixed Assets line never matched the sum of
        // registered assets — the register and the general ledger silently
        // disagreed from the moment the asset was entered. This posts an
        // opening-balance entry instead: the asset at its full gross cost,
        // any opening accumulated depreciation already carried against a
        // dedicated contra account (so the depreciation schedule and the
        // ledger both continue from the asset's true starting point, not
        // zero), and the net book value against Retained Earnings (3200) —
        // the standard opening-balance treatment for a pre-existing asset
        // being brought onto the books for the first time, not a new
        // acquisition and not revenue.
        const [[openingEquityAccount]] = await sequelize.query(
          `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '3200' AND is_active = true`,
          { replacements: { clinicId }, transaction }
        );
        if (!openingEquityAccount) throw new Error('Retained Earnings account (3200) is not configured — required to register a legacy asset with no payment account');

        const lineItems = [
          { account_id: assetAccount.id, debit_amount: acquisitionCost, credit_amount: 0, description: `Opening balance - ${name}` },
        ];
        if (openingAccumulatedDepreciation > 0) {
          const accumAccountId = category.accumulated_depreciation_account_id;
          if (!accumAccountId) throw new Error(`Asset category "${category.name}" has no accumulated-depreciation GL account configured, but opening_accumulated_depreciation was given`);
          lineItems.push({ account_id: accumAccountId, debit_amount: 0, credit_amount: openingAccumulatedDepreciation, description: `Opening accumulated depreciation - ${name}` });
        }
        lineItems.push({
          account_id: openingEquityAccount.id, debit_amount: 0,
          credit_amount: Number((acquisitionCost - openingAccumulatedDepreciation).toFixed(2)),
          description: `Opening balance (net book value) - ${name}`,
        });

        // transaction_currency is intentionally left unset (defaults to base
        // currency, rate 1.0) — every line above (acquisitionCost,
        // openingAccumulatedDepreciation) is already a base-currency amount
        // (converted above via exchangeRate), so no further conversion
        // should happen — passing acquisitionCurrency here as well would
        // convert them a second time.
        const glEntry = await AccountingService.createGLEntry(
          {
            clinic_id: clinicId,
            transaction_date: acquisitionDate,
            transaction_type: 'fixed_asset_opening_balance',
            description: `Legacy asset opening balance - ${assetCode} - ${name}`,
            reference_id: assetId,
            reference_module: 'fixed_asset_acquisition',
          },
          lineItems,
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
           :method, :openingAccumulatedDepreciation, :currentValue, 'active', :glEntryId, :notes, :createdBy
         )`,
        {
          replacements: {
            id: assetId, clinicId, branchId: branchId || null, assetCode, name: name.trim(), categoryId,
            description: description || null, serialNumber: serialNumber || null, location: location || null,
            assignedTo: assignedToEmployeeId || null, nature, acquisitionDate, acquisitionCost, acquisitionCurrency,
            acquisitionCostOriginal, exchangeRate, salvageValue,
            usefulLifeYears: usefulLifeYears || null, method: nature === 'depreciating' ? (category.default_depreciation_method || 'straight_line') : 'none',
            openingAccumulatedDepreciation,
            currentValue: Number((acquisitionCost - openingAccumulatedDepreciation).toFixed(2)),
            glEntryId, notes: notes || null, createdBy: userId || null,
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
  // instead of letting a non-numeric value blow up the query. That guard needs to
  // be a CASE, not `regex AND u.id = created_by::integer` — Postgres does not
  // guarantee left-to-right short-circuit evaluation of an AND in a JOIN's ON
  // clause, so the planner can (and, confirmed live, does) evaluate the cast
  // before the regex check, blowing up on the very first non-numeric
  // created_by it sees. A CASE expression's WHEN is evaluated per-row before
  // its THEN, which Postgres does guarantee.
  async getAsset(clinicId, assetId) {
    const [[asset]] = await sequelize.query(
      `SELECT fa.*, ac.name AS category_name, ac.nature AS category_nature, u.display_name AS registered_by_name
       FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id
       LEFT JOIN users u ON u.id = (CASE WHEN fa.created_by ~ '^[0-9]+$' THEN fa.created_by::integer ELSE NULL END)
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
    // F5: depreciation is only ever earned by time that has actually passed —
    // running it for a period that hasn't happened yet would front-load
    // expense before it's real and let a book-value projection be posted as
    // if it were fact.
    const currentPeriod = new Date().toISOString().slice(0, 7);
    if (period > currentPeriod) throw new Error(`Cannot run depreciation for ${period} — that period hasn't happened yet (current period: ${currentPeriod}).`);

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
  async disposeAsset(clinicId, assetId, { disposal_date: disposalDateRaw, proceeds: proceedsRaw, reason, payment_account_code: paymentAccountCode }, userId) {
    const asset = await this.getAsset(clinicId, assetId);
    if (!asset) throw new Error('Asset not found');
    if (asset.status === 'disposed') throw new Error('This asset has already been disposed of');

    const disposalDate = disposalDateRaw || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    // F5: a disposal is a real, dated financial event — dating it in the
    // future would remove the asset from the books (and post a gain/loss)
    // before it's actually happened.
    if (disposalDate > today) throw new Error(`disposal_date cannot be in the future (${disposalDate})`);
    // F8: backdating a disposal to before the asset was even acquired, or to
    // before depreciation that has ALREADY been posted for later periods,
    // creates a disposal that predates its own accumulated_depreciation —
    // the asset would be shown as removed from the books before the ledger
    // says it finished depreciating.
    if (disposalDate < asset.acquisition_date) {
      throw new Error(`disposal_date (${disposalDate}) cannot be before this asset's acquisition_date (${asset.acquisition_date})`);
    }
    const [[latestDepreciation]] = await sequelize.query(
      `SELECT period FROM asset_depreciation_entries WHERE asset_id = :assetId ORDER BY period DESC LIMIT 1`,
      { replacements: { assetId } }
    );
    if (latestDepreciation) {
      const [y, m] = latestDepreciation.period.split('-').map(Number);
      const periodEnd = new Date(y, m, 0).toISOString().split('T')[0]; // last calendar day of that period
      if (disposalDate < periodEnd) {
        throw new Error(`disposal_date (${disposalDate}) cannot be before ${periodEnd}, the end of ${latestDepreciation.period} — depreciation has already been posted for this asset through that date.`);
      }
    }

    const proceeds = proceedsRaw != null ? parseFloat(proceedsRaw) : 0;
    const cost = parseFloat(asset.acquisition_cost);
    const accumulatedDepreciation = parseFloat(asset.accumulated_depreciation);
    // F2: current_value is the asset's actual, up-to-date carrying amount —
    // recomputing "cost - accumulated_depreciation" instead silently ignored
    // any revaluation (revalueAsset adjusts current_value directly and never
    // touches accumulated_depreciation, since only a non-depreciating asset
    // can be revalued), so a revalued asset's disposal used to compute
    // gain/loss — and remove the asset from the books — against a stale,
    // pre-revaluation figure.
    const bookValue = parseFloat(asset.current_value);
    const gainOrLoss = Number((proceeds - bookValue).toFixed(2));
    // What's actually sitting in the asset account for this specific asset:
    // acquisition_cost for a depreciating asset (revaluation is blocked for
    // those, so its asset-account balance never moves from cost), or
    // current_value for a revalued one (revaluation posts straight to the
    // same asset account, replacing cost's role) — current_value +
    // accumulated_depreciation is exactly that in both cases.
    const grossAssetAccountBalance = Number((bookValue + accumulatedDepreciation).toFixed(2));

    const transaction = await sequelize.transaction();
    try {
      // F6: resolve every account this entry needs BEFORE building any line
      // items, and fail with a specific, actionable message per account —
      // the old code silently dropped any line whose account lookup
      // returned null (`lineItems.filter((l) => l.account_id)`), which could
      // drop the asset-removal line itself and either let a disposal through
      // with an incomplete entry or fail deep inside createGLEntry with an
      // opaque "not balanced" error that says nothing about which account
      // was actually missing.
      const assetAccountId = await this._categoryAccount(clinicId, asset.category_id, 'asset_account_id', transaction);
      if (!assetAccountId) throw new Error(`This asset's category has no asset GL account configured — cannot dispose of it until that's set up in Asset Categories.`);
      let accumDepreciationAccountId = null;
      if (accumulatedDepreciation > 0) {
        accumDepreciationAccountId = await this._categoryAccount(clinicId, asset.category_id, 'accumulated_depreciation_account_id', transaction);
        if (!accumDepreciationAccountId) throw new Error(`This asset's category has no accumulated-depreciation GL account configured — cannot remove its ${accumulatedDepreciation} accumulated depreciation. Set one up in Asset Categories first.`);
      }

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
        lineItems.push({ account_id: accumDepreciationAccountId, debit_amount: accumulatedDepreciation, credit_amount: 0, description: `Remove accumulated depreciation - ${asset.asset_code}` });
      }
      lineItems.push({ account_id: assetAccountId, debit_amount: 0, credit_amount: grossAssetAccountBalance, description: `Disposal of asset - ${asset.asset_code}` });

      if (gainOrLoss > 0.01) {
        const [[gainAccount]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '4900'`, { replacements: { clinicId }, transaction });
        if (!gainAccount) throw new Error(`A gain of ${gainOrLoss} on this disposal has no home — account 4900 (Other Income) is not configured for this clinic.`);
        lineItems.push({ account_id: gainAccount.id, debit_amount: 0, credit_amount: gainOrLoss, description: `Gain on disposal - ${asset.asset_code}` });
      } else if (gainOrLoss < -0.01) {
        const [[lossAccount]] = await sequelize.query(`SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = '5910'`, { replacements: { clinicId }, transaction });
        if (!lossAccount) throw new Error(`A loss of ${Math.abs(gainOrLoss)} on this disposal has no home — account 5910 (Loss on Disposal) is not configured for this clinic.`);
        lineItems.push({ account_id: lossAccount.id, debit_amount: Math.abs(gainOrLoss), credit_amount: 0, description: `Loss on disposal - ${asset.asset_code}` });
      }

      const glEntry = await AccountingService.createGLEntry(
        {
          clinic_id: clinicId,
          transaction_date: disposalDate,
          transaction_type: 'fixed_asset_disposal',
          description: `Disposal - ${asset.asset_code} - ${asset.name}`,
          reference_id: assetId,
          reference_module: 'fixed_asset_disposal',
        },
        lineItems,
        userId,
        transaction
      );

      await sequelize.query(
        `UPDATE fixed_assets SET status = 'disposed', disposal_date = :disposalDate, disposal_proceeds = :proceeds,
           disposal_reason = :reason, current_value = 0, updated_at = NOW()
         WHERE id = :id`,
        { replacements: { disposalDate, proceeds, reason: reason || null, id: assetId }, transaction }
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

// ══════════════════════════════════════════════════════════════════════════
// Phase 3 of the central Categories feature (docs/accounting-map/REPORT.md).
// Single place that decides which chart-of-accounts row an item, service,
// or expense posts to — replacing six previously-independent, inconsistent
// engines: resolveRevenueAccount.js's regex map, pharmacyCogsOnBill.js's
// CATEGORY_ACCOUNTS map, pharmacyModule.js's dispensing fallback chain,
// daily-expenses.js's CATEGORY_EXPENSE_CODE map, procurement.js's GRN
// drugs-vs-everything-else binary, and TheatreService's ad-hoc 'pharma'/
// 'theatre' labels. The same drug now resolves to the same accounts
// regardless of which screen sold it.
//
// Precedence, identical for every resolve* function:
//   1. An explicit account on the record itself (item/service/drug override).
//   2. The record's category's account (categories table).
//   3. A clinic-wide default from settings (inventory_settings /
//      pharmacy_settings — the same tables the old fallback chains already
//      read, just centralized here instead of duplicated per caller).
//   4. Still nothing: log an accounting_exceptions row and return the
//      clinic's 9999 Suspense - Unclassified account, so the entry a caller
//      builds from this still balances and is visible on the income
//      statement, instead of the several call sites that used to just
//      `continue`/skip with only a console.warn.
//
// Every resolve* function therefore ALWAYS returns a usable account id —
// never null — so a caller never needs its own "if no account, skip" branch
// anymore; that branch is this module's job now.
// ══════════════════════════════════════════════════════════════════════════

const { sequelize } = require('../models');
const AccountingService = require('./AccountingService');
const { v4: uuidv4 } = require('uuid');

async function getCategoryById(db, categoryId) {
  if (!categoryId) return null;
  const [[row]] = await db.query(`SELECT * FROM categories WHERE id = :id AND is_active = true`, { replacements: { id: categoryId } });
  return row || null;
}

async function getAccountById(db, accountId) {
  if (!accountId) return null;
  const [[row]] = await db.query(`SELECT * FROM chart_of_accounts WHERE id = :id AND is_active = true`, { replacements: { id: accountId } });
  return row || null;
}

async function getSuspenseAccountId(db, clinicId) {
  const acct = await AccountingService.getAccountByCode(clinicId, '9999');
  return acct?.id || null;
}

/**
 * Logs what couldn't be resolved and returns the suspense account id to
 * use instead — the "never silent" step. Non-fatal: a failure to even
 * write the exception row must never block the posting it's describing
 * (same "accounting is best-effort logging, never a hard dependency" rule
 * every other self-heal script in this codebase already follows).
 */
async function recordExceptionAndGetSuspense(db, { clinicId, branchId, sourceModule, referenceType, referenceId, description, amount, currency, missingAccountType }) {
  const suspenseId = await getSuspenseAccountId(db, clinicId);
  try {
    await db.query(
      `INSERT INTO accounting_exceptions
         (id, clinic_id, branch_id, source_module, reference_type, reference_id, description, amount, currency, missing_account_type, suspense_account_id, status)
       VALUES (:id, :clinicId, :branchId, :sourceModule, :referenceType, :referenceId, :description, :amount, :currency, :missingAccountType, :suspenseId, 'open')`,
      {
        replacements: {
          id: uuidv4(), clinicId, branchId: branchId || null, sourceModule,
          referenceType: referenceType || null, referenceId: referenceId || null,
          description, amount: amount != null ? amount : null, currency: currency || null,
          missingAccountType: missingAccountType || null, suspenseId,
        },
      }
    );
  } catch (e) {
    console.error('AccountResolver: failed to record accounting_exceptions row (non-blocking):', e.message);
  }
  return suspenseId;
}

/**
 * @param {object} item - a row (or row-shaped object) carrying AT LEAST
 *   item_category and category_id, and optionally its own override columns
 *   revenue_account_id/cogs_account_id/inventory_account_id.
 * @param {object} ctx - { clinicId, branchId, sourceModule, referenceId, amount, currency }
 * @returns {Promise<{inventory: string, cogs: string, revenue: string}>}
 */
async function resolveItemAccounts(item, ctx = {}) {
  const db = ctx.db || sequelize;
  const clinicId = ctx.clinicId || item.clinic_id || 1;
  const label = item.item_name || item.name || item.id || 'item';
  // Which slots the caller actually needs resolved/validated — defaults to
  // all three, but e.g. pharmacyCogsOnBill.js only ever uses cogs+inventory,
  // and must never get (or log an exception for) a revenue account it was
  // never going to read.
  const need = ctx.need || ['inventory', 'cogs', 'revenue'];
  const wants = (slot) => need.includes(slot);

  let revenue = item.revenue_account_id ? await getAccountById(db, item.revenue_account_id) : null;
  let cogs = item.cogs_account_id ? await getAccountById(db, item.cogs_account_id) : null;
  let inventory = item.inventory_account_id ? await getAccountById(db, item.inventory_account_id) : null;

  let category = null;
  if (((wants('revenue') && !revenue) || (wants('cogs') && !cogs) || (wants('inventory') && !inventory)) && item.category_id) {
    category = await getCategoryById(db, item.category_id);
  }
  if (wants('revenue') && !revenue && category?.revenue_account_id) revenue = await getAccountById(db, category.revenue_account_id);
  if (wants('cogs') && !cogs && category?.cogs_account_id) cogs = await getAccountById(db, category.cogs_account_id);
  if (wants('inventory') && !inventory && category?.inventory_account_id) inventory = await getAccountById(db, category.inventory_account_id);

  if (wants('inventory') && !inventory || wants('cogs') && !cogs) {
    const [[invSettings]] = await db.query(`SELECT inventory_account_id, cogs_account_id FROM inventory_settings WHERE clinic_id = :clinicId LIMIT 1`, { replacements: { clinicId } });
    if (wants('inventory') && !inventory && invSettings?.inventory_account_id) inventory = await getAccountById(db, invSettings.inventory_account_id);
    if (wants('cogs') && !cogs && invSettings?.cogs_account_id) cogs = await getAccountById(db, invSettings.cogs_account_id);
  }
  if (wants('revenue') && !revenue || wants('cogs') && !cogs) {
    const [[pharmSettings]] = await db.query(`SELECT pharmacy_revenue_account_id, pharmacy_cogs_account_id FROM pharmacy_settings WHERE clinic_id = :clinicId LIMIT 1`, { replacements: { clinicId } });
    if (wants('revenue') && !revenue && pharmSettings?.pharmacy_revenue_account_id) revenue = await getAccountById(db, pharmSettings.pharmacy_revenue_account_id);
    if (wants('cogs') && !cogs && pharmSettings?.pharmacy_cogs_account_id) cogs = await getAccountById(db, pharmSettings.pharmacy_cogs_account_id);
  }

  const missing = [];
  if (wants('inventory') && !inventory) missing.push('inventory');
  if (wants('cogs') && !cogs) missing.push('cogs');
  if (wants('revenue') && !revenue) missing.push('revenue');
  let suspenseId = null;
  if (missing.length) {
    suspenseId = await recordExceptionAndGetSuspense(db, {
      clinicId, branchId: ctx.branchId, sourceModule: ctx.sourceModule || 'AccountResolver.resolveItemAccounts',
      referenceType: 'inventory_item', referenceId: item.id || null,
      description: `No ${missing.join('/')} account resolved for "${label}" (category: ${item.item_category || 'none'})`,
      amount: ctx.amount, currency: ctx.currency, missingAccountType: missing.join(','),
    });
  }

  return {
    inventory: wants('inventory') ? (inventory?.id || suspenseId) : (inventory?.id || null),
    cogs: wants('cogs') ? (cogs?.id || suspenseId) : (cogs?.id || null),
    revenue: wants('revenue') ? (revenue?.id || suspenseId) : (revenue?.id || null),
  };
}

/**
 * @param {object} svc - a row (or row-shaped object) carrying AT LEAST
 *   category/category_id, and optionally its own revenue_account_id override.
 * @returns {Promise<string>} a revenue account id.
 */
async function resolveServiceRevenue(svc, ctx = {}) {
  const db = ctx.db || sequelize;
  const clinicId = ctx.clinicId || svc.clinic_id || 1;
  const label = svc.service_name || svc.name || svc.id || 'service';

  let revenue = svc.revenue_account_id ? await getAccountById(db, svc.revenue_account_id) : null;

  let category = null;
  if (!revenue && svc.category_id) category = await getCategoryById(db, svc.category_id);
  if (!revenue && category?.revenue_account_id) revenue = await getAccountById(db, category.revenue_account_id);

  // No clinic-default setting exists for service revenue today (pharmacy_settings/
  // inventory_settings are item-shaped) — the legacy regex fallback on the raw
  // category/name string is kept as the LAST resort before suspense, per the
  // approved plan ("keep the regex only as a LAST fallback for legacy
  // free-text bill lines, logged"), rather than inventing a new settings row.
  if (!revenue) {
    const { resolveRevenueAccount } = require('../utils/resolveRevenueAccount');
    const categoryString = svc.category || category?.name || label;
    const legacyId = await resolveRevenueAccount(categoryString, clinicId);
    if (legacyId) {
      console.warn(`AccountResolver.resolveServiceRevenue: no override/category account for "${label}" — fell back to the legacy regex on "${categoryString}".`);
      revenue = await getAccountById(db, legacyId);
    }
  }

  if (!revenue) {
    const suspenseId = await recordExceptionAndGetSuspense(db, {
      clinicId, branchId: ctx.branchId, sourceModule: ctx.sourceModule || 'AccountResolver.resolveServiceRevenue',
      referenceType: 'service', referenceId: svc.id || null,
      description: `No revenue account resolved for "${label}" (category: ${svc.category || 'none'})`,
      amount: ctx.amount, currency: ctx.currency, missingAccountType: 'revenue',
    });
    return suspenseId;
  }
  return revenue.id;
}

/**
 * @param {object} cat - either a categories row, or { category_id } / a
 *   plain category name string (legacy free-text expense category).
 * @returns {Promise<string>} an expense account id.
 */
async function resolveExpenseAccount(cat, ctx = {}) {
  const db = ctx.db || sequelize;
  const clinicId = ctx.clinicId || 1;
  const categoryId = typeof cat === 'string' ? null : (cat?.category_id || cat?.id);
  const categoryName = typeof cat === 'string' ? cat : cat?.category || cat?.name;

  let category = categoryId ? await getCategoryById(db, categoryId) : null;
  if (!category && categoryName) {
    const [[row]] = await db.query(
      `SELECT * FROM categories WHERE clinic_id = :clinicId AND type = 'expense' AND LOWER(TRIM(name)) = LOWER(TRIM(:name)) AND is_active = true LIMIT 1`,
      { replacements: { clinicId, name: categoryName } }
    );
    category = row || null;
  }

  let expense = category?.expense_account_id ? await getAccountById(db, category.expense_account_id) : null;

  // DEFAULT_EXPENSE_CODE (5900) is the one genuine "clinic default" already
  // used everywhere expense categorization happens — kept as step 3.
  if (!expense) {
    const fallback = await AccountingService.getAccountByCode(clinicId, '5900');
    expense = fallback || null;
  }

  if (!expense) {
    const suspenseId = await recordExceptionAndGetSuspense(db, {
      clinicId, branchId: ctx.branchId, sourceModule: ctx.sourceModule || 'AccountResolver.resolveExpenseAccount',
      referenceType: 'expense_category', referenceId: categoryId || null,
      description: `No expense account resolved for category "${categoryName || 'unknown'}" (and 5900 Miscellaneous Expenses is also missing/inactive)`,
      amount: ctx.amount, currency: ctx.currency, missingAccountType: 'expense',
    });
    return suspenseId;
  }
  return expense.id;
}

/**
 * Per-line-type dispatcher for a generic bill line — the one
 * resolveRevenueAccountForLine (utils/resolveRevenueAccount.js) used to be.
 * Precedence mirrors that function's own doc comment exactly, with its
 * catalogue lookups replaced by category-first resolution:
 *   1. an account the caller supplied (line.revenue_account_id) — always wins
 *   2. the services catalogue, by id then name — now via category_id
 *   3. the lab test catalogue, by name — forced 'laboratory' category
 *   4. the inventory catalogue, by id then name — now via category_id
 *   5. the legacy regex on the line's own name — last resort, logged
 *   6. still nothing — suspense + exception
 */
async function resolveLineAccounts(line, ctx = {}) {
  const db = ctx.db || sequelize;
  const clinicId = ctx.clinicId || 1;
  if (line.revenue_account_id) return line.revenue_account_id;

  const id = line.serviceId ?? line.service_id ?? null;
  const name = (line.serviceName || line.service_name || line.item_name || '').trim();
  if (!id && !name) {
    const suspenseId = await recordExceptionAndGetSuspense(db, {
      clinicId, branchId: ctx.branchId, sourceModule: ctx.sourceModule || 'AccountResolver.resolveLineAccounts',
      referenceType: 'bill_line', referenceId: ctx.referenceId || null,
      description: 'Bill line has no service id/name to resolve a revenue account from',
      amount: ctx.amount, currency: ctx.currency, missingAccountType: 'revenue',
    });
    return suspenseId;
  }

  if (id) {
    const [[svc]] = await db.query('SELECT * FROM services WHERE id = :id LIMIT 1', { replacements: { id } });
    if (svc) return resolveServiceRevenue(svc, ctx);
  }
  if (name) {
    const [[svc]] = await db.query('SELECT * FROM services WHERE LOWER(service_name) = LOWER(:name) LIMIT 1', { replacements: { name } });
    if (svc) return resolveServiceRevenue(svc, ctx);

    // lab_tests.revenue_account_id (per-test override) -> its category_id's
    // account -> forced 'laboratory' regex bucket as the last resort — same
    // precedence as everywhere else, just forcing a sensible category when
    // the test has none of its own configured yet.
    const [[labTest]] = await db.query('SELECT id, category_id, revenue_account_id FROM lab_tests WHERE LOWER(test_name) = LOWER(:name) LIMIT 1', { replacements: { name } });
    if (labTest) {
      if (labTest.revenue_account_id) return labTest.revenue_account_id;
      if (labTest.category_id) {
        const labCategory = await getCategoryById(db, labTest.category_id);
        if (labCategory?.revenue_account_id) return labCategory.revenue_account_id;
      }
      const { resolveRevenueAccount } = require('../utils/resolveRevenueAccount');
      const id2 = await resolveRevenueAccount('laboratory', clinicId);
      if (id2) return id2;
    }

    const [[item]] = await db.query('SELECT * FROM inventory_items WHERE LOWER(item_name) = LOWER(:name) LIMIT 1', { replacements: { name } });
    if (item) {
      const accounts = await resolveItemAccounts(item, { ...ctx, need: ['revenue'] });
      return accounts.revenue;
    }
  }

  // Nothing matched a catalogue — same legacy last resort
  // resolveRevenueAccountForLine itself used before falling to 4100.
  const { resolveRevenueAccount } = require('../utils/resolveRevenueAccount');
  const legacyId = await resolveRevenueAccount(name, clinicId);
  if (legacyId) {
    console.warn(`AccountResolver.resolveLineAccounts: no catalogue match for "${name}" — fell back to the legacy regex.`);
    return legacyId;
  }
  const suspenseId = await recordExceptionAndGetSuspense(db, {
    clinicId, branchId: ctx.branchId, sourceModule: ctx.sourceModule || 'AccountResolver.resolveLineAccounts',
    referenceType: 'bill_line', referenceId: ctx.referenceId || null,
    description: `No revenue account resolved for bill line "${name}"`,
    amount: ctx.amount, currency: ctx.currency, missingAccountType: 'revenue',
  });
  return suspenseId;
}

module.exports = {
  resolveItemAccounts,
  resolveServiceRevenue,
  resolveExpenseAccount,
  resolveLineAccounts,
  recordExceptionAndGetSuspense,
  getSuspenseAccountId,
};

// ══════════════════════════════════════════════════════════════════════════
// Posts a Cost of Goods Sold GL entry for a billed line item that matches
// the inventory/pharmacy catalog — even when that item was billed through
// the ordinary billing screens (patientBills.js's POST / and PUT
// /:billId/add-services), not through the Pharmacy module's own
// /dispensing endpoint.
//
// Why this exists: pharmacyModule.js's /dispensing endpoint already posts
// COGS correctly at the dispensed item's real cost — but verified against a
// real tenant's live data, drug sales there almost never actually go
// through that endpoint. Staff bill drugs as ordinary line items directly
// (on a general bill, or bundled into a consultation bill auto-created on
// queueing), which never touches /dispensing, so COGS never posts for them
// no matter how correct that endpoint's own logic is.
//
// Deliberately NOT duplicated per-file (this codebase's usual convention
// for these billing-side-effect hooks — see createLabRequestsFromBill /
// createTheatreRequestsFromBill in patientBills.js, which ARE each
// self-contained). This one is shared by both the real-time hook (wired
// into patientBills.js, for bills going forward) and the one-time
// historical backfill script, so a bill billed today and a bill backfilled
// from last month get IDENTICAL treatment — keeping two hand-copies of this
// much matching/costing/account-resolution logic in sync by hand is a
// correctness risk neither should carry for live financial postings.
//
// Scope, confirmed with the user before building:
//   - COGS only. Never touches physical stock (quantity_on_hand) — a billed
//     line item's name is a FUZZY match (ILIKE) against the inventory
//     catalog, and auto-adjusting real stock counts off a fuzzy text match
//     is a materially riskier class of mistake than a GL misclassification.
//   - Only categories with a real inventory asset account to credit
//     (drugs/reagents/consumables/supplies/surgical) post anything —
//     'equipment'/'general'/no-match items are skipped, same reasoning as
//     daily-expenses.js's inferExpenseAccountFromPOItems.
//   - Cost comes from the item's own average_unit_cost/current_unit_cost
//     (no batch context available at billing time) — never fabricated when
//     neither is recorded.
//   - Idempotent: stamps `cogsPosted: true` + `cogsGlEntryId` onto the JSON
//     line item once posted, so re-running (the hook on a later
//     add-services call, or the backfill script a second time) never
//     double-posts the same line.
//   - Skips a bill entirely if it already has a real dispensing_records row
//     with cogs_gl_entry_id set — someone used the proper Pharmacy
//     dispense flow for it (which also deducts real stock), so this must
//     not post a second COGS entry on top of that one.
//   - Skips a bill whose notes is exactly the marker DispensingWorkflow.tsx's
//     billForSale() stamps on a freshly-created direct-sale bill, for the
//     same double-posting reason, before any dispensing_records row exists
//     yet to catch it the other way.
// ══════════════════════════════════════════════════════════════════════════

const AccountingService = require('../services/AccountingService');
const AccountResolver = require('../services/AccountResolver');
const { ChartOfAccounts } = require('../models');

// Resolved by account id, cached alongside the category-code cache (a
// distinct key prefix keeps the two from colliding in the same Map).
async function getAccountByIdCached(cache, accountId) {
  const key = `id:${accountId}`;
  if (!cache.has(key)) {
    cache.set(key, await ChartOfAccounts.findOne({ where: { id: accountId, is_active: true } }));
  }
  return cache.get(key);
}

function normalizeName(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Central Categories feature (Phase 3): account resolution for a matched
// inventory_items row now goes through AccountResolver.resolveItemAccounts
// (override -> category -> clinic default -> suspense), replacing this
// file's own CATEGORY_ACCOUNTS map. Kept here, commented out, only as a
// record of what the map used to say — 'equipment'/'general' had no entry
// at all (a line for either was silently skipped); AccountResolver's
// Phase 2 seed gives every category an inventory account and, for those
// two specifically, no cogs_account_id, by confirmed decision — so this
// case now reaches the suspense/exception path instead of being skipped.
//
// const CATEGORY_ACCOUNTS = {
//   drugs: { cogsCode: '5210', invCode: '1310' },
//   reagents: { cogsCode: '5220', invCode: '1300' },
//   consumables: { cogsCode: '5200', invCode: '1300' },
//   supplies: { cogsCode: '5200', invCode: '1300' },
//   surgical: { cogsCode: '5200', invCode: '1300' },
// };

const PHARMACY_DIRECT_SALE_NOTE = 'Auto-generated from pharmacy direct sale';

/**
 * @param {object} sequelize - the tenant-scoped connection (caller's
 *   responsibility to be running inside the right tenant context already —
 *   AccountingService itself resolves ambiently, same as every other caller
 *   of it in this codebase).
 * @param {object} opts
 * @param {number} opts.clinicId
 * @param {number|null} opts.branchId
 * @param {string} opts.billId
 * @param {string|Date} opts.billDate
 * @param {string|null} opts.billNotes
 * @param {Array} opts.services - the bill's parsed services array (will be mutated in place for flagged items)
 * @param {string|number|null} opts.userId
 * @param {Map} [opts.accountCache] - optional, shared across many calls (e.g. the backfill script) to avoid re-querying the same account repeatedly
 * @param {boolean} [opts.dryRun] - runs every matching/costing/account-resolution step for real (so a preview shows real inferred amounts) but skips the two AccountingService writes and the cogsPosted mutation.
 * @returns {{changed: boolean, postedCount: number, postedTotal: number, services: Array, previewed: Array}}
 */
async function postPharmacyCogsForBill(sequelize, { clinicId, branchId, billId, billDate, billNotes, services, userId, accountCache, dryRun }) {
  const result = { changed: false, postedCount: 0, postedTotal: 0, services, previewed: [] };
  if (!Array.isArray(services) || services.length === 0) return result;
  if (billNotes === PHARMACY_DIRECT_SALE_NOTE) return result;

  const [[existingDispense]] = await sequelize.query(
    `SELECT 1 FROM dispensing_records WHERE bill_id = :billId AND cogs_gl_entry_id IS NOT NULL LIMIT 1`,
    { replacements: { billId } }
  );
  if (existingDispense) return result;

  const cache = accountCache || new Map();
  let changed = false;
  let postedCount = 0;
  let postedTotal = 0;

  for (const item of services) {
    if (!item || item.cogsPosted || item.isVoided) continue;
    const rawName = (item.serviceName || item.name || item.service_name || '').trim();
    if (!rawName) continue;
    const n = normalizeName(rawName);
    if (!n) continue;

    const [matches] = await sequelize.query(
      `SELECT id, item_name, item_category, category_id, current_unit_cost, average_unit_cost, cogs_account_id, inventory_account_id
       FROM inventory_items WHERE is_active = true AND item_name ILIKE :pattern
       ORDER BY length(item_name) DESC LIMIT 1`,
      { replacements: { pattern: `%${rawName}%` } }
    );
    const invItem = matches[0];
    if (!invItem) continue;

    const unitCost = parseFloat(invItem.current_unit_cost) > 0 ? parseFloat(invItem.current_unit_cost)
      : parseFloat(invItem.average_unit_cost) > 0 ? parseFloat(invItem.average_unit_cost)
      : 0;
    if (unitCost <= 0) continue;

    // Cost is per pack; a drug line billed in doses carries its pack equivalent.
    const qty = parseFloat(item.packQuantity ?? item.quantity) || 1;
    const cogsAmount = unitCost * qty;
    if (cogsAmount <= 0) continue;

    // AccountResolver: item's own override -> its category's account ->
    // clinic default (inventory_settings) -> suspense + accounting_exceptions
    // row, never a silent skip — see AccountResolver.js. 'equipment'/'general'
    // items have no cogs_account_id seeded (confirmed decision, matching
    // today's actual behavior of skipping those), so they'll now land on
    // suspense instead of being dropped with no GL trace at all.
    const accounts = await AccountResolver.resolveItemAccounts(invItem, {
      clinicId, branchId, need: ['cogs', 'inventory'], sourceModule: 'pharmacyCogsOnBill',
      referenceId: billId, amount: cogsAmount,
    });
    const cogsAcct = await getAccountByIdCached(cache, accounts.cogs);
    const invAcct = await getAccountByIdCached(cache, accounts.inventory);
    if (!cogsAcct || !invAcct) {
      console.warn(`postPharmacyCogsForBill: skipped "${rawName}" on bill ${billId} — resolved account not found/active for clinic ${clinicId}.`);
      continue;
    }
    const cogsCodeLabel = cogsAcct.account_code;
    const invCodeLabel = invAcct.account_code;

    if (dryRun) {
      result.previewed.push({ billId, billDate, itemName: invItem.item_name, billedAs: rawName, category: invItem.item_category, quantity: qty, unitCost, cogsAmount, cogsAccount: cogsCodeLabel, invAccount: invCodeLabel });
      postedCount += 1;
      postedTotal += cogsAmount;
      continue;
    }

    try {
      const glEntry = await AccountingService.createGLEntry({
        clinic_id: clinicId,
        transaction_date: billDate,
        transaction_type: 'pharmacy_bill_cogs',
        description: `COGS: ${invItem.item_name} x${qty} (billed as "${rawName}")`,
        reference_id: billId,
        reference_module: 'pharmacy_bill_cogs',
        branch_id: branchId || null,
      }, [
        { account_id: cogsAcct.id, debit_amount: cogsAmount, credit_amount: 0, description: `COGS: ${invItem.item_name}` },
        { account_id: invAcct.id, debit_amount: 0, credit_amount: cogsAmount, description: `Inventory issued (billed, not formally dispensed): ${invItem.item_name}` },
      ], userId || 'system');
      await AccountingService.postGLEntry(glEntry.id, userId || 'system');

      item.cogsPosted = true;
      item.cogsGlEntryId = glEntry.id;
      item.cogsAmount = cogsAmount;
      changed = true;
      postedCount += 1;
      postedTotal += cogsAmount;
    } catch (e) {
      console.warn(`postPharmacyCogsForBill: GL posting failed for "${rawName}" on bill ${billId}: ${e.message}`);
    }
  }

  result.changed = changed;
  result.postedCount = postedCount;
  result.postedTotal = postedTotal;
  return result;
}

module.exports = { postPharmacyCogsForBill, normalizeName, PHARMACY_DIRECT_SALE_NOTE };

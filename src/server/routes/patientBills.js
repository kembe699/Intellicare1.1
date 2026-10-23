const express = require('express');
const { getBaseCurrencyCode } = require('../utils/baseCurrency');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');
const router = express.Router();
const { PatientBill, Patient, Receipt, sequelize } = require('../models');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const BillingIntegrationService = require('../services/BillingIntegrationService');
const { getBranchCondition, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { normalizeServices, ensureLineIds } = require('../utils/normalizeServices');
const AccountingService = require('../services/AccountingService');
const { authorize } = require('../middleware/authorize');
const { adjustDepositBalance, getDepositBalance, postDepositGL, BASE_CURRENCY } = require('./patientDeposits');
const { postJournalEntry } = require('../services/JournalPostingService');

// Read access is intentionally broad — every clinical/financial-facing role needs to look
// up a patient's bill (a doctor checking it's settled, pharmacy/lab billing against it,
// a cashier collecting payment), matching the "Patient Bills" sidebar entry's own roles
// plus the staff roles that trigger billing as a side effect of their own module.
// Creating a bill or adding services to one happens from several different screens
// (LIS ordering, pharmacy prescribing, reception's Patient Bills page) — anyone who can
// generate a billable charge needs this, not just billing staff.
// Voiding a line item or editing a bill's own fields are cashier/finance actions —
// matches the sidebar's Billing Management / Cash Transfer roles. Both change what
// a patient owes, so they stay with the roles accountable for the figures.
// Taking money over a counter is a different act from adjusting what is owed.
// Pharmacy collects payment at the point of dispensing — that is the whole of the
// "Save Payment & Dispense" flow — so it belongs here, while still being unable to
// edit a bill or void a line off one. The money is not untracked: a non-credit
// payment requires an open cashier shift, and pharmacy can already open one
// (see CASHIER_WRITE in routes/cashier.js), so it lands in a shift that is counted
// and reconciled like any other.
// Deleting a bill outright is the most destructive action here — admin only.

// "Bank Transfer" is offered as a payment method in the UI but was never added to the
// receipts.payment_method enum, so saving one would fail with a MySQL enum-constraint
// error. Add it once, MySQL-native (no IF NOT EXISTS on MODIFY, so just re-run the same
// full enum every start — idempotent and harmless).
(async () => {
  try {
    await sequelize.query(`ALTER TABLE receipts MODIFY COLUMN payment_method ENUM('cash','card','check','lease','insurance','bank_transfer','deposit') NOT NULL DEFAULT 'cash'`);
    console.log('✅ Ensured bank_transfer/deposit are valid receipts.payment_method values');
  } catch (e) {
    reportSchemaGuardFailure('receipts.payment_method enum', e);
  }
})();

// Links a bill to the clinical visit it was created during — without this, "does this
// patient have an active bill" had no notion of visit boundaries at all, so a bill from
// a visit weeks ago kept absorbing every new charge from a brand-new visit instead of
// each visit getting its own bill. See getCurrentOpenVisitId() below.
(async () => {
  try {
    const [[colCheck]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'patient_bills' AND column_name = 'visit_id'
    `);
    if (colCheck.cnt === 0) {
      await sequelize.query(`ALTER TABLE patient_bills ADD COLUMN visit_id VARCHAR(36) NULL`);
      await sequelize.query(`CREATE INDEX idx_patient_bills_visit_id ON patient_bills(visit_id)`);
      console.log('✅ Added patient_bills.visit_id column');
    }
  } catch (e) {
    console.log('Note: Could not ensure patient_bills.visit_id column:', e.message);
  }
})();

// Hard guard-rail behind the application-level dedup above: even with every writer now
// resolving/locking "the active bill" consistently, this makes a duplicate bill for the
// same visit_id impossible to insert at all, no matter what future code does. MySQL
// treats every NULL as distinct under a UNIQUE index, so walk-in/legacy bills with no
// visit_id are unaffected — this only constrains rows that actually share a real
// visit_id. Verified against production data before adding: zero existing rows violate
// this (no visit_id currently has more than one bill).
(async () => {
  try {
    const [[uniqueCheck]] = await sequelize.query(`
      SELECT COUNT(*) AS cnt FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'patient_bills' AND indexname = 'uniq_patient_bills_visit_id'
    `);
    if (uniqueCheck.cnt === 0) {
      // The old non-unique index on the same column has to go first — MySQL won't let
      // two indexes cover the exact same single column in a way that's useful here, and
      // the unique index below makes the plain one redundant anyway.
      const [[oldIndexCheck]] = await sequelize.query(`
        SELECT COUNT(*) AS cnt FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = 'patient_bills' AND indexname = 'idx_patient_bills_visit_id'
      `);
      if (oldIndexCheck.cnt > 0) {
        await sequelize.query(`DROP INDEX idx_patient_bills_visit_id ON patient_bills`);
      }
      await sequelize.query(`CREATE UNIQUE INDEX uniq_patient_bills_visit_id ON patient_bills(visit_id)`);
      console.log('✅ Added unique index on patient_bills.visit_id (prevents duplicate bills per encounter)');
    }
  } catch (e) {
    console.log('Note: Could not ensure unique index on patient_bills.visit_id:', e.message);
  }
})();

// The patient's current open (not-yet-closed) clinical encounter, if any.
//
// The old standalone `visits` table (and its /clinical/visits/:id/close endpoint) is
// dead — the Clinical.tsx page that created and closed those rows was removed in an
// earlier redesign, and nothing in the current app calls either endpoint any more.
// The live doctor workflow ("Clinical" in the sidebar) is /lis/orders, and its unit of
// encounter is an `lis_test_orders` row: created per visit via POST /lis/orders,
// closed via PUT /lis/orders/:id/close ("Close Visit" in the Visit Summary view,
// reachable by doctor, admin, and reception). That row is what "this visit's bill"
// actually means today, so it's the join used here.
//
// A patient who's only ever billed through pharmacy with no LIS encounter at all
// returns null — callers fall back to the pre-existing "any active bill" behavior in
// that case, so walk-in-only flows aren't affected by this change.
//
// This used to be defined locally here AND reimplemented (differently, and without visit
// scoping at all) in inpatient.js — moved to a shared module so every writer resolves
// "the active bill" identically instead of drifting apart again. See billingResolver.js.
const { getCurrentOpenVisitId, getCurrentOpenVisitIdForBilling, hasAnyVisitHistory, resolveActiveBill, addLineItemsToBill } = require('../utils/billingResolver');

// One-time repair for rows already corrupted by the double-encoding bug (see
// src/server/utils/normalizeServices.js) — re-saves every
// bill's services through normalizeServices() via a raw UPDATE (bypassing Sequelize's
// JSON auto-stringify, so this one JSON.stringify() call is correct, not a bug) so
// existing bills self-heal instead of only fixing new writes going forward.
(async () => {
  try {
    const [rows] = await sequelize.query(`SELECT id, services FROM patient_bills WHERE services IS NOT NULL`);
    let fixed = 0;
    for (const row of rows) {
      const clean = normalizeServices(row.services);
      const cleanJSON = JSON.stringify(clean);
      if (cleanJSON !== JSON.stringify(row.services)) {
        await sequelize.query(`UPDATE patient_bills SET services = :s WHERE id = :id`, {
          replacements: { s: cleanJSON, id: row.id },
        });
        fixed++;
      }
    }
    if (fixed > 0) console.log(`✅ Repaired double/multi-encoded services JSON on ${fixed} patient_bills row(s)`);
  } catch (e) {
    console.log('Note: Could not run patient_bills.services repair migration:', e.message);
  }
})();

// Creates a real lis_test_orders + lis_specimens entry for any lab-test-shaped service
// line items on a bill, so they show up in /lis/collection — not just the legacy
// lab_requests table (kept for whatever else still reads it, e.g. the older clinical lab
// workflow), which /lis/collection's `GET /specimens/pending` never queries at all.
// Requires the bill's patient_id to resolve to a real lis_participants row (the LIS module
// has its own separate patient registry) — if the patient was only ever registered in the
// main `patients` table, there's no participant to attach an order to, so this is skipped.
// Ensures a lab-type charge added directly on a bill (not through the /lis/orders
// screen — e.g. picked from the general service list on the Patients Bill page) still
// reaches the lab's collection queue, since /lis/collection only ever reads from
// lis_specimens, not from bill line items.
//
// This used to unconditionally create a brand-new lis_test_orders + lis_specimens row for
// every matching service on every single bill create/update — with zero dedup check, and
// completely independent of the dedup logic in POST /lis/orders. Confirmed live: billing
// a lab-keyword-matching service (e.g. "Malaria Test") after it had already been ordered
// through /lis/orders for the same visit created a second, phantom specimen and a second,
// phantom lis_test_orders row — and because the phantom order was more recent, it then
// won getCurrentOpenVisitId()'s "most recent open visit" resolution used by every other
// billing writer, causing a *second bill* to be created for the same encounter. That
// silently broke the one-bill-per-visit guarantee on an otherwise ordinary billing action.
//
// Fixed by applying the same visit-scoped dedup rule POST /lis/orders already uses (skip
// creating a specimen if one for this test is already pending_collection within the
// patient's current open visit), and by joining onto that same open visit's order instead
// of always minting a new one — so this function can no longer fork off a rogue "visit".
async function createLisOrderForLabServices(billData, labServices) {
  if (!labServices || labServices.length === 0) return;
  try {
    const [participants] = await sequelize.query(
      `SELECT id FROM lis_participants WHERE id = :pid LIMIT 1`,
      { replacements: { pid: billData.patient_id } }
    );
    if (participants.length === 0) {
      console.log(`Skipping LIS order creation — patient ${billData.patient_id} is not an lis_participants record`);
      return;
    }

    // Matched by test_name, not test_code — this function derives its own code from the
    // service name (e.g. "LIVERPROFI"), which won't match the real catalog code a doctor's
    // /lis/orders submission used (e.g. "LIVERPROF") for the same real-world test. The
    // name is the only identifier both creation paths actually share.
    const dedupedServices = [];
    for (const svc of labServices) {
      const testName = svc.serviceName || svc.name || svc.service_name;
      const [[dup]] = await sequelize.query(
        `SELECT sp.id FROM lis_specimens sp
         JOIN lis_test_orders o ON o.id = sp.order_id
         WHERE o.participant_id = :pid AND o.status != 'closed'
           AND LOWER(sp.test_name) = LOWER(:name) AND sp.status = 'pending_collection'
         LIMIT 1`,
        { replacements: { pid: billData.patient_id, name: testName } }
      );
      if (dup) {
        console.log(`Skipping duplicate LIS specimen for "${testName}" — already pending collection for this visit`);
        continue;
      }
      dedupedServices.push(svc);
    }
    if (dedupedServices.length === 0) return;

    const { getCurrentOpenVisitId } = require('../utils/billingResolver');
    let orderId = await getCurrentOpenVisitId(billData.patient_id, billData.clinic_id);
    if (!orderId) {
      orderId = uuidv4();
      await sequelize.query(
        `INSERT INTO lis_test_orders (id, participant_id, clinic_id, clinic_name, status, branch_id)
         VALUES (:id, :pid, :cid, :cname, 'ordered', :branchId)`,
        { replacements: { id: orderId, pid: billData.patient_id, cid: billData.clinic_id || null, cname: billData.clinic_name || null, branchId: billData.branch_id || null } }
      );
    }

    // Look up each test's REAL catalog code by name first — a specimen stored with a
    // made-up code (the old fallback below) can never be matched back to its lab_tests
    // row by Results Entry (labTests.find(t => t.test_code === specimen.test_code)),
    // which is exactly what left "Loading test schema..." stuck forever for any test
    // added through a bill rather than through /lis/orders. Only genuinely falls back to
    // a generated code for a free-text/manual service with no matching lab_tests entry.
    const testNames = dedupedServices.map(svc => svc.serviceName || svc.name || svc.service_name);
    const [catalogMatches] = await sequelize.query(
      `SELECT test_name, test_code, category FROM lab_tests WHERE LOWER(test_name) IN (:names)`,
      { replacements: { names: testNames.map(n => n.toLowerCase()) } }
    );
    const nameToCode = {};
    const nameToDept = {};
    for (const row of catalogMatches) {
      nameToCode[row.test_name.toLowerCase()] = row.test_code;
      nameToDept[row.test_name.toLowerCase()] = row.category;
    }

    for (const svc of dedupedServices) {
      const testName = svc.serviceName || svc.name || svc.service_name;
      const specimenId = uuidv4();
      const barcode = Math.floor(1000000 + Math.random() * 9000000).toString();
      const code = nameToCode[testName.toLowerCase()]
        || testName.substring(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const department = nameToDept[testName.toLowerCase()] || null;
      await sequelize.query(
        `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, department, status, branch_id)
         VALUES (:id, :oid, :code, :name, :barcode, :department, 'pending_collection', :branchId)`,
        {
          replacements: { id: specimenId, oid: orderId, code, name: testName, barcode, department, branchId: billData.branch_id || null },
        }
      );
    }
    console.log(`Created ${dedupedServices.length} LIS specimen(s) on order ${orderId} for patient ${billData.patient_id}`);
  } catch (error) {
    console.error('Error creating LIS test order from bill:', error);
    // Never block bill creation/update on this — same non-blocking convention as the
    // legacy lab_requests insert this runs alongside.
  }
}

// Non-admin users only resolve scheme/pricing data from their own branch; admins see
// everything. Every scheme/pricing table starts with 100% of its existing rows at
// branch_id NULL (pre-existing shared data becoming isolated for the first time), so
// this is deliberately NULL-inclusive rather than strict-equality — a branch's own rows
// PLUS whatever hasn't been assigned a branch yet — matching reportAuditSummary.js's
// audit_logs precedent and routes/schemes.js's own branchScope(). Named-`:param`-style
// helper, matching this function's own raw SQL convention.
function schemeBranchScope(req, replacements, alias = '') {
  if (!req || (req.user?.role === 'admin' && !req.branchContext?.adminScoped)) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND (${col} = :branchId OR ${col} IS NULL)`;
}

// ── Helper: resolve scheme prices for a patient's bill services ──
// Checks if the patient has an active scheme, then replaces service prices
// with scheme prices where available (including currency).
// Scheme pricing is now opt-in only — the caller must pass the exact schemeId the
// cashier explicitly chose (from a "Cash" vs "Scheme" decision made up front on the
// bill-creation form), instead of this function silently discovering and applying
// whatever scheme membership a patient happens to have. The old implicit-lookup
// behavior meant a cashier picking a plain cash-catalog price could have it silently
// substituted for a completely different amount (and currency) with no warning —
// exactly the "50 USD next to 50000 SSP" confusion this replaces. When no schemeId is
// given, prices are left exactly as provided (cash). When one is given, every line
// must have a configured scheme price or the whole call is rejected — a cashier in
// scheme mode should never be able to silently fall back to a cash price either.
// `req` is the request creating/adding-to the bill (the cashier/user's own branch, NOT
// the scheme row's own branch_id — see schemeBranchScope() above and its callers below).
// Once scheme pricing is branch-isolated, every lookup here is matched against the
// CALLER's branch (NULL-inclusive, so a facility's existing shared scheme/price rows —
// all branch_id NULL until backfilled — keep resolving for every branch through the
// transition instead of suddenly rejecting bill lines that used to price successfully).
// Admin requests (no branch) skip the filter entirely, matching every other branch check
// in this codebase.
async function applySchemePrice(patientId, services, schemeId, req = null) {
  if (!schemeId || !patientId || !services || !Array.isArray(services) || services.length === 0) {
    return { services, schemeId: null, schemeName: null, schemeCurrency: null };
  }

  const schemeReplacements = { sid: schemeId };
  const [schemeRows] = await sequelize.query(
    `SELECT id, scheme_name, currency FROM patient_schemes WHERE id = :sid AND is_active = true${schemeBranchScope(req, schemeReplacements)} LIMIT 1`,
    { replacements: schemeReplacements }
  );
  if (schemeRows.length === 0) {
    const err = new Error('Selected scheme was not found or is inactive');
    err.isSchemeError = true;
    throw err;
  }
  const schemeName = schemeRows[0].scheme_name;
  const schemeCurrency = schemeRows[0].currency;

  // Membership required — scheme pricing is only for patients actually enrolled.
  const memberReplacements = { pid: patientId, sid: schemeId };
  const [memberships] = await sequelize.query(`
    SELECT sm.id FROM scheme_membership sm
    WHERE sm.patient_id = :pid AND sm.scheme_id = :sid AND sm.is_active = true
      AND (sm.effective_to IS NULL OR sm.effective_to >= CURRENT_DATE)${schemeBranchScope(req, memberReplacements, 'sm')}
    LIMIT 1
  `, { replacements: memberReplacements });
  if (memberships.length === 0) {
    const [defaultCheck] = await sequelize.query(
      'SELECT id FROM patients WHERE (id = :pid OR patient_id = :pid) AND default_scheme_id = :sid LIMIT 1',
      { replacements: { pid: patientId, sid: schemeId } }
    );
    if (defaultCheck.length === 0) {
      const err = new Error(`This patient is not an active member of ${schemeName} — scheme pricing is only available for enrolled patients.`);
      err.isSchemeError = true;
      throw err;
    }
  }

  // Fetch active scheme prices for both services and products (drugs/inventory items) —
  // a bill can contain either, and both have their own pricing tables. Branch-specific
  // rows are ordered ahead of shared/NULL-branch ones (then by most recent effective_from
  // within that), so a branch's own explicit price always wins over a legacy shared one
  // for the same service/product when both exist.
  const servicePricingReplacements = { sid: schemeId };
  const [servicePricing] = await sequelize.query(`
    SELECT service_id, scheme_price, scheme_currency
    FROM scheme_service_pricing
    WHERE scheme_id = :sid AND is_active = true
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)${schemeBranchScope(req, servicePricingReplacements)}
    ORDER BY (branch_id IS NOT NULL) DESC, effective_from DESC
  `, { replacements: servicePricingReplacements });
  const productPricingReplacements = { sid: schemeId };
  const [productPricing] = await sequelize.query(`
    SELECT product_id, scheme_price, scheme_currency
    FROM scheme_product_pricing
    WHERE scheme_id = :sid AND is_active = true
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)${schemeBranchScope(req, productPricingReplacements)}
    ORDER BY (branch_id IS NOT NULL) DESC, effective_from DESC
  `, { replacements: productPricingReplacements });

  // The scheme's own currency (patient_schemes.currency, set explicitly when the scheme
  // was created) wins over each pricing row's own scheme_currency column — that column
  // defaults to the base currency whenever the Scheme Management pricing form doesn't
  // send one (which is effectively always), so trusting it first meant a scheme priced
  // entirely in USD kept reporting SSP for every service/product with no currency of its
  // own actually set. Only falls back to the row's column if the scheme itself has none.
  const priceMap = {};
  const baseCurForPricing = await getBaseCurrencyCode();
  for (const sp of servicePricing) {
    if (!priceMap[sp.service_id]) priceMap[sp.service_id] = { price: parseFloat(sp.scheme_price), currency: schemeCurrency || sp.scheme_currency || baseCurForPricing };
  }
  for (const pp of productPricing) {
    if (!priceMap[pp.product_id]) priceMap[pp.product_id] = { price: parseFloat(pp.scheme_price), currency: schemeCurrency || pp.scheme_currency || baseCurForPricing };
  }

  // Name-based fallback match for callers that don't pass an explicit serviceId/service_id
  // (most auto-billing call sites only know the item's display name). Scoped to just the
  // names actually being billed here instead of pulling the whole catalog — with a
  // catalog of hundreds-to-thousands of drugs/services (a real hospital formulary), doing
  // this unconditionally on every single add-to-bill meant transferring and indexing the
  // entire catalog just to look up one or two names.
  const neededNames = [...new Set(
    services.map(svc => (svc.serviceName || svc.name || svc.service_name || '').toLowerCase()).filter(Boolean)
  )];
  const nameToId = {};
  if (neededNames.length > 0) {
    // services is branch-isolated too now — scoped (NULL-inclusive) so a name match can
    // never resolve to a different branch's same-named service (whose id would then miss
    // priceMap, or worse, coincidentally collide with an unrelated shared price row).
    const svcNameReplacements = { names: neededNames };
    const [matchedServices] = await sequelize.query(
      `SELECT id, service_name FROM services WHERE LOWER(service_name) IN (:names)${schemeBranchScope(req, svcNameReplacements)}`,
      { replacements: svcNameReplacements }
    );
    const [matchedProducts] = await sequelize.query(
      'SELECT id, item_name FROM inventory_items WHERE LOWER(item_name) IN (:names)',
      { replacements: { names: neededNames } }
    );
    for (const s of matchedServices) nameToId[s.service_name.toLowerCase()] = s.id;
    for (const p of matchedProducts) if (!nameToId[p.item_name.toLowerCase()]) nameToId[p.item_name.toLowerCase()] = p.id;
  }

  const unpriced = [];
  const updatedServices = services.map(svc => {
    const serviceId = svc.serviceId || svc.service_id;
    const serviceName = (svc.serviceName || svc.name || svc.service_name || '').toLowerCase();

    let matchedId = serviceId && priceMap[serviceId] ? serviceId : null;
    if (!matchedId && serviceName) matchedId = nameToId[serviceName];

    const sp = matchedId ? priceMap[matchedId] : null;
    if (!sp) {
      unpriced.push(svc.serviceName || svc.name || 'this item');
      return svc;
    }

    const qty = svc.quantity || 1;
    return {
      ...svc,
      unitPrice: sp.price,
      unit_price: sp.price,
      price: sp.price * qty,
      totalPrice: sp.price * qty,
      total_price: sp.price * qty,
      currency: sp.currency,
      scheme_name: schemeName,
      original_base_price: svc.unitPrice || svc.unit_price || svc.price || 0
    };
  });

  if (unpriced.length > 0) {
    const err = new Error(`${unpriced.join(', ')} ${unpriced.length > 1 ? 'are' : 'is'} not priced under ${schemeName} — please choose a different item or bill it under Cash.`);
    err.isSchemeError = true;
    throw err;
  }

  return { services: updatedServices, schemeId, schemeName, schemeCurrency: schemeCurrency || (await getBaseCurrencyCode()) };
}

// A bill's services can genuinely span multiple currencies — a patient with an active
// scheme might have some line items priced in that scheme's currency (often USD) while
// other services (not covered by the scheme's price list) stay at their base-currency
// price. Summing raw totalPrice across those without converting would silently add SSP
// and USD figures together as if they were the same unit (this is exactly the bug a
// previous pass at this feature had — e.g. a bill with 50,000 SSP + $25 + $20 ended up
// with total_amount = 50045, mislabeled entirely as "USD"). Bill-level totals are always
// expressed in the base currency (SSP); each line item keeps its own real currency/price
// for transparent per-item display (see BillDetails.tsx). Voided items are always
// excluded, matching the convention already used by the void-item route.
//
// When no exchange rate is configured for a line's currency, this used to fall back to
// adding the raw foreign-currency number straight into the SSP total ("best-effort") —
// that's exactly how a bill ends up reading "50,000 SSP + $50" totalling "50,050": the
// $50 got added as if it were 50 SSP. There is no safe silent fallback for a missing
// exchange rate, so this now throws instead — the bill mutation is rejected with a clear
// message rather than silently producing a wrong total.
async function computeBaseCurrencyTotal(services, clinicId, asOfDate = new Date()) {
  const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
  const baseCurrency = baseCurrencyRow?.code || 'SSP';
  let total = 0;
  for (const s of services) {
    if (s.isVoided) continue;
    const amt = parseFloat(s.totalPrice || s.total_price || s.price || 0) || 0;
    if (amt === 0) continue;
    const cur = s.currency || baseCurrency;
    if (cur === baseCurrency) {
      total += amt;
      continue;
    }
    try {
      const rate = await AccountingService.getExchangeRate(clinicId, cur, baseCurrency, asOfDate);
      total += AccountingService.convertAmount(amt, rate);
    } catch (e) {
      const err = new Error(`No exchange rate configured for ${cur} → ${baseCurrency} — cannot bill "${s.serviceName || s.name || 'this item'}". Add one under Accounting → Exchange Rates first.`);
      err.isExchangeRateError = true;
      throw err;
    }
  }
  return { total: Math.round(total * 100) / 100, baseCurrency };
}

// Get all patient bills for a clinic
router.get('/clinic/:clinicId', authorize('bills.read'), async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { startDate, endDate } = req.query;
    const branchCondition = getBranchCondition(req);
    const branchFilter = branchCondition.branch_id ? `AND pb.branch_id = :branchId` : '';

    let dateFilter = '';
    const replacements = { clinicId: parseInt(clinicId) };
    if (branchCondition.branch_id) replacements.branchId = branchCondition.branch_id;
    if (startDate && endDate) {
      dateFilter = `AND pb.created_at >= :startDate AND pb.created_at <= :endDate`;
      replacements.startDate = `${startDate} 00:00:00`;
      replacements.endDate = `${endDate} 23:59:59`;
    } else if (startDate) {
      dateFilter = `AND pb.created_at >= :startDate`;
      replacements.startDate = `${startDate} 00:00:00`;
    } else if (endDate) {
      dateFilter = `AND pb.created_at <= :endDate`;
      replacements.endDate = `${endDate} 23:59:59`;
    }

    const [bills] = await sequelize.query(`
      SELECT pb.id, pb.bill_number, pb.patient_name, pb.clinic_id, pb.branch_id,
        pb.total_amount, pb.paid_amount, pb.balance_amount, pb.status, pb.bill_date,
        pb.due_date, pb.services, pb.invoice_id, pb.billing_type, pb.scheme_id,
        pb.scheme_name, pb.created_at, pb.updated_at,
        COALESCE(p.patient_id, CAST(pb.patient_id AS CHAR)) as patient_id
      FROM patient_bills pb
      LEFT JOIN patients p ON pb.patient_id = p.id
      WHERE pb.clinic_id = :clinicId ${branchFilter} ${dateFilter}
      ORDER BY pb.created_at DESC
    `, { replacements });

    // Parse services JSON string to array for each bill
    const parsedBills = bills.map(bill => {
      const billData = bill;
      billData.services = normalizeServices(billData.services);
      return billData;
    });

    res.json(parsedBills);
  } catch (error) {
    console.error('Error fetching patient bills:', error);
    res.status(500).json({ error: 'Failed to fetch patient bills' });
  }
});

// Get a specific patient bill by ID
router.get('/:billId', authorize('bills.read'), async (req, res) => {
  try {
    const { billId } = req.params;
    
    const bill = await PatientBill.findByPk(billId);
    
    if (!bill) {
      return res.status(404).json({ error: 'Patient bill not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(bill, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this patient bill' });
    }
    
    // Parse services JSON string to array
    const billData = bill.toJSON();
    billData.services = normalizeServices(billData.services);

    res.json(billData);
  } catch (error) {
    console.error('Error fetching patient bill:', error);
    res.status(500).json({ error: 'Failed to fetch patient bill' });
  }
});

// Create a new patient bill
router.post('/', authorize('bills.write_charge'), async (req, res) => {
  try {
    const billData = req.body;
    console.log('Creating patient bill with data:', JSON.stringify(billData, null, 2));
    
    // Validate required fields
    if (!billData.patient_id) {
      console.log('Validation failed: patient_id is missing');
      return res.status(400).json({ error: 'patient_id is required' });
    }
    if (!billData.patient_name) {
      console.log('Validation failed: patient_name is missing');
      return res.status(400).json({ error: 'patient_name is required' });
    }
    if (!billData.clinic_id) {
      console.log('Validation failed: clinic_id is missing');
      return res.status(400).json({ error: 'clinic_id is required' });
    }
    if (!billData.created_by) {
      console.log('Validation failed: created_by is missing');
      return res.status(400).json({ error: 'created_by is required' });
    }
    
    // Convert patient_id from string (UH-xxxxx) to UUID if needed
    if (billData.patient_id && typeof billData.patient_id === 'string' && billData.patient_id.startsWith('UH-')) {
      console.log('Looking up patient UUID for patient_id:', billData.patient_id);
      const patient = await Patient.findOne({
        where: { patient_id: billData.patient_id }
      });
      if (!patient) {
        return res.status(404).json({ error: `Patient not found with ID: ${billData.patient_id}` });
      }
      console.log('Found patient UUID:', patient.id);
      billData.patient_id = patient.id; // Replace with UUID
    }
    
    // Generate bill number if not provided
    if (!billData.bill_number) {
      const timestamp = Date.now().toString().slice(-6);
      billData.bill_number = `BILL-${new Date().getFullYear()}-${timestamp}`;
    }
    
    // Calculate balance amount
    billData.balance_amount = (billData.total_amount || 0) - (billData.paid_amount || 0);
    
    // Apply scheme prices if patient has a scheme
    // B1: every line gets a stable id here, before scheme pricing/merging/anything
    // else touches it — see ensureLineIds's own docstring for why array position
    // alone is not a safe way to identify "which line" later (void-item, payment).
    let parsedServices = ensureLineIds(normalizeServices(billData.services));

    // Frontend already blocks a typed negative quantity, but that's bypassable
    // via a direct API call — a negative quantity/price produces a negative
    // line total that silently reduces the bill, so reject it server-side too.
    for (const s of parsedServices) {
      const qty = parseFloat(s.quantity ?? 1);
      const total = parseFloat(s.totalPrice ?? s.total_price ?? 0);
      if (qty < 0 || total < 0) {
        return res.status(400).json({ error: `Invalid service line "${s.serviceName || s.name || 'item'}": quantity and price must not be negative` });
      }
    }

    if (parsedServices.length > 0) {
      const result = await applySchemePrice(billData.patient_id, parsedServices, billData.scheme_id, req);
      parsedServices = result.services;
      if (result.schemeId) {
        // A scheme-mode bill is always priced entirely in that scheme's own currency —
        // add-services enforces the same "wholly cash or wholly scheme" rule later, so
        // there's never a mix to convert here. This is what the insurer is actually billed
        // and pays later (via a Credit invoice in this same currency), so converting it to
        // an SSP-equivalent would bill the patient/insurer a number neither agreed to —
        // e.g. an $85 claim has no business becoming "510,000 SSP".
        const schemeCurrency = result.schemeCurrency || (await getBaseCurrencyCode());
        const newTotal = parsedServices.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
        billData.total_amount = newTotal;
        billData.balance_amount = newTotal - (billData.paid_amount || 0);
        billData.bill_currency = schemeCurrency;
        billData.scheme_id = billData.scheme_id || result.schemeId;
        billData.scheme_name = billData.scheme_name || result.schemeName;
        billData.scheme_pricing_applied = true;
      } else {
        // Cash bill — recalculate total in the base currency. See computeBaseCurrencyTotal
        // for why this must never be a raw sum of totalPrice across possibly-mixed currencies.
        const { total: newTotal, baseCurrency } = await computeBaseCurrencyTotal(parsedServices, billData.clinic_id, billData.bill_date || new Date());
        billData.total_amount = newTotal;
        billData.balance_amount = newTotal - (billData.paid_amount || 0);
        // Was hardcoded 'SSP' regardless of the tenant's real configured base
        // currency (e.g. tenant_kuelmc runs USD) — use what was actually just
        // resolved above instead of re-guessing it.
        billData.bill_currency = baseCurrency;
      }
    } else {
      const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
      billData.bill_currency = baseCurrencyRow?.code || 'SSP';
    }

    billData.services = parsedServices;

    // Stamp branch_id from the current user
    billData.branch_id = billData.branch_id || getCreateBranchId(req);

    // Stamp the patient's current open visit, if any, so this bill is scoped to this
    // encounter — see getCurrentOpenVisitIdForBilling() for why this matters (in
    // particular, why it's not plain getCurrentOpenVisitId).
    if (!billData.visit_id) {
      billData.visit_id = await getCurrentOpenVisitIdForBilling(billData.patient_id, billData.clinic_id);
    }

    // due_date drives the whole Receivables/Aging tab (current vs 1-30/31-60/61-90/90+
    // days overdue) — a bill with no due_date always falls into "current" no matter how
    // old it is, so this can't be left unset. Payment-terms billing gets an explicit
    // due date; immediate/point-of-sale bills are due same-day.
    if (!billData.due_date) {
      let dueDays = 0;
      try {
        const [[settings]] = await sequelize.query(
          'SELECT default_due_date_days FROM billing_settings WHERE clinic_id = :cid',
          { replacements: { cid: billData.clinic_id } }
        );
        dueDays = settings?.default_due_date_days ?? 0;
      } catch (e) { /* billing_settings not configured — default to due-on-billing-date */ }
      const dueDate = new Date(billData.bill_date || new Date());
      dueDate.setDate(dueDate.getDate() + dueDays);
      billData.due_date = dueDate.toISOString().split('T')[0];
    }
    
    console.log('Final bill data before creation:', JSON.stringify(billData, null, 2));

    // Guard against duplicate bills for the same encounter. Nothing in this handler
    // previously checked whether an active bill already existed before inserting — a
    // double-click on "Create Bill", or two screens billing the same visit within the
    // same second, both passed validation and both landed a new patient_bills row for
    // the same visit_id. Resolve + lock the active bill the same visit-scoped way every
    // other writer does (see billingResolver.js); if one exists, merge into it instead
    // of creating a second one.
    //
    // The bill row AND its accounting entries are one atomic transaction — a real ACID
    // operation, not "create the bill, then best-effort post the ledger afterward". The
    // old two-step version let a bill commit while its GL posting failed for any reason
    // (a missing chart-of-accounts entry, a transient connection drop), leaving a bill
    // that fully exists with nothing posted for it in the ledger; the income statement
    // then fell short of the cashier's own totals with nothing on screen looking wrong.
    // Now either both the bill and its ledger entry commit, or neither does — a failure
    // here surfaces as this request failing (see the retry below and the route's own
    // catch), not as a silent gap somebody has to notice days later.
    const attemptCreateOrMerge = async () => {
      const createTxn = await sequelize.transaction();
      try {
        const { bill: existingBill } = await resolveActiveBill(billData.patient_id, billData.clinic_id, {
          transaction: createTxn, lock: createTxn.LOCK.UPDATE, visitId: billData.visit_id,
        });

        let result, isNew;
        if (existingBill) {
          const existingServices = ensureLineIds(normalizeServices(existingBill.services));
          const mergedServices = [...existingServices, ...parsedServices];
          const newTotal = parseFloat(existingBill.total_amount) + parseFloat(billData.total_amount || 0);
          const paid = parseFloat(existingBill.paid_amount);
          const newBalance = newTotal - paid;
          await existingBill.update({
            services: mergedServices,
            total_amount: newTotal,
            balance_amount: newBalance,
            status: newBalance <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'pending',
            updated_at: new Date(),
          }, { transaction: createTxn });
          result = existingBill;
          isNew = false;
          console.log('An active bill already existed for this visit — merged into', result.bill_number, 'instead of creating a duplicate');

          // Accounting entries post the bill's total_amount as fresh revenue — only
          // correct for an actual new bill. A merge into an existing bill posts just
          // the newly-merged portion instead, the same way add-services does.
          const mergedTotal = parseFloat(billData.total_amount || 0);
          if (mergedTotal > 0) {
            await AccountingService.createGLTopUpForPatientBill(
              { id: result.id, clinic_id: result.clinic_id, branch_id: result.branch_id, scheme_id: result.scheme_id, bill_number: result.bill_number, patient_name: result.patient_name, bill_currency: billData.bill_currency },
              parsedServices.filter(s => !s.isVoided),
              mergedTotal,
              billData.created_by,
              createTxn,
            );
          }
        } else {
          result = await PatientBill.create(billData, { transaction: createTxn });
          isNew = true;
          console.log('Patient bill created successfully:', result.id);

          await BillingIntegrationService.handleBillCreation(result.toJSON(), billData.created_by, createTxn);
        }
        await createTxn.commit();
        console.log(isNew ? 'Accounting entries created for bill:' : 'Accounting entries topped up for bill:', result.bill_number);
        return { bill: result, wasNewBill: isNew };
      } catch (e) {
        if (!createTxn.finished) await createTxn.rollback().catch(() => {});
        throw e;
      }
    };

    // A failure anywhere inside attemptCreateOrMerge (the bill write, the lock, or the
    // ledger posting) aborts that whole transaction — Postgres cannot resume a
    // transaction after a failed statement, so a retry has to start over from a fresh
    // one, not resume mid-way. Two distinct reasons a fresh attempt can succeed where
    // the first didn't:
    //  - a deadlock/unique-constraint clash from two requests racing to bill the same
    //    not-yet-existing visit (existing behavior, unchanged);
    //  - a transient connection/pool issue (new: previously only the ledger-posting
    //    half of this flow retried transient failures in isolation; now that it's one
    //    transaction, the whole attempt needs to retry together).
    const attemptWithDeadlockRetry = async () => {
      try {
        return await attemptCreateOrMerge();
      } catch (e) {
        if (e.original?.code === 'ER_LOCK_DEADLOCK' || e.name === 'SequelizeUniqueConstraintError' || e.original?.code === 'ER_DUP_ENTRY') {
          return await attemptCreateOrMerge();
        }
        throw e;
      }
    };

    const { bill, wasNewBill } = await BillingIntegrationService.withTransientRetry(
      attemptWithDeadlockRetry, `bill creation/merge for ${billData.patient_name}`
    );

    // Create lab requests if bill contains lab tests
    try {
      await createLabRequestsFromBill(billData, bill);
    } catch (labError) {
      console.error('Error creating lab requests from bill:', labError);
      // Don't fail bill creation if lab request creation fails
    }

    // Create a pending theatre request if the bill contains Procedure-category services
    try {
      await createTheatreRequestsFromBill(billData, bill);
    } catch (theatreError) {
      console.error('Error creating theatre requests from bill:', theatreError);
    }

    // Post Cost of Goods Sold for any billed item that matches the pharmacy/
    // inventory catalog — see pharmacyCogsOnBill.js's own header for why.
    try {
      const { postPharmacyCogsForBill } = require('../utils/pharmacyCogsOnBill');
      const cogsResult = await postPharmacyCogsForBill(sequelize, {
        clinicId: bill.clinic_id, branchId: bill.branch_id, billId: bill.id,
        billDate: bill.bill_date, billNotes: bill.notes,
        services: normalizeServices(bill.services), userId: req.user?.id,
      });
      if (cogsResult.changed) {
        await sequelize.query(`UPDATE patient_bills SET services = :services WHERE id = :id`, {
          replacements: { services: JSON.stringify(cogsResult.services), id: bill.id },
        });
      }
    } catch (cogsError) {
      console.error('Error posting pharmacy COGS from bill:', cogsError);
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: billData.clinic_id, user_id: req.user?.id, user_name: billData.created_by || req.user?.displayName, user_role: req.user?.role,
        module: 'Billing', action: wasNewBill ? 'BILL_CREATED' : 'BILL_SERVICES_ADDED', entity_type: 'PatientBill', entity_id: bill.id,
        description: wasNewBill
          ? `Bill ${bill.bill_number} created for ${billData.patient_name} — ${billData.total_amount} (${parsedServices.length} item${parsedServices.length === 1 ? '' : 's'})`
          : `${parsedServices.length} item${parsedServices.length === 1 ? '' : 's'} added to existing bill ${bill.bill_number} via duplicate create-bill request — new total ${bill.total_amount}`,
        new_values: { bill_number: bill.bill_number, total_amount: bill.total_amount, scheme_id: billData.scheme_id || null },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json(bill);
  } catch (error) {
    if (error.isSchemeError || error.isExchangeRateError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating patient bill:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Error original:', error.original);

    // More detailed error response
    res.status(500).json({
      error: 'Failed to create patient bill',
      details: error.message,
      name: error.name,
      code: error.original?.code || 'UNKNOWN_ERROR',
      sqlMessage: error.original?.sqlMessage || null,
      validationErrors: error.errors ? error.errors.map(e => ({
        field: e.path,
        message: e.message,
        value: e.value
      })) : null
    });
  }
});

// Find active patient bill for a patient in a clinic
router.get('/active/:patientId/:clinicId', authorize('bills.read'), async (req, res) => {
  try {
    const { patientId, clinicId } = req.params;
    const branchWhere = BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' });

    // A bill belongs to one visit. If the patient currently has an open (not yet
    // closed) clinical visit, "the active bill" means specifically the bill tied to
    // THAT visit — not just whatever unpaid bill happens to exist, which used to let a
    // bill from weeks ago keep absorbing charges from a brand-new visit forever. Once
    // a visit is closed, its bill stops being reachable here, so the next time this
    // patient is queued and gets a new visit, billing starts a fresh bill. An active
    // inpatient admission counts as "open" here too (getCurrentOpenVisitIdForBilling),
    // so "View Bills" during a stay always finds the one bill accumulating charges for
    // it, and it stops being found here the moment the patient is discharged.
    const openVisitId = await getCurrentOpenVisitIdForBilling(patientId, clinicId);

    if (openVisitId) {
      const visitBill = await PatientBill.findOne({
        where: {
          patient_id: patientId,
          clinic_id: parseInt(clinicId),
          visit_id: openVisitId,
          ...branchWhere,
          status: { [Op.in]: ['pending', 'partial', 'paid', 'active'] },
        },
        order: [['created_at', 'DESC']],
      });
      if (!visitBill) {
        return res.status(404).json({ error: 'No active bill found for this patient', openVisitId });
      }
      return res.json(visitBill);
    }

    // No open visit right now. If this patient has visit history at all, every one of
    // those visits is closed — there must be no reusable bill (that's the whole point:
    // a closed visit's bill stays closed, the next visit starts fresh).
    if (await hasAnyVisitHistory(patientId)) {
      return res.status(404).json({ error: 'No active bill found for this patient' });
    }

    // Truly never had a visit (pure pharmacy/LIS walk-in with no visit record at all) —
    // fall back to the original patient-wide lookup so those flows are unaffected.
    const activeBill = await PatientBill.findOne({
      where: {
        patient_id: patientId,
        clinic_id: parseInt(clinicId),
        ...branchWhere,
        status: { [Op.in]: ['pending', 'partial', 'paid', 'active'] },
      },
      order: [['created_at', 'DESC']],
    });

    if (!activeBill) {
      return res.status(404).json({ error: 'No active bill found for this patient' });
    }

    res.json(activeBill);
  } catch (error) {
    console.error('Error finding active patient bill:', error);
    res.status(500).json({ error: 'Failed to find active patient bill' });
  }
});

// Add services to an existing bill
router.put('/:billId/add-services', authorize('bills.write_charge'), async (req, res) => {
  let t;
  try {
    const { billId } = req.params;
    const { services } = req.body;

    if (!services || !Array.isArray(services)) {
      return res.status(400).json({ error: 'Services array is required' });
    }

    // Same server-side guard as bill creation — a negative quantity/price
    // bypassing the frontend's check would silently reduce the bill total.
    for (const s of services) {
      const qty = parseFloat(s.quantity ?? 1);
      const total = parseFloat(s.totalPrice ?? s.total_price ?? 0);
      if (qty < 0 || total < 0) {
        return res.status(400).json({ error: `Invalid service line "${s.serviceName || s.name || 'item'}": quantity and price must not be negative` });
      }
    }

    // Resolved before the row lock below is taken — applySchemePrice can run several
    // scheme/catalog queries, and doing that work while already holding LOCK.UPDATE on
    // the bill row serialized every concurrent add-services call against the SAME bill
    // (e.g. a pharmacist adding several drugs to one patient back-to-back) behind however
    // long scheme pricing took to resolve, which is exactly what made rapid-fire adds get
    // progressively slower. scheme_id is fixed for a bill's whole lifetime once set (see
    // the comment below), so reading it here unlocked and re-reading the bill locked
    // afterward for the actual update carries no real race risk.
    const billPeek = await PatientBill.findByPk(billId, { attributes: ['id', 'patient_id', 'scheme_id'] });
    if (!billPeek) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    // B1: give every newly-added line a stable id, same as bill creation.
    const schemeResult = await applySchemePrice(billPeek.patient_id, ensureLineIds(services), billPeek.scheme_id, req);
    let pricedServices = schemeResult.services;

    // Locking the row for the rest of this handler closes the "lost update" race: without
    // it, two add-services calls landing close together (a double-click, or two staff
    // billing the same visit within the same second) both read the same total_amount,
    // both compute their own "new total", and whichever writes last wins — silently
    // discarding the other's line items and total. A concurrent request now blocks on
    // this lock and re-reads the just-committed total once it's this call's turn.
    t = await sequelize.transaction();
    const bill = await PatientBill.findByPk(billId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!bill) {
      await t.rollback();
      return res.status(404).json({ error: 'Bill not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(bill, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      await t.rollback();
      return res.status(403).json({ error: 'Access denied to this patient bill' });
    }

    // Parse existing services. ensureLineIds self-heals a bill created before
    // B1 the moment it's next written to, same as normalizeServices already
    // self-heals the old double-encoding bug on every write.
    const existingServices = ensureLineIds(normalizeServices(bill.services));

    // A bill is either wholly cash or wholly scheme-priced — once created, later
    // additions inherit whatever mode the bill was created under (bill.scheme_id)
    // rather than trusting a fresh value from the request, so a bill can never end
    // up silently mixing cash and scheme line items.

    // If bill is already invoiced, mark new services as explicitly uninvoiced
    const isBillInvoiced = !!(bill.invoice_id || bill.billing_type === 'credit');
    if (isBillInvoiced) {
      pricedServices = pricedServices.map(service => ({
        ...service,
        invoiced: false
      }));
    }

    // Add new services
    const updatedServices = [...existingServices, ...pricedServices];

    // A scheme-mode bill (bill.scheme_id set) is priced entirely in that scheme's own
    // currency — same reasoning as bill creation: it's what the insurer is actually billed
    // via a Credit invoice later, so it must never get converted into an SSP-equivalent.
    // Only a cash bill (no scheme_id) goes through computeBaseCurrencyTotal's conversion.
    let newServicesTotal;
    let cashBillBaseCurrency = null;
    if (bill.scheme_id) {
      newServicesTotal = pricedServices.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
    } else {
      const computed = await computeBaseCurrencyTotal(pricedServices, bill.clinic_id, new Date());
      newServicesTotal = computed.total;
      cashBillBaseCurrency = computed.baseCurrency;
    }
    const newTotalAmount = parseFloat(bill.total_amount) + newServicesTotal;
    const paidAmount = parseFloat(bill.paid_amount);
    const newBalanceAmount = newTotalAmount - paidAmount;

    // Adding services can reopen a bill that was previously fully paid — recompute status
    // instead of leaving a stale 'paid' status on a bill that now has a balance again.
    let newStatus = bill.status;
    if (newBalanceAmount <= 0.01) {
      newStatus = 'paid';
    } else if (paidAmount > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'pending';
    }

    // Update the bill
    const updatePayload = {
      services: updatedServices,
      total_amount: newTotalAmount,
      balance_amount: newBalanceAmount,
      status: newStatus,
      updated_at: new Date()
    };

    if (schemeResult && schemeResult.schemeId) {
      updatePayload.scheme_id = schemeResult.schemeId;
      updatePayload.scheme_name = schemeResult.schemeName;
      updatePayload.scheme_pricing_applied = true;
      // Scheme bills stay in the scheme's own currency throughout — see the total
      // calculation above for why converting this to SSP would be wrong.
      updatePayload.bill_currency = schemeResult.schemeCurrency || (await getBaseCurrencyCode());
    } else {
      // Cash bill — bill-level totals are always in the tenant's real base
      // currency; each line item keeps its own real currency/price for
      // display, see computeBaseCurrencyTotal. Was hardcoded 'SSP' regardless
      // of what that actually is for this tenant — reuse what was just
      // resolved above (cashBillBaseCurrency is only null when bill.scheme_id
      // was set, which this branch excludes, so it's always populated here).
      updatePayload.bill_currency = cashBillBaseCurrency;
    }

    await bill.update(updatePayload, { transaction: t });
    await t.commit();

    // Post the added amount to the GL/receivables — createGLFromPatientBill (used at bill
    // creation) can't be called again here, it would double-count the total already posted.
    // See createGLTopUpForPatientBill for why this
    // was previously skipped entirely (silently under-stating receivables/revenue forever).
    if (newServicesTotal > 0) {
      try {
        await AccountingService.createGLTopUpForPatientBill(
          { id: bill.id, clinic_id: bill.clinic_id, branch_id: bill.branch_id, scheme_id: updatePayload.scheme_id ?? bill.scheme_id, bill_number: bill.bill_number, patient_name: bill.patient_name, bill_currency: updatePayload.bill_currency },
          pricedServices.filter(s => !s.isVoided),
          newServicesTotal,
          req.user?.displayName || req.user?.id,
        );
      } catch (glErr) {
        console.error(`GL top-up posting failed for bill ${bill.bill_number} (added ${newServicesTotal}) — needs manual reconciliation:`, glErr.message);
      }
    }

    // Safety net behind the top-up: a failure above used to leave the bill
    // permanently under-posted with only a log line to show for it. This brings
    // the ledger back in line whether the top-up worked, partly worked, or threw.
    try {
      await AccountingService.syncBillRevenueToGL(bill.id, req.user?.id || 'system');
    } catch (syncErr) {
      console.error(`Bill ${bill.bill_number}: revenue sync after add-services failed —`, syncErr.message);
    }

    // Adding a lab-test service to an *existing* bill previously never created a lab
    // order at all — only bill *creation* did. Fixed by running the same lab-order
    // creation here, scoped to just the newly-added items (not the whole bill) so it
    // doesn't re-create an order for items that were already on the bill.
    try {
      await createLabRequestsFromBill(
        { patient_id: bill.patient_id, patient_name: bill.patient_name, clinic_id: bill.clinic_id, created_by: req.user?.displayName || 'Billing Staff', services: pricedServices },
        bill
      );
    } catch (e) {
      console.error('Error creating lab requests from add-services:', e);
    }

    // Same scoping as the lab hook above — only the newly-added lines, not
    // the whole bill, so re-saving an existing procedure line never creates
    // a second theatre request for it.
    try {
      await createTheatreRequestsFromBill(
        { patient_id: bill.patient_id, patient_name: bill.patient_name, clinic_id: bill.clinic_id, created_by: req.user?.displayName || 'Billing Staff', services: pricedServices },
        bill
      );
    } catch (e) {
      console.error('Error creating theatre requests from add-services:', e);
    }

    // Post Cost of Goods Sold for any billed item that matches the pharmacy/
    // inventory catalog — runs over the bill's FULL current services (not
    // just pricedServices), since already-posted items are skipped instantly
    // (cogsPosted flag check, before any DB lookup) — see
    // pharmacyCogsOnBill.js's own header.
    try {
      const { postPharmacyCogsForBill } = require('../utils/pharmacyCogsOnBill');
      const cogsResult = await postPharmacyCogsForBill(sequelize, {
        clinicId: bill.clinic_id, branchId: bill.branch_id, billId: bill.id,
        billDate: bill.bill_date, billNotes: bill.notes,
        services: normalizeServices(bill.services), userId: req.user?.id,
      });
      if (cogsResult.changed) {
        await sequelize.query(`UPDATE patient_bills SET services = :services WHERE id = :id`, {
          replacements: { services: JSON.stringify(cogsResult.services), id: bill.id },
        });
      }
    } catch (cogsError) {
      console.error('Error posting pharmacy COGS from add-services:', cogsError);
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: bill.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Billing', action: 'BILL_SERVICES_ADDED', entity_type: 'PatientBill', entity_id: billId,
        description: `${pricedServices.length} item${pricedServices.length === 1 ? '' : 's'} added to bill ${bill.bill_number} — new total ${newTotalAmount}`,
        new_values: { added: pricedServices.map(s => ({ name: s.serviceName || s.name, total: s.totalPrice })), new_total: newTotalAmount },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json(bill);
  } catch (error) {
    if (t && !t.finished) await t.rollback().catch(() => {});
    if (error.isSchemeError || error.isExchangeRateError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error adding services to bill:', error);
    res.status(500).json({ error: 'Failed to add services to bill' });
  }
});

// Update a patient bill
//
// Security audit finding: this used to pass req.body to currentBill.update()
// near-verbatim (only branch_id was reset for non-admins). A caller holding
// only bills.financial_action could set paid_amount/status directly with no
// receipt ever created, or silently reassign clinic_id/patient_id/
// patient_name/scheme_id/bill_number/visit_id/invoice_id. No frontend caller
// of this bare PUT /:billId route was found anywhere in src/pages (every
// page that edits a bill goes through add-services/payments/void-item
// instead), so there was no legitimate use case to preserve by widening this
// — paid_amount/status can only ever change through the real /payments
// route (which creates a receipt and posts GL correctly), and the
// patient/clinic/scheme identity of a bill is never meant to change after
// creation.
const PATIENT_BILL_UPDATABLE_FIELDS = ['total_amount', 'services', 'notes'];
router.put('/:billId', authorize('bills.financial_action'), async (req, res) => {
  try {
    const { billId } = req.params;
    const updateData = {};
    for (const field of PATIENT_BILL_UPDATABLE_FIELDS) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }
    // Whatever shape the caller sent services in (raw array, single- or
    // double-stringified from an older client build), always write back a clean array —
    // this is a genuine Sequelize JSON column, so passing it a string causes Sequelize to
    // encode it again on top of whatever encoding it already has.
    if (updateData.services !== undefined) {
      updateData.services = normalizeServices(updateData.services);
    }
    const currentBill = await PatientBill.findByPk(billId);
    if (!currentBill) {
      return res.status(404).json({ error: 'Patient bill not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(currentBill, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this patient bill' });
    }

    // Recompute balance/status from the bill's own paid_amount — paid_amount
    // itself can never be set through this route (see
    // PATIENT_BILL_UPDATABLE_FIELDS above), only through POST /:billId/payments,
    // which creates the matching receipt and GL entry this route does not.
    if (updateData.total_amount !== undefined) {
      const paidAmount = parseFloat(currentBill.paid_amount) || 0;
      updateData.balance_amount = updateData.total_amount - paidAmount;
      if (updateData.balance_amount <= 0) {
        updateData.status = 'paid';
      } else if (paidAmount > 0) {
        updateData.status = 'partial';
      }
    }

    const updatedBill = await currentBill.update(updateData);

    // This endpoint can change total_amount and the service lines outright, and
    // posted nothing — so editing a bill here moved the books out of step with
    // it immediately. Rather than compute a delta at each call site, the ledger
    // is brought back in line with whatever the bill now says it is worth.
    if (updateData.total_amount !== undefined || updateData.services !== undefined) {
      try {
        await AccountingService.syncBillRevenueToGL(billId, req.user?.id || 'system');
      } catch (syncErr) {
        console.error(`Bill ${currentBill.bill_number}: revenue sync after update failed —`, syncErr.message);
      }
    }

    res.json(updatedBill);
  } catch (error) {
    console.error('Error updating patient bill:', error);
    res.status(500).json({ error: 'Failed to update patient bill' });
  }
});

// Void a single line item on a bill — used from the Receipts page to void an
// already-paid item without cancelling the whole receipt/payment. Reduces the
// bill's total_amount only; paid_amount is left untouched, so a voided paid
// item surfaces as a credit/overpayment (negative balance_amount) rather than
// silently fabricating a refund — an actual refund, if owed, is a separate,
// explicit action (see the receipt-level "Cancel Receipt" flow).
router.post('/:billId/void-item', authorize('bills.financial_action'), async (req, res) => {
  try {
    const { billId } = req.params;
    const { serviceIndex, lineId, reason } = req.body;

    if (!lineId && (serviceIndex === undefined || serviceIndex === null || isNaN(parseInt(serviceIndex)))) {
      return res.status(400).json({ error: 'lineId (or serviceIndex) is required' });
    }

    const bill = await PatientBill.findByPk(billId);
    if (!bill) {
      return res.status(404).json({ error: 'Patient bill not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(bill, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this patient bill' });
    }

    // B1: lineId identifies the exact line the user clicked, immune to the
    // array shifting underneath it (another void's splice, a concurrent
    // add-services) between when the page fetched this bill and when this
    // request lands. serviceIndex (array position) is kept only for older
    // frontend builds and bills whose lines predate B1 and have no id yet —
    // ensureLineIds heals those the moment this write happens.
    const services = ensureLineIds(normalizeServices(bill.services));
    const index = lineId ? services.findIndex((s) => s.line_id === lineId) : parseInt(serviceIndex);
    const item = index >= 0 ? services[index] : undefined;
    if (!item) {
      return res.status(404).json({ error: 'Line item not found on this bill' });
    }
    if (item.isVoided) {
      return res.status(400).json({ error: 'This line item is already voided' });
    }

    const wasPaid = !!item.paid;
    if (wasPaid) {
      services[index] = {
        ...item,
        isVoided: true,
        voidedAt: new Date().toISOString(),
        voidedBy: req.user?.displayName || req.user?.email || null,
        voidReason: reason || null,
      };
    } else {
      // If the item wasn't paid yet, completely remove it from the list
      // as it was likely just a mistake.
      services.splice(index, 1);
    }

    const newTotal = services.filter(s => !s.isVoided).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
    let paidAmount = parseFloat(bill.paid_amount) || 0;
    let newBalance = newTotal - paidAmount;
    
    // Auto-adjust paid_amount to prevent negative balance when voiding paid items
    // (Requested by user: "amount goes back to 0 the paid amount please automatically")
    let autoRefundAmount = 0;
    if (newBalance < 0) {
      autoRefundAmount = Math.abs(newBalance);
      paidAmount = newTotal;
      newBalance = 0;
    }

    const newStatus = newBalance <= 0 ? 'paid' : (paidAmount > 0 ? 'partial' : bill.status);

    const updatedBill = await bill.update({
      services,
      total_amount: newTotal,
      paid_amount: paidAmount,
      balance_amount: newBalance,
      status: newStatus,
    });

    if (autoRefundAmount > 0) {
      const receiptNumber = `REF-${Date.now().toString().slice(-8)}`;
      await Receipt.create({
        id: uuidv4(),
        receipt_number: receiptNumber,
        bill_id: billId,
        patient_id: bill.patient_id,
        patient_name: bill.patient_name,
        clinic_id: bill.clinic_id,
        branch_id: bill.branch_id || getCreateBranchId(req),
        total_amount: -autoRefundAmount,
        amount_paid: -autoRefundAmount,
        payment_amount: -autoRefundAmount,
        payment_method: 'cash',
        payment_date: new Date(),
        paid_services: [index],
        notes: `Auto-refund for voided item: ${item.serviceName || item.name || 'Unknown'}`,
        cashier_name: req.user?.displayName || req.user?.email || 'System',
        cashier_id: req.user?.id || null,
        status: 'refunded'
      });
    }

    // Reverse the accounting the item raised.
    //
    // Creating the bill posted Dr Receivable / Cr Revenue for this line. Voiding
    // it removed the line from the bill and dropped the bill's total, but left
    // both of those postings standing, so the income statement kept reporting
    // revenue for an item that had been cancelled and never paid for. That is
    // how a day could show more revenue than the till had billed: one 78,000
    // line voided a minute after it was raised stayed in the accounts.
    //
    // The reversal is the mirror of the original entry. When the item had
    // already been paid and the cash was handed back (autoRefundAmount above),
    // the money leaving is posted too — otherwise the refund would clear a
    // receivable that the reversal has just written off.
    const voidedAmount = parseFloat(item.totalPrice) || 0;
    if (voidedAmount > 0) {
      try {
        const { ChartOfAccounts: COA } = require('../models');
        const { Op: COAOpVoid } = require('sequelize');
        const { resolveRevenueAccountForLine } = require('../utils/resolveRevenueAccount');
        const clinicIdForVoid = bill.clinic_id || 1;

        const revenueAccountId = item.revenue_account_id
          || await resolveRevenueAccountForLine(item, clinicIdForVoid);
        const revenueAccount = revenueAccountId ? await COA.findByPk(revenueAccountId) : null;
        const receivableAccount = await COA.findOne({
          where: { clinic_id: clinicIdForVoid, account_code: bill.scheme_id ? '1210' : '1200', is_active: true },
        }) || await COA.findOne({ where: { clinic_id: clinicIdForVoid, account_code: '1200', is_active: true } });

        if (revenueAccount && receivableAccount) {
          const lineItems = [
            { account_id: revenueAccount.id, debit_amount: voidedAmount, credit_amount: 0,
              description: `Reversal - voided "${item.serviceName || item.name || 'item'}" on ${bill.bill_number}` },
            { account_id: receivableAccount.id, debit_amount: 0, credit_amount: voidedAmount,
              description: `Receivable reversed - voided item on ${bill.bill_number}` },
          ];

          if (autoRefundAmount > 0) {
            const cashAccount = await COA.findOne({
              // Same preference as taking payment: 1100 first.
              where: { clinic_id: clinicIdForVoid, account_code: '1100', is_active: true },
            }) || await COA.findOne({
              where: { clinic_id: clinicIdForVoid, account_type: 'asset', is_active: true, account_name: { [COAOpVoid.iLike]: 'cash' } },
            }) || await COA.findOne({
              where: { clinic_id: clinicIdForVoid, account_type: 'asset', is_active: true, account_name: { [COAOpVoid.iLike]: '%cash%hand%' } },
              order: [['account_code', 'ASC']],
            }) || await COA.findOne({
              where: { clinic_id: clinicIdForVoid, account_type: 'asset', is_active: true, account_name: { [COAOpVoid.iLike]: '%cash%' } },
              order: [['account_code', 'ASC']],
            });
            if (cashAccount) {
              lineItems.push(
                { account_id: receivableAccount.id, debit_amount: autoRefundAmount, credit_amount: 0,
                  description: `Refund of voided item - ${bill.bill_number}` },
                { account_id: cashAccount.id, debit_amount: 0, credit_amount: autoRefundAmount,
                  description: `Cash refunded for voided item - ${bill.bill_number}` },
              );
            } else {
              console.error(`Void on ${bill.bill_number}: refunded ${autoRefundAmount} but no cash account found — cash side not posted.`);
            }
          }

          // C5: post in the bill's own currency, at the ORIGINAL bill's rate —
          // this used to omit transaction_currency entirely, so createGLEntry
          // defaulted to base currency and posted the raw foreign-currency
          // voidedAmount (item.totalPrice is priced in bill_currency, same as
          // every other line on this bill) as if it were that many base-currency
          // units. The original bill-creation entry (AccountingService.
          // createGLFromPatientBill, reference_module 'patient_billing') is the
          // source of truth for what rate was actually used.
          const { GeneralLedger: GLForVoid } = require('../models');
          const originalBillGL = await GLForVoid.findOne({
            where: { clinic_id: clinicIdForVoid, reference_id: billId, reference_module: 'patient_billing' },
            order: [['created_at', 'ASC']],
          });
          const voidCurrency = bill.bill_currency || originalBillGL?.transaction_currency;
          const voidRate = originalBillGL ? parseFloat(originalBillGL.exchange_rate) : undefined;

          const glEntry = await AccountingService.createGLEntry({
            clinic_id: clinicIdForVoid,
            // B7: without this, a voided item's reversal posted with no
            // branch_id at all — a branch-scoped income statement would show
            // the original revenue but never see it reversed.
            branch_id: bill.branch_id || getCreateBranchId(req),
            transaction_date: new Date().toISOString().split('T')[0],
            transaction_type: 'bill_item_void',
            description: `Voided item on ${bill.bill_number}`,
            reference_id: billId,
            reference_module: 'bill_item_void',
            transaction_currency: voidCurrency,
            exchange_rate: voidRate,
          }, lineItems, req.user?.id || 'system');
          await AccountingService.postGLEntry(glEntry.id, req.user?.id || 'system');
        } else {
          console.error(`Void on ${bill.bill_number}: could not reverse ${voidedAmount} — revenue account ${!!revenueAccount}, receivable ${!!receivableAccount}.`);
        }
      } catch (voidGlErr) {
        // Non-fatal: the void itself already succeeded and the bill is correct.
        // Logged loudly because the ledger now needs reconciling.
        console.error(`Void on ${bill.bill_number}: item voided but GL reversal of ${voidedAmount} failed —`, voidGlErr.message);
      }
    }

    // Safety net behind the explicit reversal above: if anything about it was
    // incomplete, this brings the bill and the ledger back into agreement.
    try {
      await AccountingService.syncBillRevenueToGL(billId, req.user?.id || 'system');
    } catch (syncErr) {
      console.error(`Bill ${bill.bill_number}: revenue sync after void failed —`, syncErr.message);
    }

    const billData = updatedBill.toJSON();
    billData.services = services;

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: bill.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Billing', action: 'BILL_ITEM_VOIDED', entity_type: 'PatientBill', entity_id: billId,
        description: `Voided "${item.serviceName || item.name || 'item'}" (${parseFloat(item.totalPrice) || 0}) on bill ${bill.bill_number}${reason ? ` — ${reason}` : ''}`,
        old_values: { serviceName: item.serviceName, totalPrice: item.totalPrice, wasPaid },
        new_values: { isVoided: true, reason: reason || null, autoRefundAmount },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({
      bill: billData,
      voidedAmount: parseFloat(item.totalPrice) || 0,
      resultingCredit: autoRefundAmount,
    });
  } catch (error) {
    console.error('Error voiding bill line item:', error);
    res.status(500).json({ error: 'Failed to void line item' });
  }
});

// Delete a patient bill
router.delete('/:billId', authorize('bills.delete'), async (req, res) => {
  try {
    const { billId } = req.params;
    const bill = await PatientBill.findByPk(billId);
    if (!bill) {
      return res.status(404).json({ error: 'Patient bill not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(bill, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      return res.status(403).json({ error: 'Access denied to this patient bill' });
    }
    
    await bill.destroy();
    
    res.json({ message: 'Patient bill deleted successfully' });
  } catch (error) {
    console.error('Error deleting patient bill:', error);
    res.status(500).json({ error: 'Failed to delete patient bill' });
  }
});

// Add payment to a patient bill
router.post('/:billId/payments', authorize('bills.collect_payment'), async (req, res) => {
  let t;
  try {
    const { billId } = req.params;
    const paymentData = req.body;
    
    console.log('Adding payment to bill:', billId, paymentData);
    console.log('paidServiceIndexes received:', paymentData.paidServiceIndexes);
    console.log('All payment data keys:', Object.keys(paymentData));
    
    // Check for active cashier shift for the current user
    const { CashierShift } = require('../models');
    const userId = req.user?.id;
    
    if (!userId) {
      console.log('Validation failed: No authenticated user');
      return res.status(401).json({ 
        error: 'Authentication required',
        requiresAuth: true
      });
    }
    
    const activeShift = await CashierShift.findOne({
      where: { 
        cashier_id: userId,
        status: 'open' 
      },
      order: [['start_time', 'DESC']]
    });
    
    if (!activeShift) {
      console.log('Validation failed: No active cashier shift for user:', userId);
      return res.status(403).json({ 
        error: 'No active cashier shift found. Please start a cashier shift before making payments.',
        requiresShift: true,
        userId: userId
      });
    }
    
    // Validate required fields
    if (paymentData.amount === undefined || paymentData.amount === null || isNaN(parseFloat(paymentData.amount)) || parseFloat(paymentData.amount) <= 0) {
      console.log('Validation failed: Invalid payment amount:', paymentData.amount);
      return res.status(400).json({ error: 'Valid payment amount is required' });
    }
    if (!paymentData.payment_method) {
      console.log('Validation failed: Missing payment method');
      return res.status(400).json({ error: 'Payment method is required' });
    }
    if (!paymentData.payment_date) {
      console.log('Validation failed: Missing payment date');
      return res.status(400).json({ error: 'Payment date is required' });
    }
    
    // Validate lease details if payment is from lease
    if (paymentData.from_lease && !paymentData.lease_details) {
      console.log('Validation failed: Missing lease details');
      return res.status(400).json({ error: 'Lease details are required when payment is from lease' });
    }
    
    // Locking the row for the rest of this handler closes the same "lost update" race
    // found and fixed in add-services: without it, two payments landing close together
    // (a cashier double-clicking Submit, or two cashiers on the same bill) both read the
    // same paid_amount, both compute their own "new total" in JS, and whichever write
    // lands last silently discards the other's payment — money collected (and receipted)
    // never reflected in the bill's own balance. A concurrent request now blocks on this
    // lock and re-reads the just-committed paid_amount once it's this call's turn.
    t = await sequelize.transaction();
    const currentBill = await PatientBill.findByPk(billId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!currentBill) {
      console.log('Validation failed: Bill not found:', billId);
      await t.rollback();
      return res.status(404).json({ error: 'Patient bill not found' });
    }
    if (!BranchQueryFilter.canAccessRecord(currentBill, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
      await t.rollback();
      return res.status(403).json({ error: 'Access denied to this patient bill' });
    }

    console.log('Current bill balance:', currentBill.balance_amount, 'Payment amount:', paymentData.amount);

    // Sequelize DECIMAL fields (and JSON body values) can arrive as strings — compare numerically,
    // not lexicographically ("9" > "10.00" is true as strings, false as numbers), with a small
    // epsilon to tolerate float rounding when a payment exactly clears the balance.
    const paymentAmountNum = parseFloat(paymentData.amount);
    const balanceAmountNum = parseFloat(currentBill.balance_amount);

    // Validate payment amount doesn't exceed balance
    if (paymentAmountNum > balanceAmountNum + 0.01) {
      console.log('Validation failed: Payment exceeds balance. Balance:', currentBill.balance_amount, 'Payment:', paymentData.amount);
      await t.rollback();
      return res.status(400).json({
        error: 'Payment amount cannot exceed balance due',
        details: {
          paymentAmount: paymentData.amount,
          balanceAmount: currentBill.balance_amount,
          totalAmount: currentBill.total_amount,
          paidAmount: currentBill.paid_amount
        }
      });
    }

    // Receipt id/number generated here (rather than down at receipt-creation time) so a
    // 'deposit' payment can link its patient_deposits usage row to the same receipt it
    // produces, all inside this one transaction.
    const receiptNumber = `RCP-${Date.now().toString().slice(-8)}`;
    const receiptId = uuidv4();

    // Paying with a deposit draws down the patient's prepaid balance instead of collecting
    // fresh cash. adjustDepositBalance() locks the patient's balance row for the rest of
    // this transaction, so a second concurrent deposit-payment for the same patient blocks
    // here until this one commits or rolls back — it can never see a stale balance and
    // overdraw it. Only the clinic (not branch) scopes the balance, per design: a deposit
    // taken at one branch is usable at any branch under the same clinic.
    if ((paymentData.payment_method || '').toLowerCase() === 'deposit') {
      const billCurrency = currentBill.bill_currency || BASE_CURRENCY;
      try {
        await adjustDepositBalance(t, {
          patientId: currentBill.patient_id,
          patientName: currentBill.patient_name,
          clinicId: currentBill.clinic_id,
          branchId: currentBill.branch_id || getCreateBranchId(req),
          currency: billCurrency,
          type: 'usage',
          amount: paymentAmountNum,
          billId,
          receiptId,
          createdBy: req.user?.displayName || req.user?.email,
        });
      } catch (depErr) {
        await t.rollback();
        if (depErr.code === 'INSUFFICIENT_DEPOSIT') {
          return res.status(400).json({ error: `Payment exceeds the patient's available deposit balance (${depErr.available} ${billCurrency}).` });
        }
        throw depErr;
      }
    }

    // Calculate new amounts
    const newPaidAmount = parseFloat(currentBill.paid_amount) + paymentAmountNum;
    const newBalanceAmount = parseFloat(currentBill.total_amount) - newPaidAmount;

    // Determine new status
    let newStatus = currentBill.status;
    if (newBalanceAmount <= 0) {
      newStatus = 'paid';
    } else if (newPaidAmount > 0) {
      newStatus = 'partial';
    }
    
    // Handle service-specific payment tracking. Always write back through
    // normalizeServices() — even when paidServiceIndexes is empty — so every payment
    // self-heals any pre-existing multi-encoded services on this bill instead of just
    // passing the raw (possibly still-corrupted) value straight back through.
    let updatedServices = ensureLineIds(normalizeServices(currentBill.services));

    // B1: paidLineIds/partialLineSplit.lineId identify lines by their stable id
    // rather than array position — the page that built this request fetched the
    // bill, and possibly rendered it, before this handler took the row lock
    // above; if another request voided or added a line on this same bill in
    // that window, "index 3" from that stale fetch may no longer be the line
    // the user actually selected. Resolving by id against updatedServices (read
    // just now, under the lock) and rewriting paymentData in place means every
    // index-based branch below — including the receipt/response building
    // further down — keeps working unchanged, now pointed at the right line
    // regardless of what shifted underneath it. Falls back to whatever index
    // was sent when no id is present (older frontend builds, or a bill whose
    // lines had no id before this request healed them).
    if (paymentData.paidLineIds && paymentData.paidLineIds.length > 0) {
      paymentData.paidServiceIndexes = paymentData.paidLineIds
        .map((id) => updatedServices.findIndex((s) => s.line_id === id))
        .filter((idx) => idx >= 0);
    }
    if (paymentData.partialLineSplit && paymentData.partialLineSplit.lineId) {
      const resolvedIdx = updatedServices.findIndex((s) => s.line_id === paymentData.partialLineSplit.lineId);
      if (resolvedIdx >= 0) paymentData.partialLineSplit.index = resolvedIdx;
    }

    // B8: paidServiceIndexes used to be trusted blindly — every listed index got
    // flipped to paid:true no matter what paymentAmountNum actually was, so a
    // request paying 100 while listing three lines worth 50,000 would mark all
    // three fully settled, permanently misrepresenting what was actually
    // collected against them (the bill's own total_amount/balance_amount stay
    // correct either way, since those come from paymentAmountNum directly, but
    // the per-line paid flags — what the receipt and "still payable" filters
    // read — would be wrong). The frontend already computes this same check
    // before sending (selectedTotal vs amount in BillDetails.tsx/PatientsBill
    // .tsx); this is the server no longer trusting that a client did.
    if (paymentData.paidServiceIndexes && paymentData.paidServiceIndexes.length > 0) {
      let selectedTotal = 0;
      for (const indexStr of paymentData.paidServiceIndexes) {
        const line = updatedServices[parseInt(indexStr, 10)];
        if (!line) {
          await t.rollback();
          return res.status(400).json({ error: `paidServiceIndexes references a line that doesn't exist on this bill (index ${indexStr}).` });
        }
        if (line.isVoided) {
          await t.rollback();
          return res.status(400).json({ error: `Cannot pay "${line.serviceName || line.name || 'a line'}" — it has been voided.` });
        }
        if (line.paid) {
          await t.rollback();
          return res.status(400).json({ error: `"${line.serviceName || line.name || 'A line'}" is already fully paid.` });
        }
        selectedTotal += parseFloat(line.totalPrice) || 0;
      }
      if (paymentAmountNum < selectedTotal - 0.01) {
        await t.rollback();
        return res.status(400).json({
          error: `This payment (${paymentAmountNum}) doesn't cover everything selected (${selectedTotal}). Select fewer items, or pay the full amount for everything checked.`,
        });
      }
    }

    // A payment that only covers part of one specific line (e.g. 20,000 of a 520,000,
    // 26-day bed charge) splits that line into a paid portion sized to what was actually
    // collected + a still-open remainder for the rest — instead of the old behavior of
    // flipping the WHOLE line to "Paid" for whatever amount was entered, which left the
    // table claiming a charge was settled when only a fraction of it had been.
    let splitPaidEntryForReceipt = null;
    if (paymentData.partialLineSplit && paymentData.partialLineSplit.index !== undefined) {
      const idx = parseInt(paymentData.partialLineSplit.index, 10);
      const line = updatedServices[idx];
      if (line && !line.paid && !line.isVoided && !line.invoiced) {
        const lineTotal = parseFloat(line.totalPrice) || 0;
        const unitPrice = parseFloat(line.unitPrice) || 0;
        const qty = parseFloat(line.quantity) || 1;
        const paidAmt = Math.min(parseFloat(paymentData.partialLineSplit.paidAmount) || 0, lineTotal);
        if (paidAmt > 0 && paidAmt < lineTotal - 0.01) {
          const paidQty = unitPrice > 0 ? paidAmt / unitPrice : qty * (paidAmt / lineTotal);
          const remainingQty = qty - paidQty;
          const remainingTotal = parseFloat((lineTotal - paidAmt).toFixed(2));
          const paidLine = { ...line, quantity: parseFloat(paidQty.toFixed(4)), totalPrice: parseFloat(paidAmt.toFixed(2)), status: 'paid', paid: true, paidAt: new Date().toISOString() };
          const openLine = { ...line, quantity: parseFloat(remainingQty.toFixed(4)), totalPrice: remainingTotal };
          updatedServices.splice(idx, 1, paidLine, openLine);
          splitPaidEntryForReceipt = paidLine;
        } else if (paidAmt >= lineTotal - 0.01) {
          updatedServices[idx] = { ...line, status: 'paid', paid: true, paidAt: new Date().toISOString() };
          splitPaidEntryForReceipt = updatedServices[idx];
        }
      }
    } else if (paymentData.paidServiceIndexes && paymentData.paidServiceIndexes.length > 0) {
      try {
        // Mark selected services as paid
        paymentData.paidServiceIndexes.forEach(indexStr => {
          const index = parseInt(indexStr);
          if (updatedServices[index]) {
            updatedServices[index].status = 'paid';
            updatedServices[index].paid = true;
            updatedServices[index].paidAt = new Date().toISOString();
          }
        });
      } catch (error) {
        console.error('Error updating service payment status:', error);
        // Continue with original services if parsing fails
      }
    }

    // Safety net, independent of which branch above ran (or whether none
    // did): if THIS payment brings the bill's balance to zero, every line
    // still collectible in cash must end up marked paid too — otherwise the
    // bill can show Status: paid / Balance: 0 while one line's own Status
    // column still reads Unpaid, with no way to ever pay it off afterward
    // (the balance-exceeds-amount check above rejects any further payment
    // once the aggregate balance is already 0, so that line would be stuck
    // "Unpaid" permanently). Found via a live report: a line added to an
    // already fully-paid bill was settled with a lump, unitemized "Record
    // Payment" for exactly its price — the frontend is supposed to
    // auto-attribute an unitemized payment that covers the whole payable
    // balance to every payable line (BillDetails.tsx's isFullPayment check),
    // but nothing server-side enforced that same invariant, so any caller
    // that doesn't replicate it exactly (an older client, a direct API call,
    // a future bug) can desync the aggregate status from the per-line flags.
    // Excludes voided/invoiced/unbilled-insurance lines, same as the
    // frontend's own isPayableLine — those are never meant to be marked
    // paid by a cash collection. Also excludes anything that isn't a real
    // line-item object — some older bills carry corrupted `services` arrays
    // with stray non-object entries (see normalizeServices.js's own comment
    // on the double-stringify bug that produces these); this must never
    // choke on, or write properties onto, one of those.
    if (newBalanceAmount <= 0.01) {
      for (const line of updatedServices) {
        if (!line || typeof line !== 'object') continue;
        const isUnbilledInsuranceLine = line.schemePrice != null && (parseFloat(line.unitPrice) || 0) === 0;
        if (!line.paid && !line.isVoided && !line.invoiced && !isUnbilledInsuranceLine) {
          line.status = 'paid';
          line.paid = true;
          line.paidAt = new Date().toISOString();
        }
      }
    }

    // Update the bill with new payment amounts and service statuses
    await PatientBill.update({
      paid_amount: newPaidAmount,
      balance_amount: newBalanceAmount,
      status: newStatus,
      services: updatedServices,
      updated_at: new Date()
    }, {
      where: { id: billId },
      transaction: t
    });

    // Get service details for the paid services
    let serviceDetails = [];
    if (splitPaidEntryForReceipt) {
      serviceDetails = [{
        index: parseInt(paymentData.partialLineSplit.index, 10),
        serviceName: splitPaidEntryForReceipt.serviceName || splitPaidEntryForReceipt.name || 'Service',
        quantity: splitPaidEntryForReceipt.quantity,
        unitPrice: splitPaidEntryForReceipt.unitPrice,
        totalPrice: splitPaidEntryForReceipt.totalPrice,
        department: splitPaidEntryForReceipt.department || 'General',
        // Set on the line item at add-time (BillDetails.tsx's Add Item discount
        // control) and stored verbatim in bill.services — was never carried
        // through to the receipt, so a discounted line printed with no sign a
        // discount had been applied at all, just a lower price.
        discountLabel: splitPaidEntryForReceipt.discountLabel || null,
      }];
    } else if (paymentData.paidServiceIndexes && paymentData.paidServiceIndexes.length > 0) {
      try {
        const services = normalizeServices(currentBill.services);

        serviceDetails = paymentData.paidServiceIndexes.map(indexStr => {
          const index = parseInt(indexStr);
          const service = services[index];
          return service ? {
            index: index,
            serviceName: service.serviceName || service.name || service.service_name || 'Unknown Service',
            quantity: service.quantity || 1,
            unitPrice: service.unitPrice || service.unit_price || service.price || 0,
            totalPrice: service.totalPrice || service.total_price || service.price || 0,
            department: service.department || 'General',
            discountLabel: service.discountLabel || null,
          } : null;
        }).filter(Boolean);
      } catch (error) {
        console.error('Error parsing service details for receipt:', error);
      }
    }
    
    const receiptData = {
      id: receiptId,
      receipt_number: receiptNumber,
      bill_id: billId,
      patient_id: currentBill.patient_id,
      patient_name: currentBill.patient_name,
      clinic_id: currentBill.clinic_id,
      branch_id: currentBill.branch_id || getCreateBranchId(req),
      total_amount: paymentData.amount,
      amount_paid: paymentData.amount,
      payment_amount: paymentData.amount,
      payment_method: paymentData.payment_method,
      payment_date: new Date(paymentData.payment_date),
      paid_services: paymentData.partialLineSplit ? [paymentData.partialLineSplit.index] : (paymentData.paidServiceIndexes || []),
      service_details: serviceDetails,
      notes: paymentData.notes,
      from_lease: paymentData.from_lease || false,
      lease_details: paymentData.lease_details,
      // B4: cashier attribution comes from the AUTHENTICATED session (req.user,
      // already verified above against an open CashierShift), never from the
      // request body — a client-supplied cashierId/cashierName let anyone
      // recording a payment attribute it to a different cashier than whoever
      // actually holds the open shift and typed it in, breaking reconciliation
      // and audit trail for the person it was actually attributed to.
      cashier_name: req.user?.displayName || req.user?.email || 'System',
      cashier_id: userId,
      status: 'active'
    };
    
    await Receipt.create(receiptData, { transaction: t });

    // N2: the payment's GL posting now happens BEFORE this commit, in the
    // SAME transaction as the bill update + receipt — it used to run after
    // this commit, in its own separate transaction, fire-and-forget-adjacent
    // and swallowed as "non-fatal" on failure. That is exactly how a payment
    // could be taken with the cashier's screen showing success while nothing
    // reached the ledger (see the comment further down — this happened for
    // real, 150 receipts once). A posting failure now fails the whole
    // payment instead.
    {
      const { ChartOfAccounts } = require('../models');
      const { Op: COAOp } = require('sequelize');
      const payAmt = parseFloat(paymentData.amount || 0);
      if (payAmt > 0) {
        const clinicId = currentBill.clinic_id || 1;
        // B6: post on the payment's OWN date, not the server's "now" — this used
        // to always post as of today regardless of what payment_date the cashier
        // actually entered (a backdated end-of-day reconciliation, or a payment
        // taken just after local midnight when the server's UTC clock still
        // reads the previous day), so the ledger's date disagreed with the
        // receipt's own printed date and could land revenue in the wrong
        // accounting period. payment_date is already validated as required
        // above and is what the receipt itself is dated with (line ~1660).
        const today = String(paymentData.payment_date).split('T')[0];

        // Choose debit account based on payment method
        let debitAccount = null;
        const method = (paymentData.payment_method || 'cash').toLowerCase();
        if (method === 'cash') {
          // iLike, not like.
          //
          // MySQL's LIKE ignores case; PostgreSQL's does not. After the move to
          // Postgres, `like 'cash at hand'` stopped matching the account
          // actually called "Cash at Hand", and so did the `%cash%` fallback.
          // Both lookups returned nothing, debitAccount stayed null, and the
          // whole posting block below was skipped — silently, because it is
          // wrapped in a best-effort try/catch. Every cash payment taken after
          // the cutover cleared no receivable and reached no cash account, so
          // the cashier's screen showed the money while the ledger and every
          // report built on it did not.
          // Cash collections post to 1100 (Cash), not 1105 (Cash at Hand) — a
          // deliberate change from the account this used to prefer. account_code
          // is matched first because it is unambiguous where the by-name match
          // below is not: a clinic can rename "Cash" without this silently
          // drifting back to whatever sorts first.
          debitAccount = await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, account_code: '1100', is_active: true }, transaction: t
          }) || await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [COAOp.iLike]: 'cash' } }, transaction: t
          }) || await ChartOfAccounts.findOne({
            // Falls back toward cash-in-hand, then to sort order, only if there is
            // no account that reads as plain "Cash" at all.
            where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [COAOp.iLike]: '%cash%hand%' } },
            order: [['account_code', 'ASC']], transaction: t
          }) || await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, account_type: 'asset', is_active: true, account_name: { [COAOp.iLike]: '%cash%' } },
            order: [['account_code', 'ASC']], transaction: t
          });
        } else if (method === 'card') {
          debitAccount = await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, is_bank_account: true, is_active: true },
            order: [['account_code', 'ASC']], transaction: t
          });
        } else if (method === 'deposit') {
          // No new cash is coming in right now — it already came in when the deposit was
          // originally taken. Debiting the liability here (instead of a cash/bank asset)
          // reduces "Patient Deposits Held" as this bill's receivable clears, same credit
          // side (1200 AR) as every other payment method below.
          debitAccount = await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, account_code: '2150', is_active: true }, transaction: t
          });
        } else {
          // mobile_money / bank_transfer / insurance — post to main bank or cash
          debitAccount = await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, is_bank_account: true, is_active: true },
            order: [['account_code', 'ASC']], transaction: t
          }) || await ChartOfAccounts.findOne({
            where: { clinic_id: clinicId, account_type: 'asset', is_active: true },
            order: [['account_code', 'ASC']], transaction: t
          });
        }

        // Credit account: clearing the receivable raised at bill creation — 1210 Insurance
        // Receivables for a scheme-priced bill (matches the debit side posted in
        // AccountingService.createGLFromPatientBill), 1200 Accounts Receivable otherwise.
        const receivableCode = currentBill.scheme_id ? '1210' : '1200';
        const creditAccount = await ChartOfAccounts.findOne({
          where: { clinic_id: clinicId, account_code: receivableCode, is_active: true }, transaction: t
        }) || await ChartOfAccounts.findOne({
          where: { clinic_id: clinicId, account_code: '1200', is_active: true }, transaction: t
        }) || await ChartOfAccounts.findOne({
          where: { clinic_id: clinicId, account_type: 'asset', account_name: { [COAOp.iLike]: '%receivable%' }, is_active: true },
          order: [['account_code', 'ASC']], transaction: t
        });

        if (!debitAccount || !creditAccount) {
          // N2: this used to log an audit trail and let the payment through
          // anyway ("non-fatal") — that is exactly how a payment could be
          // taken with the cashier's screen showing success while nothing
          // reached the ledger (this happened for real: 150 receipts once,
          // found only when totals disagreed weeks later). Now it fails the
          // whole payment instead, rolling back the receipt and bill update
          // together with it.
          const missing = [
            !debitAccount && `no account to debit for a ${method} payment`,
            !creditAccount && `no receivable account (${receivableCode}) to credit`,
          ].filter(Boolean).join('; ');
          throw new Error(`Cannot post this payment to the ledger — ${missing}. Set up the missing account in Chart of Accounts first.`);
        }

        // Scheme-priced bills (e.g. insurance schemes billing in USD) carry their
        // own currency on bill_currency — postJournalEntry converts to base
        // currency the same way AccountingService.createGLEntry does, and throws
        // (failing this whole payment, per N2) rather than silently posting 1:1
        // if no exchange rate exists for billCurrency on this date.
        const billCurrency = currentBill.bill_currency || undefined;
        const { code: baseCurrencyCode } = await require('../services/CurrencyService').getBaseCurrency();

        if (billCurrency && billCurrency !== baseCurrencyCode) {
          // C3: the receivable this payment is clearing was booked (at bill
          // creation, in AccountingService.createGLFromPatientBill) at whatever
          // exchange rate applied on the bill date. Cash collected now is almost
          // never converted at that same rate — re-converting payAmt at TODAY's
          // rate and crediting the receivable for that number (what
          // postJournalEntry would do) leaves a residue on 1200/1210 for this
          // bill even once it is fully paid off in bill_currency terms. Instead:
          // clear the receivable for exactly the ORIGINAL booked base-currency
          // share (so it nets to zero), convert the actual cash received at
          // today's rate, and post the difference as a realized FX gain/loss to
          // account 5610 — the same mechanism already used for supplier-bill FX
          // settlement in daily-expenses.js.
          const { GeneralLedger: GLForBooking } = require('../models');
          const originalBillGL = await GLForBooking.findOne({
            where: { clinic_id: clinicId, reference_id: billId, reference_module: 'patient_billing' },
            order: [['created_at', 'ASC']],
            transaction: t,
          });
          if (!originalBillGL || !originalBillGL.exchange_rate) {
            throw new Error(`Cannot post this ${billCurrency} payment — no original billing GL entry with an exchange rate was found for bill ${billId}.`);
          }

          const bookedRate = parseFloat(originalBillGL.exchange_rate);
          const totalBillAmount = parseFloat(currentBill.total_amount) || payAmt;
          const bookedBase = parseFloat(originalBillGL.base_total_debit) || AccountingService.convertAmount(totalBillAmount, bookedRate);
          const bookedShare = totalBillAmount > 0
            ? Math.round(bookedBase * (payAmt / totalBillAmount) * 100) / 100
            : AccountingService.convertAmount(payAmt, bookedRate);

          const todaysRate = await AccountingService.getExchangeRate(clinicId, billCurrency, baseCurrencyCode, today);
          const paymentBaseAmount = AccountingService.convertAmount(payAmt, todaysRate);
          const fxDelta = Math.round((paymentBaseAmount - bookedShare) * 100) / 100; // >0 gain, <0 loss

          const lineItems = [
            { account_id: debitAccount.id, debit_amount: paymentBaseAmount, credit_amount: 0, description: `Payment received (${method}) — ${billCurrency} ${payAmt} @ ${todaysRate}` },
            { account_id: creditAccount.id, debit_amount: 0, credit_amount: bookedShare, description: `Receivable cleared - bill ${billId} (booked @ ${bookedRate})` },
          ];
          if (Math.abs(fxDelta) > 0.01) {
            const fxAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '5610', is_active: true }, transaction: t });
            if (!fxAccount) {
              throw new Error(`Cannot post this payment — a realized FX ${fxDelta > 0 ? 'gain' : 'loss'} of ${Math.abs(fxDelta)} ${baseCurrencyCode} has no home (account 5610, Foreign Exchange Gain/Loss, not found for this clinic). Set it up in Chart of Accounts first.`);
            }
            lineItems.push(fxDelta > 0
              ? { account_id: fxAccount.id, debit_amount: 0, credit_amount: fxDelta, description: `FX gain — bill ${billId} payment` }
              : { account_id: fxAccount.id, debit_amount: -fxDelta, credit_amount: 0, description: `FX loss — bill ${billId} payment` });
          }

          // transaction_currency is intentionally left unset (defaults to base
          // currency, rate 1.0) — every line above is already a base-currency
          // amount, so no further conversion should happen.
          await AccountingService.createGLEntry({
            clinic_id: clinicId,
            branch_id: currentBill.branch_id || getCreateBranchId(req), // B7
            transaction_date: today,
            transaction_type: 'patient_bill_payment',
            description: `Payment: Bill ${billId} (${method})`,
            reference_id: String(billId),
            reference_module: 'patient_bill_payment',
          }, lineItems, userId, t);
        } else {
          await postJournalEntry({
            clinicId, branchId: currentBill.branch_id || getCreateBranchId(req), transaction: t,
            entryDate: today, currency: billCurrency,
            description: `Payment: Bill ${billId} (${method})`,
            narration: `Receipt ${receiptNumber}`,
            reference: `RCP-${receiptId}`,
            // Revenue was already recognized when the bill was created (Dr Receivable /
            // Cr Revenue, in AccountingService.createGLFromPatientBill) — this entry only
            // clears that receivable as cash/bank comes in, it doesn't book new revenue.
            lines: [
              { accountId: debitAccount.id, debit: payAmt, description: `Payment received (${method})` },
              { accountId: creditAccount.id, credit: payAmt, description: `Receivable cleared - bill ${billId}` },
            ],
            userId,
          });
        }
      }
    }

    // Commits the locked bill update + receipt + payment GL entry together,
    // releasing the row lock so the next queued payment (if any) can
    // proceed. Everything after this point (receivables sync, audit log,
    // dispensing) is already-established best-effort/non-blocking side
    // effects that read the now-committed bill state.
    await t.commit();

    const updatedBill = await PatientBill.findByPk(billId);

    console.log('Payment added successfully to bill:', billId);
    console.log('Receipt created:', receiptNumber);

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        clinic_id: updatedBill?.clinic_id, user_id: userId, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Billing', action: 'PAYMENT_RECORDED', entity_type: 'PatientBill', entity_id: billId,
        description: `Payment of ${paymentData.amount} (${paymentData.payment_method}) recorded on bill ${updatedBill?.bill_number} — receipt ${receiptNumber}`,
        new_values: { amount: paymentData.amount, method: paymentData.payment_method, receipt_number: receiptNumber },
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    // Hand over anything this payment has now paid for.

    //

    // A prescription carries no reference to the bill that covers it, so it sat

    // 'pending' after payment until someone opened it and dispensed by hand —

    // which, at a couple of hundred prescriptions, did not happen. Dispensing

    // here closes that gap at the moment the money is taken.

    //

    // Deliberately not fatal and deliberately not silent: the payment is already

    // recorded and must not be undone because a drug was out of stock, but a

    // pharmacist needs to know what was left behind, so skips are logged.

    // Set PHARMACY_AUTO_DISPENSE=off to require the counter to dispense by hand.

    if (String(process.env.PHARMACY_AUTO_DISPENSE || 'on').toLowerCase() !== 'off') {

      try {

        const { dispensePaidFor } = require('../services/autoDispense');

        const outcome = await dispensePaidFor(sequelize, currentBill.patient_id, req.user?.id || null);

        if (outcome.dispensed.length) {

          console.log(`Auto-dispensed ${outcome.dispensed.length} line(s) for ${currentBill.patient_name} after payment on ${currentBill.bill_number}`);

        }

        for (const s of outcome.skipped) {

          console.warn(`Not dispensed for ${currentBill.patient_name} — ${s.drug} (${s.prescription}): ${s.reason}, needed ${s.needed}, stock ${s.stock}`);

        }

      } catch (autoErr) {

        console.error(`Auto-dispense after payment on ${currentBill.bill_number} failed:`, autoErr.message);

      }

    }


    res.json({
      message: 'Payment added successfully',
      bill: updatedBill,
      receipt: {
        id: receiptId,
        receipt_number: receiptNumber,
        amount: paymentData.amount,
        method: paymentData.payment_method,
        date: paymentData.payment_date,
        notes: paymentData.notes,
        from_lease: paymentData.from_lease,
        lease_details: paymentData.lease_details,
        cashier_name: req.user?.displayName || req.user?.email || 'System',
        cashier_id: userId,
        paid_services: paymentData.partialLineSplit ? [paymentData.partialLineSplit.index] : (paymentData.paidServiceIndexes || []),
        service_details: serviceDetails
      }
    });
  } catch (error) {
    if (t && !t.finished) await t.rollback().catch(() => {});
    console.error('Error adding payment:', error);
    console.error('Error details:', error.message);
    res.status(500).json({
      error: 'Failed to add payment',
      details: error.message
    });
  }
});

// Get receipts for a specific bill
router.get('/:billId/receipts', authorize('bills.read'), async (req, res) => {
  try {
    const { billId } = req.params;
    
    const receipts = await Receipt.findAll({
      where: {
        bill_id: billId,
        status: 'active',
        ...BranchQueryFilter.buildBranchWhere(req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })
      },
      order: [['created_at', 'DESC']]
    });

    // Same MariaDB-vs-MySQL JSON auto-parse gap as `services` above — normalize before
    // sending so a `.map()` on paid_services/service_details never crashes downstream.
    res.json(receipts.map(r => {
      const plain = r.toJSON();
      return { ...plain, paid_services: normalizeServices(plain.paid_services), service_details: normalizeServices(plain.service_details) };
    }));
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// Search patient bills
router.get('/search/:clinicId', authorize('bills.read'), async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { q } = req.query; // search query

    const branchCondition = getBranchCondition(req);
    const branchFilter = branchCondition.branch_id ? `AND pb.branch_id = :branchId` : '';
    const searchFilter = q ? `AND (pb.bill_number LIKE :q OR pb.patient_name LIKE :q OR pb.patient_id LIKE :q)` : '';

    const replacements = { clinicId: parseInt(clinicId) };
    if (branchCondition.branch_id) replacements.branchId = branchCondition.branch_id;
    if (q) replacements.q = `%${q}%`;

    const [bills] = await sequelize.query(`
      SELECT pb.id, pb.bill_number, pb.patient_name, pb.clinic_id, pb.branch_id,
        pb.total_amount, pb.paid_amount, pb.balance_amount, pb.status, pb.bill_date,
        pb.due_date, pb.services, pb.invoice_id, pb.billing_type, pb.scheme_id,
        pb.scheme_name, pb.created_at, pb.updated_at,
        COALESCE(p.patient_id, pb.patient_id) as patient_id
      FROM patient_bills pb
      LEFT JOIN patients p ON pb.patient_id = p.id
      WHERE pb.clinic_id = :clinicId ${branchFilter} ${searchFilter}
      ORDER BY pb.created_at DESC
    `, { replacements });

    res.json(bills);
  } catch (error) {
    console.error('Error searching patient bills:', error);
    res.status(500).json({ error: 'Failed to search patient bills' });
  }
});

// Function to create lab requests from bill data
async function createLabRequestsFromBill(billData, bill) {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { sequelize } = require('../models');

    // Parse services from bill
    const services = normalizeServices(billData.services);

    if (services.length === 0) {
      return;
    }

    // A bill line item never carries the catalog service's own category (see
    // BillDetails.tsx — a picked service becomes just {serviceId, serviceName,
    // quantity, unitPrice, totalPrice}), so this used to guess "is this a lab test"
    // purely from whether the display NAME happened to contain one of a fixed list
    // of keywords ('test', 'lab', 'blood', ...) — any real catalog test whose name
    // didn't happen to match (e.g. "Widal", "PCV", "Genotype", "Retroviral
    // Screening" for anything not literally containing "screening") was silently
    // skipped, with nothing surfaced to the user: the bill saved fine, the charge
    // was billed, but no LIS specimen/order ever got created, so it never showed up
    // on /lis/collection — only ordering the same test via /lis/orders (which goes
    // through the real LIS creation path directly) worked. Looking the service up
    // by its actual `category = 'Laboratory'` in the catalog is the real signal;
    // the keyword list is now only a fallback for services with no catalog match
    // (free-text/manual line items with no serviceId at all). Scoped to just the
    // names on THIS bill — pulling the whole Laboratory catalog unconditionally on
    // every single add (product or service, lab-related or not) was real, avoidable
    // work on the hot "add item to bill" path.
    const incomingNames = [...new Set(
      services.map(s => (s.serviceName || s.name || s.service_name || '').toLowerCase()).filter(Boolean)
    )];
    let labServiceNames = new Set();
    if (incomingNames.length > 0) {
      try {
        // A billed line item's name comes straight from lab_tests.test_name (see
        // LISTestOrders.tsx's serviceName: t.test_name) whenever a test was billed via
        // the LIS "Select Services" picker or "Request Another Service" — NOT from the
        // separate `services` billing catalog. Checking only `services` here (as this
        // used to) meant any lab_tests-only test whose name also didn't happen to match
        // the keyword fallback below (e.g. "BFFM", "CBC", "Widal for Entrica") was
        // silently dropped: billed and paid, but no LIS specimen ever created for it, so
        // it never appeared on /lis/collection or in Results Entry. Checking both
        // catalogs is the real fix; the keyword list stays only as a fallback for
        // genuine free-text/manual line items with no catalog match at all.
        const [catalogRows] = await sequelize.query(
          `SELECT service_name FROM services WHERE category = 'Laboratory' AND LOWER(service_name) IN (:names)
           UNION
           SELECT test_name AS service_name FROM lab_tests WHERE LOWER(test_name) IN (:names)`,
          { replacements: { names: incomingNames } }
        );
        labServiceNames = new Set(catalogRows.map(r => (r.service_name || '').toLowerCase()));
      } catch (catalogError) {
        console.error('Could not load Laboratory/lab_tests catalogs for lab-order detection:', catalogError.message);
      }
    }

    const labTestKeywords = [
      'test', 'lab', 'blood', 'urine', 'stool', 'culture', 'screening',
      'analysis', 'examination', 'assay', 'panel', 'profile', 'count',
      'malaria', 'hiv', 'hepatitis', 'glucose', 'cholesterol', 'creatinine',
      'hemoglobin', 'wbc', 'rbc', 'platelet', 'esr', 'bilirubin'
    ];

    const labServices = services.filter(service => {
      const serviceName = (service.serviceName || service.name || service.service_name || '').toLowerCase();
      const inCatalogAsLab = labServiceNames.has(serviceName);
      return inCatalogAsLab || labTestKeywords.some(keyword => serviceName.includes(keyword));
    });

    if (labServices.length === 0) {
      return;
    }

    // Bug: the add-services call site below passes a billData object literal that never
    // included branch_id at all, even though bill.branch_id was sitting right here — every
    // lis_test_orders/lis_specimens row created from adding a lab service to an EXISTING
    // bill landed with branch_id NULL, invisible to any non-admin on /lis/collection (whose
    // query is a strict `AND branch_id = :branchId`, which never matches NULL) while an
    // unscoped admin saw it regardless. The bill-creation call site already sets
    // billData.branch_id itself, so this is a no-op there and only backfills the gap here.
    billData.branch_id = billData.branch_id ?? bill.branch_id ?? null;

    // Real LIS pipeline (feeds /lis/collection) — separate from the legacy lab_requests
    // insert below, which some older pages still read.
    await createLisOrderForLabServices(billData, labServices);

    // Create lab requests for each lab test
    for (const labService of labServices) {
      try {
        const requestId = uuidv4();
        const testName = labService.serviceName || labService.name || labService.service_name;
        
        // Create lab request directly in database
        const insertQuery = `
          INSERT INTO lab_requests (
            id, patient_id, patient_name, clinic_id, test_id, test_name, 
            test_code, requested_by, priority, notes, visit_id, status, requested_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())
        `;
        
        const replacements = [
          requestId,
          billData.patient_id,
          billData.patient_name || 'Unknown Patient',
          billData.clinic_id,
          null, // test_id - will be null for now
          testName,
          testName.substring(0, 3).toUpperCase(), // test_code
          billData.created_by || 'Billing Staff',
          'normal', // priority
          `Lab test requested from patient bill: ${bill.bill_number}`,
          null // visit_id - null since this is from billing
        ];
        
        console.log('Creating lab request from bill:', {
          requestId,
          patient_id: billData.patient_id,
          patient_name: billData.patient_name,
          test_name: testName,
          bill_number: bill.bill_number
        });
        
        await sequelize.query(insertQuery, { replacements });
        console.log(`Lab request created successfully for test: ${testName}`);
        
      } catch (testError) {
        console.error(`Error creating lab request for ${labService.serviceName}:`, testError);
        // Continue with other tests even if one fails
      }
    }
    
    console.log('Finished creating lab requests from bill');
    
  } catch (error) {
    console.error('Error in createLabRequestsFromBill:', error);
    // Don't throw error to avoid failing bill creation
  }
}

// Reverse direction of TheatreService.createRequest: a Procedure-category
// service billed through the NORMAL billing screens (not via
// /theatre/requests) should still surface in Theatre, same way a
// Laboratory-category service billed here already creates a lab order above
// — mirrors createLabRequestsFromBill's structure exactly, but catalog-only
// (no keyword fallback; procedures are catalog-driven by this feature, not a
// legacy free-text concern the way lab names are).
//
// Cannot double-fire for a request created from /theatre/requests itself:
// TheatreService.createRequest bills via billingResolver.js's
// addLineItemsToBill directly against the PatientBill model — it never calls
// either of this file's two routes this function is wired into.
async function createTheatreRequestsFromBill(billData, bill) {
  try {
    const { v4: uuidv4 } = require('uuid');
    const { sequelize } = require('../models');

    const services = normalizeServices(billData.services);
    if (services.length === 0) return;

    const incomingNames = [...new Set(
      services.map(s => (s.serviceName || s.name || s.service_name || '').toLowerCase()).filter(Boolean)
    )];
    if (incomingNames.length === 0) return;

    const [catalogRows] = await sequelize.query(
      `SELECT id, service_name, price FROM services WHERE category = 'Procedure' AND LOWER(service_name) IN (:names)`,
      { replacements: { names: incomingNames } }
    );
    if (catalogRows.length === 0) return;
    const byName = new Map(catalogRows.map(r => [r.service_name.toLowerCase(), r]));

    const procedureServices = services.filter(s =>
      byName.has((s.serviceName || s.name || s.service_name || '').toLowerCase())
    );
    if (procedureServices.length === 0) return;

    for (const svc of procedureServices) {
      try {
        const name = svc.serviceName || svc.name || svc.service_name;
        const catalogRow = byName.get(name.toLowerCase());
        const requestId = uuidv4();
        await sequelize.query(
          `INSERT INTO theatre_requests (id, clinic_id, branch_id, patient_id, requested_by, requesting_department,
             procedure_name, service_id, estimated_fee, fee_currency, bill_id, billed_at, priority, status, notes)
           VALUES (:id, :clinicId, :branchId, :patientId, :requestedBy, 'Billing',
             :procedureName, :serviceId, :estimatedFee, :feeCurrency, :billId, NOW(), 'routine', 'pending', :notes)`,
          {
            replacements: {
              id: requestId, clinicId: billData.clinic_id, branchId: bill.branch_id || null, patientId: billData.patient_id,
              requestedBy: billData.created_by || null, procedureName: name, serviceId: catalogRow.id,
              estimatedFee: parseFloat(svc.totalPrice ?? svc.unitPrice ?? catalogRow.price) || 0, feeCurrency: bill.bill_currency || (await getBaseCurrencyCode()), billId: bill.id,
              notes: `Auto-created from patient bill ${bill.bill_number}`,
            },
          }
        );
        console.log(`Theatre request created from bill for procedure: ${name}`);
      } catch (svcError) {
        console.error(`Error creating theatre request for ${svc.serviceName}:`, svcError);
      }
    }
  } catch (error) {
    console.error('Error in createTheatreRequestsFromBill:', error);
  }
}

module.exports = router;
// Force restart

#!/usr/bin/env node
// Seeds a complete client-demo dataset into the DEMO instance (code "demo",
// schema tenant_demo) THROUGH THE APP'S OWN API, logged in as demo users, so
// every ledger posting, stock movement, receipt and approval happens exactly
// as in real use. Re-runnable: finished steps are recorded in
// scripts/demo/.demo-state.json and skipped; existing records are reused.
//
//   DEMO_ADMIN_EMAIL=demo@nilehc.tech DEMO_ADMIN_PASSWORD=... node scripts/demo/seedClientDemo.mjs [--only=step1,step2]
//
// Everything created carries the tag "DEMO DATA" (in notes/description) so
// scripts/demo/cleanupClientDemo.mjs can find it.
import { api, login, state, save, done, mark, log, step, today, plusDays, TAG, BRANCH_ID, CLINIC_ID } from './lib.mjs';

const ADMIN = process.env.DEMO_ADMIN_EMAIL || 'demo@nilehc.tech';
const ADMIN_PW = process.env.DEMO_ADMIN_PASSWORD;
if (!ADMIN_PW) { console.error('Set DEMO_ADMIN_PASSWORD'); process.exit(1); }
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (s) => !only.length || only.includes(s);

// Demo staff logins. Fictional people; one password pattern so the demo is easy to drive.
export const USERS = [
  { key: 'reception', email: 'reception@intellicare-demo.ss', name: 'Nyandeng Akol', role: 'reception', password: 'Demo#Reception1' },
  { key: 'nurse', email: 'nurse@intellicare-demo.ss', name: 'Rebecca Achan Majok', role: 'nurse', password: 'Demo#Nurse1' },
  { key: 'doctor', email: 'doctor@intellicare-demo.ss', name: 'Dr. James Lado Wani', role: 'doctor', password: 'Demo#Doctor1' },
  { key: 'lab', email: 'lab@intellicare-demo.ss', name: 'Peter Malual Deng', role: 'lab', password: 'Demo#Lab1' },
  { key: 'pharmacy', email: 'pharmacy@intellicare-demo.ss', name: 'Grace Nyibol Kuol', role: 'pharmacy', password: 'Demo#Pharmacy1' },
  { key: 'cashier', email: 'cashier@intellicare-demo.ss', name: 'Mary Ajak Bol', role: 'cashier', password: 'Demo#Cashier1' },
  { key: 'accountant', email: 'accountant@intellicare-demo.ss', name: 'Samuel Taban Loku', role: 'accountant', password: 'Demo#Accounts1' },
  { key: 'procurement', email: 'procurement@intellicare-demo.ss', name: 'John Garang Akuei', role: 'procurement', password: 'Demo#Procure1' },
  { key: 'hr', email: 'hr@intellicare-demo.ss', name: 'Elizabeth Ayen Chol', role: 'hr', password: 'Demo#HR1' },
  { key: 'hod', email: 'hod@intellicare-demo.ss', name: 'Sister Martha Aluel Deng', role: 'nurse', password: 'Demo#HOD1' },
];
export const as = (key) => (key === 'admin' ? ADMIN : USERS.find((u) => u.key === key).email);


/** Adds privileges to a role (keeps what it has) through Setup › Roles. */
async function grantPrivileges(roleKey, keys) {
  const roles = (await api(ADMIN, 'GET', '/roles')).body;
  const role = (Array.isArray(roles) ? roles : roles.data || []).find((r) => r.role_key === roleKey);
  if (!role) throw new Error(`role ${roleKey} not found`);
  const all = (await api(ADMIN, 'GET', '/roles/privileges/all')).body;
  const list = Array.isArray(all) ? all : all.data || all.privileges || [];
  const cur = (await api(ADMIN, 'GET', `/roles/${role.id}/privileges`)).body;
  const curList = Array.isArray(cur) ? cur : cur.data || cur.privileges || [];
  const ids = new Set(curList.map((p) => (typeof p === 'object' ? (p.id ?? p.privilege_id) : p)));
  const add = list.filter((p) => keys.includes(p.privilege_key) && !ids.has(p.id));
  if (!add.length) return 0;
  await api(ADMIN, 'PUT', `/roles/${role.id}/privileges`, { privilege_ids: [...ids, ...add.map((p) => p.id)] });
  log(`role ${roleKey}: + ${add.map((p) => p.privilege_key).join(', ')}`);
  return add.length;
}

// ═════════════════════════════════════════════════════════════════════════
// STEP 1 — setup
// ═════════════════════════════════════════════════════════════════════════
async function step1() {
  step('STEP 1 — setup check');

  // HR Officer role (none exists): HR, attendance, leave, payroll and roster approval.
  if (!state.roleHr) {
    const roles = (await api(ADMIN, 'GET', '/roles')).body;
    let hr = (Array.isArray(roles) ? roles : roles.data || []).find((r) => r.role_key === 'hr');
    if (!hr) hr = (await api(ADMIN, 'POST', '/roles', { role_key: 'hr', name: 'HR Officer', description: `Human resources (${TAG})` })).body;
    const all = (await api(ADMIN, 'GET', '/roles/privileges/all')).body;
    const list = Array.isArray(all) ? all : all.data || all.privileges || [];
    const pick = list.filter((p) => ['hr', 'attendance', 'leave', 'payroll'].includes(p.module) || /^(roster\.|hr\.|leave\.|attendance\.|payroll\.)/.test(p.privilege_key) || ['pages.dashboard.view', 'pages.reports.view'].includes(p.privilege_key));
    await api(ADMIN, 'PUT', `/roles/${hr.id}/privileges`, { privilege_ids: pick.map((p) => p.id) });
    state.roleHr = { id: hr.id, privileges: pick.length }; save();
    log(`role hr (HR Officer): ${pick.length} privileges`);
  }

  // Users: created by the admin (one-time password), then each logs in and sets its demo password.
  const existing = (await api(ADMIN, 'GET', '/users')).body;
  const existingList = Array.isArray(existing) ? existing : existing.users || existing.data || [];
  state.users = state.users || {};
  for (const u of USERS) {
    const found = existingList.find((x) => (x.email || '').toLowerCase() === u.email);
    if (found && state.users[u.key]?.passwordSet) { state.users[u.key].id = found.id; continue; }
    let tempPw = null;
    let id = found?.id;
    if (!found) {
      const r = await api(ADMIN, 'POST', '/users', { email: u.email, displayName: u.name, role: u.role, branch_ids: [BRANCH_ID], createdBy: TAG });
      id = r.body.id || r.body.user?.id;
      tempPw = r.body.temporaryPassword || r.body.tempPassword || r.body.password || r.body.user?.temporaryPassword;
    } else {
      const r = await api(ADMIN, 'POST', `/users/${found.id}/reset-password`, {});
      tempPw = r.body.temporaryPassword || r.body.tempPassword || r.body.password;
    }
    if (!tempPw) throw new Error(`no one-time password returned for ${u.email}`);
    await login(u.email, tempPw);
    await api(u.email, 'POST', '/auth/change-password', { currentPassword: tempPw, newPassword: u.password });
    state.users[u.key] = { id, email: u.email, passwordSet: true }; save();
    log(`user ${u.key}: ${u.email}`);
  }
  for (const u of USERS) await login(u.email, u.password);

  // Departments: OPD, Laboratory, Pharmacy exist; Nursing is added.
  const depts = (await api(ADMIN, 'GET', `/departments?clinic_id=${CLINIC_ID}`)).body;
  const deptList = Array.isArray(depts) ? depts : depts.data || [];
  if (!deptList.some((d) => d.department_name === 'Nursing')) {
    await api(ADMIN, 'POST', '/departments', { department_name: 'Nursing', department_code: 'NUR', description: `Nursing (${TAG})`, clinic_id: CLINIC_ID, is_active: true });
    log('department Nursing added');
  }
  state.departments = { OPD: 'Outpatient Department', Laboratory: 'Laboratory', Pharmacy: 'Pharmacy', Nursing: 'Nursing' }; save();

  // Categories: Drugs posts stock to 1310 Pharmaceutical Inventory, which is switched off —
  // re-saving the category with its accounts switches it on (Setup › Categories behaviour).
  const cats = (await api(ADMIN, 'GET', `/categories?clinic_id=${CLINIC_ID}`)).body;
  const catList = Array.isArray(cats) ? cats : cats.data || [];
  const drugs = catList.find((c) => c.name === 'Drugs' && c.type === 'item');
  if (drugs && !done('drugsCategory')) {
    await api(ADMIN, 'PUT', `/categories/${drugs.id}`, {
      clinic_id: CLINIC_ID, name: drugs.name, type: drugs.type,
      revenue_account_id: drugs.revenue_account_id, cogs_account_id: drugs.cogs_account_id, inventory_account_id: drugs.inventory_account_id,
    });
    mark('drugsCategory'); log('category Drugs re-saved (1310/5210/4120 active)');
  }
  state.categories = Object.fromEntries(catList.filter((c) => ['Consultation', 'Laboratory', 'Drugs', 'Consumables'].includes(c.name)).map((c) => [c.name, { id: c.id, revenue: c.revenue_account_code, cogs: c.cogs_account_code, inventory: c.inventory_account_code }]));
  save();

  // Services
  const svcRes = (await api(ADMIN, 'GET', '/services')).body;
  const services = Array.isArray(svcRes) ? svcRes : svcRes.data || [];
  const svcByName = (n) => services.find((s) => (s.service_name || s.name) === n);
  const consultCat = catList.find((c) => c.name === 'Consultation' && c.type === 'service');
  const labCat = catList.find((c) => c.name === 'Laboratory' && c.type === 'service');
  const ensureService = async (name, category, categoryId, price) => {
    const s = svcByName(name);
    if (s) return s.id;
    const r = await api(ADMIN, 'POST', '/services', { service_name: name, category, category_id: categoryId, price, description: TAG, is_active: true, created_by: TAG });
    log(`service ${name} added`);
    return r.body.id || r.body.data?.id;
  };
  state.services = {
    general: await ensureService('General Consultation', 'Consultation', consultCat?.id, 50000),
    specialist: await ensureService('Specialist Consultation', 'Consultation', consultCat?.id, 80000),
    rdt: await ensureService('Malaria RDT', 'Laboratory', labCat?.id, 15000),
    rbs: await ensureService('Random Blood Sugar', 'Laboratory', labCat?.id, 10000),
  };
  save();

  // Lab tests (with reference ranges). CBC and Urine General (urinalysis) exist; RDT and RBS are added.
  const tests = (await api(ADMIN, 'GET', `/lab-tests?clinic=${CLINIC_ID}`)).body;
  const testList = Array.isArray(tests) ? tests : tests.data || [];
  const testBy = (code) => testList.find((t) => t.test_code === code);
  const ensureTest = async (code, name, category, price, serviceId, components) => {
    const t = testBy(code);
    if (t) return t.id;
    const r = await api(ADMIN, 'POST', '/lab-tests/with-components', {
      test: { test_name: name, test_code: code, category, clinic_id: CLINIC_ID, price, service_id: serviceId, description: TAG, is_active: true },
      components,
    });
    log(`lab test ${name} added`);
    return r.body.id || r.body.test?.id || r.body.data?.id;
  };
  state.labTests = {
    cbc: testBy('CBC')?.id,
    urinalysis: testBy('URINEGEN')?.id,
    rdt: await ensureTest('MRDT', 'Malaria RDT', 'Parasitology', 15000, state.services.rdt,
      [{ component_name: 'Malaria RDT (P. falciparum)', unit: '', reference_range: 'Negative', display_order: 0 }]),
    rbs: await ensureTest('RBS', 'Random Blood Sugar', 'Chemistry', 10000, state.services.rbs,
      [{ component_name: 'Glucose (random)', unit: 'mmol/L', reference_range: '3.9-7.8', display_order: 0 }]),
  };
  save();

  // CIC Insurance: credit allowed, 30-day terms, no co-pay (the insurer pays the whole bill).
  const schemes = (await api(ADMIN, 'GET', `/schemes?clinic_id=${CLINIC_ID}`)).body;
  const schemeList = Array.isArray(schemes) ? schemes : schemes.data || [];
  const cic = schemeList.find((s) => s.scheme_name === 'CIC Insurance');
  if (!cic) throw new Error('CIC Insurance scheme not found');
  state.cic = { id: cic.id, currency: cic.currency }; save();
  if (!done('cicSettings')) {
    await api(ADMIN, 'PUT', `/schemes/${cic.id}`, { is_credit_allowed: true, payment_terms: 'net_30', has_copay: false, default_copay_percentage: 0, credit_limit: 5000 });
    mark('cicSettings'); log('CIC: credit allowed, net 30, no co-pay');
  }

  // CIC price list (USD, the scheme's currency) for the services and tests used in the demo.
  // The scheme price is looked up branch-first, newest first — an existing row for the
  // service on this branch is updated, otherwise a new one is added.
  if (!done('cicServicePrices')) {
    const CIC_PRICES = [
      ['general', 'General Consultation', 7], ['specialist', 'Specialist Consultation', 10],
      [null, 'CBC', 5], ['rdt', 'Malaria RDT', 2.5], ['rbs', 'Random Blood Sugar', 2], [null, 'Urine General', 3],
    ];
    const rows = (await api(ADMIN, 'GET', `/schemes/${cic.id}/service-pricing`)).body;
    const pricing = Array.isArray(rows) ? rows : rows.data || [];
    for (const [key, name, price] of CIC_PRICES) {
      const serviceId = key ? state.services[key] : svcByName(name)?.id;
      if (!serviceId) throw new Error(`service ${name} not found for CIC pricing`);
      const mine = pricing.filter((r) => String(r.service_id) === String(serviceId) && r.is_active !== false && String(r.branch_id) === String(BRANCH_ID));
      if (mine.length) {
        for (const r of mine) await api(ADMIN, 'PUT', `/schemes/${cic.id}/service-pricing/${r.id}`, { scheme_price: price, notes: TAG });
      } else {
        await api(ADMIN, 'POST', `/schemes/${cic.id}/service-pricing`, { clinic_id: CLINIC_ID, service_id: serviceId, scheme_price: price, scheme_currency: cic.currency, effective_from: today(), notes: TAG });
      }
      log(`CIC price ${name}: ${cic.currency} ${price}`);
    }
    mark('cicServicePrices');
  }

  // Main pharmacy store = the default selling store.
  // The tenant's existing stores have no branch, so branch users can't see them; the demo
  // gets its own branch store.
  let locs = (await api(ADMIN, 'GET', `/inventory/locations?clinic_id=${CLINIC_ID}`)).body;
  let pharmacyStore = (Array.isArray(locs) ? locs : []).find((l) => l.location_name === 'Main Pharmacy Store');
  if (!pharmacyStore) {
    await api(ADMIN, 'POST', '/inventory/locations', { location_code: 'PHARM-MAIN', location_name: 'Main Pharmacy Store', location_type: 'pharmacy', address: 'Ground floor, OPD block', capacity_description: TAG });
    locs = (await api(ADMIN, 'GET', `/inventory/locations?clinic_id=${CLINIC_ID}`)).body;
    pharmacyStore = locs.find((l) => l.location_name === 'Main Pharmacy Store');
    log('store Main Pharmacy Store added');
  }
  if (!pharmacyStore) throw new Error('could not create the pharmacy store');
  state.pharmacyStore = { id: pharmacyStore.id, name: pharmacyStore.location_name }; save();
  if (!pharmacyStore.is_default_selling) {
    await api(ADMIN, 'PUT', `/inventory/locations/${pharmacyStore.id}/default-selling`, {});
    log(`default selling store: ${pharmacyStore.location_name}`);
  }

  // Cashier shift with an opening float.
  const cur = await api(as('cashier'), 'GET', '/cashier/current-shift', undefined, { allow: [404] });
  if (cur.ok && (cur.body?.id || cur.body?.shift?.id)) {
    state.cashierShift = { id: cur.body.id || cur.body.shift.id, opening: Number(cur.body.opening_balance ?? cur.body.shift?.opening_balance) };
  } else {
    const r = await api(as('cashier'), 'POST', '/cashier/start-shift', { opening_balance: 50000 });
    state.cashierShift = { id: r.body.id, opening: 50000 };
    log('cashier shift opened with SSP 50,000 float');
  }
  save();

  mark('step1');
  log('step 1 done');
}

// ═════════════════════════════════════════════════════════════════════════
// STEP 2 — procurement cycle (before patients, so the pharmacy has stock)
// ═════════════════════════════════════════════════════════════════════════
// Packs are what stock, cost and selling price count in; prescriptions count doses.
export const ITEMS = [
  { key: 'pcm', code: 'PCM500', name: 'Paracetamol 500mg tablets', cat: 'Drugs', uom: 'Strip', upp: 10, dose: 'tablet', cost: 2000, sell: 5000, qty: 100, cic: 1 },
  { key: 'amx', code: 'AMX500', name: 'Amoxicillin 500mg capsules', cat: 'Drugs', uom: 'Strip', upp: 10, dose: 'capsule', cost: 6000, sell: 12000, qty: 50, cic: 2.5 },
  { key: 'al', code: 'AL20120', name: 'Artemether/Lumefantrine (Coartem) 20/120 tablets', cat: 'Drugs', uom: 'Pack', upp: 24, dose: 'tablet', cost: 9000, sell: 20000, qty: 40, cic: 4 },
  { key: 'rdtkit', code: 'MRDTKIT', name: 'Malaria RDT kits', cat: 'Consumables', uom: 'Each', upp: 1, dose: 'test', cost: 2500, sell: 5000, qty: 200 },
  { key: 'gloves', code: 'GLOVEEX', name: 'Examination gloves (box of 100)', cat: 'Consumables', uom: 'Box', upp: 1, dose: 'box', cost: 15000, sell: 25000, qty: 10 },
  { key: 'syringe', code: 'SYR5ML', name: 'Syringes 5ml (box of 100)', cat: 'Consumables', uom: 'Box', upp: 1, dose: 'box', cost: 20000, sell: 35000, qty: 10 },
];

async function step2() {
  step('STEP 2 — procurement');
  const P = as('procurement');

  // Inventory items (catalogue) — the GRN matches its lines to these by code.
  state.items = state.items || {};
  const itemsRes = (await api(ADMIN, 'GET', `/inventory/items?clinic_id=${CLINIC_ID}`)).body;
  const itemList = Array.isArray(itemsRes) ? itemsRes : itemsRes.items || itemsRes.data || [];
  for (const it of ITEMS) {
    const found = itemList.find((x) => x.item_code === it.code);
    if (found) { state.items[it.key] = found.id; continue; }
    const r = await api(ADMIN, 'POST', '/inventory/items', {
      item_code: it.code, item_name: it.name, item_category: it.cat === 'Drugs' ? 'drugs' : 'consumables', item_type: it.cat === 'Drugs' ? 'drug' : 'consumable',
      category_id: state.categories[it.cat]?.id, unit_of_measure: it.uom, units_per_pack: it.upp, dose_unit_label: it.dose,
      minimum_stock_level: Math.ceil(it.qty / 5), reorder_quantity: it.qty, current_unit_cost: it.cost, selling_price: it.sell, cost_currency: 'SSP',
      requires_batch_tracking: true, requires_expiry_tracking: true, notes: TAG, created_by: TAG,
    });
    state.items[it.key] = r.body.id || r.body.item?.id || r.body.data?.id;
    log(`item ${it.name}`);
  }
  save();

  // Supplier
  if (!state.supplier) {
    const sup = (await api(P, 'GET', `/procurement/suppliers?clinic_id=${CLINIC_ID}`)).body;
    let s = (Array.isArray(sup) ? sup : sup.data || []).find((x) => x.name === 'Juba Medical Supplies Ltd');
    if (!s) {
      s = (await api(P, 'POST', '/procurement/suppliers', {
        name: 'Juba Medical Supplies Ltd', contact_person: 'Michael Lado Kenyi', phone: '+211 922 345 678', email: 'orders@jubamedsupplies.ss',
        address: 'Plot 14, Ministries Road, Hai Malakal', town: 'Juba', country: 'South Sudan', supplier_type: 'medical_supplies',
        payment_terms: '30 days', credit_limit: 20000000, currency: 'SSP',
      })).body;
      log('supplier Juba Medical Supplies Ltd');
    }
    state.supplier = { id: s.id || s.data?.id, name: 'Juba Medical Supplies Ltd' }; save();
  }

  // Purchase requisition from Pharmacy → submit → approve
  if (!state.pr) {
    const r = await api(P, 'POST', '/procurement/purchase-requisitions', {
      requested_by: state.users.procurement.id, department: 'Pharmacy', requisition_type: 'routine', delivery_date_required: plusDays(3),
      currency: 'SSP', notes: `Monthly pharmacy restock — ${TAG}`,
      lines: ITEMS.map((it) => ({ item_code: it.code, item_description: it.name, quantity_required: it.qty, unit_of_measure: it.uom, estimated_unit_price: it.cost })),
    });
    const id = r.body.id || r.body.data?.id;
    await api(P, 'POST', `/procurement/purchase-requisitions/${id}/submit`, {});
    await api(ADMIN, 'POST', `/procurement/purchase-requisitions/${id}/approve`, { approved_by: state.users.procurement.id });
    state.pr = { id, number: r.body.pr_number || r.body.data?.pr_number }; save();
    log(`requisition ${state.pr.number || id} submitted and approved`);
  }

  // Purchase order from the requisition → check → approve → authorize
  if (!state.po) {
    const r = await api(P, 'POST', '/procurement/purchase-orders', {
      supplier_id: state.supplier.id, pr_id: state.pr.id, po_type: 'standard', order_date: today(), expected_delivery_date: plusDays(2),
      delivery_address: state.pharmacyStore.name, currency: 'SSP', notes: TAG, created_by: state.users.procurement.id,
      items: ITEMS.map((it) => ({ item_name: it.name, description: it.code, quantity: it.qty, unit_price: it.cost, unit_of_measure: it.uom })),
    });
    const id = r.body.id || r.body.data?.id;
    state.po = { id, number: r.body.po_number || r.body.data?.po_number }; save();
    log(`purchase order ${state.po.number || id}`);
  }
  if (!done('poApproved')) {
    for (const action of ['check', 'approve', 'authorize']) {
      const po = (await api(ADMIN, 'GET', `/procurement/purchase-orders/${state.po.id}`)).body;
      const want = { check: 'draft', approve: 'check', authorize: 'approved' }[action];
      if (po.status !== want) continue;
      await api(ADMIN, 'POST', `/procurement/purchase-orders/${state.po.id}/status`, { action, user_id: 448, user_name: 'Medical Director (demo)' });
      log(`PO ${action}`);
    }
    mark('poApproved');
  }

  // GRN: receive everything into the pharmacy store with batch numbers and expiry → inspect → accept
  if (!state.grn) {
    const po = (await api(P, 'GET', `/procurement/purchase-orders/${state.po.id}`)).body;
    const lines = (po.items || []).map((pi, i) => {
      const it = ITEMS.find((x) => x.name === pi.item_name);
      return {
        po_line_item_id: pi.id, item_code: it.code, item_description: it.name, quantity_expected: pi.quantity,
        quantity_received: Number(pi.quantity), unit_of_measure: it.uom, item_condition: 'good',
        batch_number: `JMS-${it.code}-${String(2611 + i)}`, expiry_date: plusDays(it.cat === 'Drugs' ? 540 : 900),
        serial_number: '', inspection_status: 'pass', inspection_notes: '',
      };
    });
    const r = await api(P, 'POST', '/procurement/goods-receipt-notes', {
      clinic_id: CLINIC_ID, po_id: Number(state.po.id), received_by: state.users.pharmacy.id,
      received_location: state.pharmacyStore.name, received_condition: 'good', invoice_number: 'JMS-INV-2611', notes: TAG, lines,
    });
    const id = r.body.id || r.body.data?.id;
    state.grn = { id, number: r.body.grn_number || r.body.data?.grn_number }; save();
    log(`GRN ${state.grn.number || id}`);
  }
  if (!done('grnAccepted')) {
    await api(ADMIN, 'POST', `/procurement/goods-receipt-notes/${state.grn.id}/inspect`, { inspected_by: 448, inspection_notes: `All items checked against invoice — ${TAG}`, status: 'inspected' });
    await api(ADMIN, 'POST', `/procurement/goods-receipt-notes/${state.grn.id}/accept`, {});
    mark('grnAccepted'); log('GRN inspected and accepted');
  }

  // Supplier bill: approvals → pay half from the bank
  if (!done('supplierBillApproved')) {
    const titles = ['Pharmacy In-charge', 'Accountant', 'Medical Director'];
    for (const t of titles) {
      await api(ADMIN, 'POST', `/daily-expenses/supplier-bills/${state.po.id}/approve`, { approved_by_title: t, notes: TAG }, { allow: [400] });
    }
    mark('supplierBillApproved'); log('supplier bill approved (3 approvals)');
  }
  if (!state.supplierPayment) {
    await grantPrivileges('accountant', ['supplier_bills.pay', 'expenses.pay']);
    const coa = (await api(as('accountant'), 'GET', `/accounting/chart-of-accounts?clinic_id=${CLINIC_ID}`)).body;
    const bank = coa.find((a) => a.account_code === '1110');
    const total = ITEMS.reduce((t, it) => t + it.cost * it.qty, 0);
    const half = total / 2;
    const r = await api(as('accountant'), 'POST', '/daily-expenses/supplier-bill-payment', {
      clinic_id: CLINIC_ID, po_id: Number(state.po.id), po_number: state.po.number, supplier_name: state.supplier.name,
      payment_date: today(), amount_paid: half, payment_method: 'Bank Transfer', account_id: bank.id, account_name: bank.account_name,
      reference_number: 'EFT-KCB-2611', notes: `Part payment (50%) — ${TAG}`, paid_by: 'Samuel Taban Loku', approved_by: 'Medical Director', created_by: 'Samuel Taban Loku',
    });
    state.supplierPayment = { amount: half, total, id: r.body.id || r.body.payment?.id }; save();
    log(`supplier paid SSP ${half.toLocaleString()} of ${total.toLocaleString()}`);
  }

  // CIC prices for the drugs the insured patient gets
  if (!done('cicDrugPrices')) {
    for (const it of ITEMS.filter((x) => x.cic)) {
      await api(ADMIN, 'POST', `/schemes/${state.cic.id}/product-pricing`, {
        clinic_id: CLINIC_ID, product_id: state.items[it.key], product_type: 'inventory_item', scheme_price: it.cic, scheme_currency: state.cic.currency, effective_from: today(), notes: TAG,
      }, { allow: [400, 409] });
      log(`CIC price ${it.name}: ${state.cic.currency} ${it.cic} per ${it.uom.toLowerCase()}`);
    }
    mark('cicDrugPrices');
  }
  mark('step2');
}

// ═════════════════════════════════════════════════════════════════════════
// STEP 3 — HR: employees, HOD, portal codes, shifts, duty roster, clock-in
// ═════════════════════════════════════════════════════════════════════════
export const EMPLOYEES = [
  { key: 'nurse', user: 'nurse', first: 'Rebecca', last: 'Achan Majok', gender: 'female', dob: '1993-04-12', dept: 'Nursing', title: 'Registered Nurse', phone: '+211 921 456 701', salary: 450000 },
  { key: 'lab', user: 'lab', first: 'Peter', last: 'Malual Deng', gender: 'male', dob: '1990-09-03', dept: 'Laboratory', title: 'Laboratory Technologist', phone: '+211 912 334 562', salary: 480000 },
  { key: 'pharmacist', user: 'pharmacy', first: 'Grace', last: 'Nyibol Kuol', gender: 'female', dob: '1991-01-22', dept: 'Pharmacy', title: 'Pharmacist', phone: '+211 925 778 019', salary: 520000 },
  { key: 'hod', user: 'hod', first: 'Martha', last: 'Aluel Deng', gender: 'female', dob: '1982-06-30', dept: 'Nursing', title: 'Head of Department (Nursing, Laboratory, Pharmacy)', phone: '+211 920 110 245', salary: 750000 },
];

async function step3() {
  step('STEP 3 — HR');
  const HR = as('hr');
  state.employees = state.employees || {};

  // Employees, each linked to their login
  const empRes = (await api(HR, 'GET', '/hr/employees')).body;
  const empList = Array.isArray(empRes) ? empRes : empRes.employees || empRes.data || [];
  for (const e of EMPLOYEES) {
    const found = empList.find((x) => x.first_name === e.first && x.last_name === e.last);
    if (found) { state.employees[e.key] = { id: found.id, number: found.employee_number }; continue; }
    const r = await api(HR, 'POST', '/hr/employees', {
      first_name: e.first, last_name: e.last, gender: e.gender, date_of_birth: e.dob, department: e.dept, job_title: e.title,
      phone: e.phone, email: USERS.find((u) => u.key === e.user).email, hire_date: '2026-01-05', employment_type: 'permanent',
      contract_type: 'permanent', employment_status: 'active', basic_salary: e.salary, salary_currency: 'SSP', pay_frequency: 'monthly',
      branch_id: BRANCH_ID, user_id: state.users[e.user].id, address: 'Juba, Central Equatoria', national_id: `SSD-${e.dob.replace(/-/g, '')}`,
      emergency_contact_name: 'Family contact', emergency_contact_phone: '+211 911 000 111', notes: TAG,
    });
    const emp = r.body.employee || r.body;
    state.employees[e.key] = { id: emp.id, number: emp.employee_number };
    log(`employee ${e.first} ${e.last} (${emp.employee_number}) — ${e.dept}`);
  }
  save();

  // Salary structure
  if (!state.salaryStructure) {
    const r = await api(HR, 'POST', '/hr/salary-structures', { name: 'Clinical staff — standard', description: TAG, basic_salary: 450000, currency: 'SSP', pay_frequency: 'monthly' });
    const id = r.body.id || r.body.structure?.id || r.body.data?.id;
    await api(HR, 'POST', `/hr/salary-structures/${id}/components`, { name: 'Housing allowance', component_type: 'allowance', amount: 60000, is_percentage: false, description: TAG }, { allow: [400] });
    await api(HR, 'POST', `/hr/salary-structures/${id}/components`, { name: 'Transport allowance', component_type: 'allowance', amount: 40000, is_percentage: false, description: TAG }, { allow: [400] });
    await api(HR, 'POST', `/hr/salary-structures/${id}/assign`, { employee_ids: EMPLOYEES.map((e) => state.employees[e.key].id) }, { allow: [400] });
    state.salaryStructure = { id }; save();
    log('salary structure "Clinical staff — standard" assigned');
  }

  // Allowances on the structure, assigned, then each person's own basic salary
  // (assigning a structure sets basic salary to the structure's).
  if (!done('salaryFix')) {
    const sid = state.salaryStructure.id;
    const st = (await api(HR, 'GET', '/hr/salary-structures')).body;
    const mine = (Array.isArray(st) ? st : st.data || st.structures || []).find((x) => String(x.id) === String(sid));
    const comps = mine?.components || [];
    for (const [name, amount] of [['Housing allowance', 60000], ['Transport allowance', 40000]]) {
      if (!comps.some((c) => c.name === name)) await api(HR, 'POST', `/hr/salary-structures/${sid}/components`, { name, component_type: 'allowance', amount, is_percentage: false, description: TAG });
    }
    await api(HR, 'POST', `/hr/salary-structures/${sid}/assign`, { employee_ids: EMPLOYEES.map((e) => state.employees[e.key].id) });
    for (const e of EMPLOYEES) await api(HR, 'PUT', `/hr/employees/${state.employees[e.key].id}`, { basic_salary: e.salary });
    mark('salaryFix'); log('salary structure: housing 60,000 + transport 40,000; basic salaries set per person');
  }

  // HOD: head of Nursing, Laboratory and Pharmacy
  if (!done('hod')) {
    const depts = (await api(ADMIN, 'GET', `/departments?clinic_id=${CLINIC_ID}`)).body;
    for (const name of ['Nursing', 'Laboratory', 'Pharmacy']) {
      const d = (Array.isArray(depts) ? depts : depts.data || []).find((x) => x.department_name === name);
      await api(ADMIN, 'PUT', `/departments/${d.id}`, { department_name: d.department_name, department_code: d.department_code, description: d.description, is_active: true, head_employee_id: state.employees.hod.id });
    }
    mark('hod'); log('HOD Sister Martha Aluel Deng heads Nursing, Laboratory and Pharmacy');
  }

  // Shifts: Morning 08–16, Evening 16–00, Night 00–08 (overnight). Off = a day with no shift.
  if (!state.shifts) {
    const rosterMeta = (await api(ADMIN, 'GET', '/rosters/meta')).body;
    const shifts = rosterMeta.shifts || [];
    const find = (code) => shifts.find((x) => (x.code || '').toUpperCase() === code);
    const out = {};
    for (const [code, name, start, end, color] of [['M', 'Morning', '08:00', '16:00', '#2563EB'], ['E', 'Evening', '16:00', '00:00', '#7C3AED']]) {
      const ex = find(code);
      out[code] = ex ? ex.id : (await api(ADMIN, 'POST', '/rosters/shifts', { name, code, start_time: start, end_time: end, kind: 'work', color })).body.id;
    }
    const night = find('N');
    if (night) {
      await api(ADMIN, 'PUT', `/attendance/shifts/${night.id}`, { name: 'Night', start_time: '00:00', end_time: '08:00', working_days: '0,1,2,3,4,5,6', is_active: true });
      out.N = night.id;
    } else {
      out.N = (await api(ADMIN, 'POST', '/rosters/shifts', { name: 'Night', code: 'N', start_time: '00:00', end_time: '08:00', kind: 'work', color: '#475569' })).body.id;
    }
    state.shifts = out; save();
    log('shifts: Morning M 08:00–16:00, Evening E 16:00–00:00, Night N 00:00–08:00');
  }

  // Duty roster for this month, per department: a realistic rotation; everyone on duty today.
  const period = today().slice(0, 7);
  const [y, m] = period.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const todayN = Number(today().slice(8));
  const ROTATION = ['M', 'M', 'E', 'E', 'N', 'N', null, null];  // two days each, then two off
  const todayShift = { nurse: 'E', lab: 'M', pharmacist: 'E' };
  state.rosters = state.rosters || {};
  for (const [dept, empKey, offset] of [['Nursing', 'nurse', 0], ['Laboratory', 'lab', 3], ['Pharmacy', 'pharmacist', 5]]) {
    if (state.rosters[dept]?.approved) continue;
    const changes = [];
    for (let d = 1; d <= days; d++) {
      let code = ROTATION[(d + offset) % ROTATION.length];
      if (d === todayN) code = todayShift[empKey];
      changes.push({ employee_id: state.employees[empKey].id, duty_date: `${period}-${String(d).padStart(2, '0')}`, shift_id: code ? state.shifts[code] : null });
    }
    if (dept === 'Nursing') {
      // The HOD works weekday mornings.
      for (let d = 1; d <= days; d++) {
        const wd = new Date(y, m - 1, d).getDay();
        changes.push({ employee_id: state.employees.hod.id, duty_date: `${period}-${String(d).padStart(2, '0')}`, shift_id: wd === 0 || wd === 6 ? null : state.shifts.M });
      }
    }
    const base = `/rosters/${encodeURIComponent(dept)}/${period}`;
    await api(as('hod'), 'PUT', `${base}/entries`, { changes, replace: true });
    await api(as('hod'), 'POST', `${base}/submit`, {});
    await api(HR, 'POST', `${base}/approve`, {});
    state.rosters[dept] = { period, approved: true }; save();
    log(`roster ${dept} ${period}: submitted by the HOD, approved by HR`);
  }

  // Staff-portal access codes, and one real clock-in (the nurse, on her Evening shift today).
  state.portal = state.portal || {};
  if (!done('clockIn')) {
    const sites = (await api(ADMIN, 'GET', '/attendance/sites')).body;
    const site = (Array.isArray(sites) ? sites : sites.data || []).find((x) => x.is_active);
    if (site && site.qr_mode === 'printed') {
      const qr = (await api(ADMIN, 'GET', `/attendance/sites/${site.id}/qr`)).body;
      const u = new URL(qr.url);
      const code = (await api(ADMIN, 'POST', `/hr/employees/${state.employees.nurse.id}/portal-access/generate`, {})).body.code;
      const pl = await fetch(`${(await import('./lib.mjs')).API}/employee-portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'demo', employee_number: state.employees.nurse.number, credential: code }) });
      const pj = await pl.json();
      if (!pl.ok) throw new Error(`portal login: ${pj.error}`);
      const ph = { 'Content-Type': 'application/json', Authorization: `Bearer ${pj.token}` };
      const API_ = (await import('./lib.mjs')).API;
      await fetch(`${API_}/employee-portal/auth/set-pin`, { method: 'POST', headers: ph, body: JSON.stringify({ pin: '246810' }) });
      const ck = await fetch(`${API_}/employee-portal/attendance/clock`, { method: 'POST', headers: ph, body: JSON.stringify({
        token: u.searchParams.get('token'), sig: u.searchParams.get('sig'), type: 'in', latitude: Number(site.latitude), longitude: Number(site.longitude), accuracy_m: 12 }) });
      const cj = await ck.json();
      state.clockIn = { site: site.name, ok: ck.ok, result: ck.ok ? 'accepted' : cj.error };
      log(`clock-in (nurse at ${site.name}): ${state.clockIn.result}`);
    } else {
      state.clockIn = { ok: false, result: site ? `site ${site.name} uses a rotating code — clock in live from its display` : 'no attendance site' };
    }
    mark('clockIn'); save();
  }
  // Fresh codes for all three (the nurse's PIN from the clock-in is replaced by a new code).
  if (!done('portalCodes')) {
    for (const k of ['nurse', 'lab', 'pharmacist']) {
      const r = await api(ADMIN, 'POST', `/hr/employees/${state.employees[k].id}/portal-access/generate`, {});
      state.portal[k] = { employee_number: state.employees[k].number, code: r.body.code };
    }
    mark('portalCodes'); save();
    log('portal access codes generated');
  }
  mark('step3');
}

// ═════════════════════════════════════════════════════════════════════════
// Patient-journey helpers (the same calls the LIS / billing / pharmacy screens make)
// ═════════════════════════════════════════════════════════════════════════
const CBC_RESULTS = {
  // A febrile malaria picture: mild anaemia, low platelets, normal white count.
  cash: { WBC: '6.8', 'Lymph#': '1.9', 'Lymph%': '28.0', RBC: '4.10', HGB: '10.8', MCV: '82.0', MCH: '26.3', MCHC: '32.1', 'RDW-CV': '14.2', 'RDW-SD': '42.0',
    HCT: '33.6', PLT: '118', MPV: '9.8', PDW: '16.1', PCT: '0.116', 'P-LCR': '24.0', 'Gran#': '4.4', 'Gran%': '64.0', 'Mid#': '0.5', 'Mid%': '8.0' },
  // A bacterial chest infection picture: raised white count with neutrophilia.
  cic: { WBC: '13.6', 'Lymph#': '2.1', 'Lymph%': '15.4', RBC: '4.52', HGB: '12.6', MCV: '86.0', MCH: '27.9', MCHC: '32.4', 'RDW-CV': '13.1', 'RDW-SD': '41.0',
    HCT: '38.9', PLT: '312', MPV: '8.9', PDW: '15.6', PCT: '0.278', 'P-LCR': '19.0', 'Gran#': '10.6', 'Gran%': '77.9', 'Mid#': '0.9', 'Mid%': '6.7' },
};
const URINALYSIS = {
  Colour: 'Yellow', Appearance: 'Clear', 'Specific gravity': '1.020', pH: '6.0', Protein: 'Negative', Glucose: 'Negative', Ketones: 'Negative',
  Blood: 'Negative', Bilirubin: 'Negative', Urobilinogen: 'Normal', Nitrite: 'Negative', Leukocytes: 'Negative', 'Pus cells': '0-2 /hpf',
  'Red blood cells': '0-1 /hpf', 'Epithelial cells': 'Few', Casts: 'None seen', Crystals: 'None seen',
};

async function labTestCatalog() {
  const r = (await api(as('doctor'), 'GET', `/lab-tests?clinic=${CLINIC_ID}`)).body;
  return Array.isArray(r) ? r : r.data || [];
}

/** The visit (lis_test_orders row) registration opened for this patient today. */
async function visitOrder(participantId) {
  const r = (await api(as('doctor'), 'GET', '/lis/orders')).body;
  const list = (Array.isArray(r) ? r : r.data || []).filter((o) => String(o.participant_id) === String(participantId));
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return list[0];
}

/** POST a line set onto the patient's bill for this billing mode (create the bill if none). */
async function billLines(asUser, patient, lines, { schemeId, notes }) {
  const q = schemeId ? `?scheme_id=${schemeId}` : '?mode=cash';
  const active = await api(asUser, 'GET', `/patient-bills/active/${patient.id}/${CLINIC_ID}${q}`, undefined, { allow: [404] });
  if (active.ok && active.body?.id) {
    const r = await api(asUser, 'PUT', `/patient-bills/${active.body.id}/add-services`, { services: lines });
    return r.body;
  }
  const total = lines.reduce((t, l) => t + (Number(l.totalPrice) || 0), 0);
  const r = await api(asUser, 'POST', '/patient-bills', {
    bill_number: `BILL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`, patient_id: patient.id, patient_name: patient.name,
    clinic_id: CLINIC_ID, total_amount: total, paid_amount: 0, balance_amount: total, status: 'pending', bill_date: new Date().toISOString(),
    due_date: null, services: lines, notes: `${notes} — ${TAG}`, created_by: USERS.find((u) => u.email === asUser)?.name || 'System',
    ...(schemeId ? { scheme_id: schemeId } : {}),
  });
  return r.body;
}

/** Cashier takes payment of everything still unpaid on a bill. */
async function payAll(billId, method = 'cash', note = '') {
  const bill = (await api(as('cashier'), 'GET', `/patient-bills/${billId}`)).body;
  const lines = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services || [];
  const idx = lines.map((l, i) => (!l.paid && !l.isVoided ? i : -1)).filter((i) => i >= 0);
  const amount = Number(bill.balance_amount);
  if (amount <= 0) return null;
  const r = await api(as('cashier'), 'POST', `/patient-bills/${billId}/payments`, {
    amount, payment_method: method, payment_date: today(), notes: note || TAG, cashierName: 'Mary Ajak Bol', cashierId: state.users.cashier.id,
    paidServiceIndexes: idx, paidLineIds: idx.map((i) => lines[i].line_id).filter(Boolean),
  });
  return { amount, receipt: r.body.receipt?.receipt_number, billNumber: bill.bill_number };
}

/** Lab: collect every pending specimen of this visit, enter all results, approve them. */
async function runLab(orderId, resultsByCode) {
  const pend = (await api(as('lab'), 'GET', '/lis/specimens/pending')).body;
  const specs = (Array.isArray(pend) ? pend : pend.data || []).filter((sp) => String(sp.order_id) === String(orderId));
  const catalog = await labTestCatalog();
  const done_ = [];
  for (const sp of specs) {
    if (sp.status === 'pending_collection') await api(as('lab'), 'POST', `/lis/specimens/${sp.id}/collect`, { collected_by: state.users.lab.id });
    const test = catalog.find((t) => t.test_code === sp.test_code);
    const values = resultsByCode[sp.test_code] || {};
    const comps = (test?.components || []);
    const results = comps.map((c) => ({ analyte: c.name || c.component_name, value: values[c.name || c.component_name] ?? '', unit: c.unit || '' }))
      .filter((r) => r.value !== '');
    if (results.length !== comps.length) throw new Error(`${sp.test_code}: ${comps.length - results.length} result(s) missing a value`);
    await api(as('lab'), 'POST', `/lis/specimens/${sp.id}/results`, { results, test_code: sp.test_code, comment: `Results verified — ${TAG}` });
    done_.push(sp.id);
  }
  // Manager review: approve every result of these specimens
  const pr = (await api(ADMIN, 'GET', '/lis/results/pending-review')).body;
  const rows = (Array.isArray(pr) ? pr : pr.data || []).filter((r) => done_.includes(r.specimen_id));
  const ids = rows.flatMap((r) => r.ids || r.result_ids || [r.id]).filter(Boolean);
  if (ids.length) await api(ADMIN, 'POST', '/lis/results/batch-review', { ids, action: 'approved', manager_notes: `Reviewed and approved — ${TAG}`, manager_id: 448 });
  return { specimens: done_.length, results: ids.length };
}

// ═════════════════════════════════════════════════════════════════════════
// STEP 4 — Patient 1: cash patient, full journey
// ═════════════════════════════════════════════════════════════════════════
/**
 * Lab tests are per-branch (non-admins see only their branch's). The catalogue's CBC and
 * Urine General carry no branch, so Gudele staff can't order them: give Gudele its own
 * copies (same components, same linked service, so the CIC prices still apply).
 */
async function branchLabTests() {
  const mine = await labTestCatalog();
  const all = (await api(ADMIN, 'GET', `/lab-tests?clinic=${CLINIC_ID}`, undefined, { branch: null })).body;
  for (const code of ['CBC', 'URINEGEN']) {
    if (mine.find((t) => t.test_code === code)) continue;
    const src = (Array.isArray(all) ? all : all.data || []).find((t) => t.test_code === code && !t.branch_id);
    if (!src) throw new Error(`no shared ${code} test to copy`);
    const r = await api(ADMIN, 'POST', '/lab-tests/with-components', {
      test: { test_name: src.test_name, test_code: code, category: src.category, clinic_id: CLINIC_ID, price: Number(src.price), service_id: src.service_id, description: TAG, is_active: true },
      components: (src.components || []).map((c, i) => ({ component_name: c.name || c.component_name, unit: c.unit || '', reference_range: c.reference_range || '', display_order: c.display_order ?? i })),
    });
    state.labTests = { ...(state.labTests || {}), [`${code}_gudele`]: r.body.id || r.body.test?.id || r.body.data?.id }; save();
    log(`lab test ${src.test_name} made available at Gudele (${(src.components || []).length} components)`);
  }
}

async function step4() {
  step('STEP 4 — cash patient');
  await branchLabTests();
  // The app's default puts bills.write_charge on doctors (lab orders bill as they're placed); this tenant's Doctor role lacked it.
  if (!done('doctorCharge')) { await grantPrivileges('doctor', ['bills.write_charge']); mark('doctorCharge'); log('Doctor role: + bills.write_charge'); }
  const P = state.p1 = state.p1 || {};
  const clinics = (await api(as('reception'), 'GET', '/clinics')).body;
  const gp = (Array.isArray(clinics) ? clinics : clinics.data || []).find((c) => c.name === 'General Practitioner');

  // 1. Register and queue to OPD (General Practitioner), consultation billed
  if (!P.id) {
    const r = await api(as('reception'), 'POST', '/lis/participants', {
      first_name: 'Deng', last_name: 'Garang Mabior', gender: 'male', date_of_birth: '1992-03-14', phone: '+211 921 334 455',
      residence: 'Hai Malakal, Juba', study_ref: TAG, doctor_id: state.users.doctor.id, clinic_id: gp.id, clinic_name: gp.name, room_number: '',
      demographics: { scheme_id: '', scheme_name: 'Cash' },
    });
    Object.assign(P, { id: r.body.id, number: r.body.participant_number, queue: r.body.queue_number, name: 'Deng Garang Mabior' }); save();
    const svc = (await api(as('reception'), 'GET', `/services/${gp.service}`)).body;
    const price = Number(svc.price) || 0;
    const bill = await billLines(as('reception'), P, [{ serviceId: svc.id, serviceName: svc.service_name || svc.name, quantity: 1, unitPrice: price, totalPrice: price }], { notes: 'Auto-generated on queueing to General Practitioner' });
    P.billId = bill.id; P.billNumber = bill.bill_number; save();
    log(`registered ${P.name} (${P.number}), queue #${P.queue}, consultation on ${P.billNumber}`);
  }
  if (!P.orderId) { P.orderId = (await visitOrder(P.id))?.id; save(); }

  // 2. Triage
  if (!done('p1Triage')) {
    await api(as('nurse'), 'PUT', `/lis/orders/${P.orderId}/triage`, { vitals: {
      blood_pressure: '128/82', pulse: '104', temperature: '38.6', respiratory_rate: '22', weight: '72', height: '176', spo2: '97', fasting_status: 'No', allergies: 'No known drug allergies' } });
    mark('p1Triage'); log('triage: BP 128/82, pulse 104, T 38.6°C, SpO2 97%');
  }

  // 3. Doctor: history, examination, provisional diagnosis; orders Malaria RDT + CBC
  if (!done('p1Order')) {
    await api(as('doctor'), 'PUT', `/lis/orders/${P.orderId}/clinical-notes`, { vitals: {
      chief_complaints: ['Fever', 'Headache'],
      history_of_presenting_illness: 'Fever and headache for 3 days, with chills and joint pains. Poor appetite. No cough, no diarrhoea, no urinary symptoms. No antimalarial taken.',
      medical_history: 'No chronic illness. Treated for malaria in 2024.', surgical_history: 'None', family_history: 'Non-contributory',
      social_history: 'Trader in Konyo Konyo market. Non-smoker, occasional alcohol.', allergies: 'No known drug allergies',
      general_examination: { general_appearance: 'Febrile, mildly dehydrated, not in distress', pallor: 'Mild', jaundice: 'None', cyanosis: 'None', oedema: 'None', lymph_nodes: 'Not enlarged' },
      impressions: 'Provisional diagnosis: uncomplicated malaria. Rule out typhoid.',
    } });
    const catalog = await labTestCatalog();
    const tests = ['MRDT', 'CBC'].map((code) => catalog.find((t) => t.test_code === code));
    await api(as('doctor'), 'POST', '/lis/orders', {
      participant_id: P.id, order_id: P.orderId, doctor_id: state.users.doctor.id, clinical_notes: 'Fever 3 days — malaria RDT and CBC',
      tests: tests.map((t) => ({ code: t.test_code, name: t.test_name, department: t.category })),
    });
    mark('p1Order');
  }
  if (!done('p1Consult')) {
    const catalog = await labTestCatalog();
    const tests = ['MRDT', 'CBC'].map((code) => catalog.find((t) => t.test_code === code));
    await billLines(as('doctor'), P, tests.map((t) => ({ serviceId: t.service_id || t.scheme_service_id, serviceName: t.test_name, quantity: 1, unitPrice: Number(t.price), totalPrice: Number(t.price) })), { notes: 'Auto-generated from LIS order' });
    mark('p1Consult'); log('consultation recorded; Malaria RDT + CBC ordered and billed');
  }

  // 4. Cashier: cash payment in full
  if (!P.payment1) {
    P.payment1 = await payAll(P.billId, 'cash', `Consultation and lab — ${TAG}`); save();
    log(`paid SSP ${P.payment1.amount.toLocaleString()} cash, receipt ${P.payment1.receipt}`);
  }

  // 5. Lab: collect, results (RDT positive, full CBC), approve
  if (!done('p1Lab')) {
    const catalog = await labTestCatalog();
    const rdtComp = catalog.find((t) => t.test_code === 'MRDT')?.components?.[0];
    const res = await runLab(P.orderId, { MRDT: { [rdtComp?.name || rdtComp?.component_name]: 'POSITIVE (P. falciparum)' }, CBC: CBC_RESULTS.cash });
    mark('p1Lab'); log(`lab: ${res.specimens} specimens, ${res.results} results approved`);
  }

  // 6. Doctor confirms malaria; prescribes Coartem + Paracetamol
  if (!P.rxId) {
    await api(as('doctor'), 'POST', `/lis/orders/${P.orderId}/diagnoses`, { icd_code: 'B50.9', icd_source: 'who', icd_version: 'ICD-10', description: 'Plasmodium falciparum malaria, unspecified' });
    const drugs = (await api(as('doctor'), 'GET', `/pharmacy-module/drugs?clinic_id=${CLINIC_ID}&is_active=true&location_id=${state.pharmacyStore.id}&stocked_only=true`)).body;
    const al = drugs.find((d) => d.drug_code === 'AL20120'); const pcm = drugs.find((d) => d.drug_code === 'PCM500');
    const r = await api(as('doctor'), 'POST', '/pharmacy-module/prescriptions', {
      clinic_id: CLINIC_ID, patient_id: P.id, doctor_id: state.users.doctor.id, prescription_date: today(), prescribed_by_name: 'Dr. James Lado Wani',
      lines: [
        { drug_id: al.id, quantity_prescribed: 24, unit_of_measure: 'tablet', dose_strength: '4 tablets', dose_amount: 4, frequency: 'BD', duration_days: 3, notes: 'Take with food or milk', location_id: state.pharmacyStore.id, location_name: state.pharmacyStore.name },
        { drug_id: pcm.id, quantity_prescribed: 18, unit_of_measure: 'tablet', dose_strength: '1000 mg', dose_amount: 2, frequency: 'TDS', duration_days: 3, notes: 'For fever', location_id: state.pharmacyStore.id, location_name: state.pharmacyStore.name },
      ],
    });
    P.rxId = r.body.id; P.rxNumber = r.body.prescription_number; save();
    log(`diagnosis B50.9; prescription ${P.rxNumber}: Coartem 24 tab, Paracetamol 18 tab`);
  }

  // 7. Pharmacy bills the drugs (by pack), cashier takes cash, the paid drugs are dispensed
  if (!P.payment2) {
    const drugs = (await api(as('pharmacy'), 'GET', `/pharmacy-module/drugs?clinic_id=${CLINIC_ID}&is_active=true&location_id=${state.pharmacyStore.id}&stocked_only=true`)).body;
    const line = (code, doses) => { const d = drugs.find((x) => x.drug_code === code); const upp = Number(d.units_per_pack) || 1; const packs = doses / upp; const total = Math.round(Number(d.selling_price) * packs * 100) / 100;
      return { serviceId: d.id, serviceName: d.drug_name, quantity: doses, packQuantity: packs, unitPrice: Math.round(total / doses * 10000) / 10000, totalPrice: total, category: 'Pharmacy / Inventory' }; };
    await billLines(as('pharmacy'), P, [line('AL20120', 24), line('PCM500', 18)], { notes: 'Auto-generated from pharmacy prescription' });
    P.payment2 = await payAll(P.billId, 'cash', `Pharmacy — ${TAG}`); save();
    log(`drugs paid SSP ${P.payment2.amount.toLocaleString()} cash, receipt ${P.payment2.receipt}`);
  }
  if (!done('p1Dispense')) {
    // Payment dispenses the paid prescription lines automatically; the counter's own Dispense
    // for the same line is refused as already dispensed (409) — the pharmacist confirms it here.
    const rx = (await api(as('pharmacy'), 'GET', `/pharmacy-module/prescriptions/${P.rxId}`)).body;
    for (const l of rx.lines || []) {
      const out = Number(l.quantity_prescribed) - Number(l.total_quantity_dispensed || 0);
      if (out <= 0) continue;
      await api(as('pharmacy'), 'POST', '/pharmacy-module/dispensing', {
        clinic_id: CLINIC_ID, prescription_id: P.rxId, prescription_line_id: l.id, patient_id: P.id, drug_id: l.drug_id, pharmacist_id: state.users.pharmacy.id,
        batch_id: '', from_location_id: state.pharmacyStore.id, quantity_dispensed: out, unit_of_measure: l.unit_of_measure, unit_price: 0,
        dispensing_notes: TAG, patient_counselling_provided: true, counselling_notes: 'Complete the full 3-day course; take with food.' }, { allow: [409] });
    }
    mark('p1Dispense'); log('dispensed');
  }
  mark('step4');
}

// ═════════════════════════════════════════════════════════════════════════
// STEP 5 — Patient 2: CIC Insurance patient, full journey
// ═════════════════════════════════════════════════════════════════════════
const URINE_GENERAL = {
  Colour: 'Pale yellow', Reaction: 'Acidic', Leucocyte: 'Negative', Blood: 'Negative', Ketone: 'Negative', PH: '6.0', Protein: 'Negative',
  Urobilinogen: 'Normal', Sugar: 'Negative', Bilirubin: 'Negative', 'Specific Gravity': '1.020', Pus: '0-2 /hpf', RBCs: '0-1 /hpf',
  'Epithelial Cells': 'Few', Crystal: 'None seen', Cast: 'None seen', Others: 'Nil',
};

async function step5() {
  step('STEP 5 — CIC insurance patient');
  await branchLabTests();
  const P = state.p2 = state.p2 || {};
  const CIC = state.cic.id;
  const clinics = (await api(as('reception'), 'GET', '/clinics')).body;
  const gp = (Array.isArray(clinics) ? clinics : clinics.data || []).find((c) => c.name === 'General Practitioner');

  // 1. Register under CIC (member number), queue to OPD; consultation on the CIC bill
  if (!P.id) {
    const r = await api(as('reception'), 'POST', '/lis/participants', {
      first_name: 'Achol', last_name: 'Ayen Deng', gender: 'female', date_of_birth: '1998-05-20', phone: '+211 915 228 640',
      residence: 'Munuki Block C, Juba', study_ref: TAG, doctor_id: state.users.doctor.id, clinic_id: gp.id, clinic_name: gp.name, room_number: '',
      demographics: { scheme_id: CIC, scheme_name: 'CIC Insurance' },
    });
    Object.assign(P, { id: r.body.id, number: r.body.participant_number, queue: r.body.queue_number, name: 'Achol Ayen Deng', member: 'CIC-JUB-204517' }); save();
    log(`registered ${P.name} (${P.number}), queue #${P.queue}`);
  }
  // Enrolment needs schemes.write, which reception lacks (reported as a bug) — the accountant (insurance desk) enrols her.
  if (!done('p2Enrol')) {
    await api(as('accountant'), 'POST', `/schemes/patient-schemes/${P.id}`, { scheme_id: CIC, clinic_id: CLINIC_ID, member_number: P.member });
    mark('p2Enrol'); log(`enrolled in CIC, member ${P.member}`);
  }
  if (!P.billId) {
    const svc = (await api(as('reception'), 'GET', `/services/${gp.service}`)).body;
    const bill = await billLines(as('reception'), P, [{ serviceId: svc.id, serviceName: svc.service_name || svc.name, quantity: 1, unitPrice: Number(svc.price), totalPrice: Number(svc.price) }], { schemeId: CIC, notes: 'Auto-generated on queueing to General Practitioner' });
    P.billId = bill.id; P.billNumber = bill.bill_number; save();
    log(`consultation on ${P.billNumber} (${bill.bill_currency} ${bill.total_amount})`);
  }
  if (!P.orderId) { P.orderId = (await visitOrder(P.id))?.id; save(); }

  // 2. Triage
  if (!done('p2Triage')) {
    await api(as('nurse'), 'PUT', `/lis/orders/${P.orderId}/triage`, { vitals: {
      blood_pressure: '112/74', pulse: '98', temperature: '38.1', respiratory_rate: '24', weight: '61', height: '164', spo2: '95', fasting_status: 'No', allergies: 'Penicillin: none known' } });
    mark('p2Triage'); log('triage: BP 112/74, pulse 98, T 38.1°C, RR 24, SpO2 95%');
  }

  // 3. Doctor: consultation; orders CBC, Random Blood Sugar, Urinalysis
  if (!done('p2Order')) {
    await api(as('doctor'), 'PUT', `/lis/orders/${P.orderId}/clinical-notes`, { vitals: {
      chief_complaints: ['Cough', 'Fever'],
      history_of_presenting_illness: 'Productive cough with yellow sputum for 5 days, fever and sore throat for 3 days. Mild chest discomfort on coughing. No haemoptysis, no night sweats.',
      medical_history: 'No chronic illness. Not pregnant (LMP 2 weeks ago).', surgical_history: 'None', family_history: 'Mother diabetic',
      social_history: 'Teacher at a primary school in Munuki. Non-smoker.', allergies: 'No known drug allergies',
      general_examination: { general_appearance: 'Febrile, alert, not in respiratory distress', pallor: 'None', jaundice: 'None', cyanosis: 'None', oedema: 'None', lymph_nodes: 'Tender anterior cervical nodes' },
      impressions: 'Provisional diagnosis: upper respiratory tract infection. Screen blood sugar (family history of diabetes).',
    } });
    const catalog = await labTestCatalog();
    const tests = ['CBC', 'RBS', 'URINEGEN'].map((code) => catalog.find((t) => t.test_code === code));
    await api(as('doctor'), 'POST', '/lis/orders', {
      participant_id: P.id, order_id: P.orderId, doctor_id: state.users.doctor.id, clinical_notes: 'Cough and fever — CBC, RBS, urinalysis',
      tests: tests.map((t) => ({ code: t.test_code, name: t.test_name, department: t.category })),
    });
    mark('p2Order');
  }
  if (!done('p2Consult')) {
    const catalog = await labTestCatalog();
    const tests = ['CBC', 'RBS', 'URINEGEN'].map((code) => catalog.find((t) => t.test_code === code));
    await billLines(as('doctor'), P, tests.map((t) => ({ serviceId: t.service_id || t.scheme_service_id, serviceName: t.test_name, quantity: 1, unitPrice: Number(t.price), totalPrice: Number(t.price) })), { schemeId: CIC, notes: 'Auto-generated from LIS order' });
    mark('p2Consult'); log('consultation recorded; CBC, RBS, Urinalysis ordered on the CIC bill');
  }

  // 4. Lab (CIC: credit, so nothing to collect before sampling)
  if (!done('p2Lab')) {
    const catalog = await labTestCatalog();
    const rbsComp = catalog.find((t) => t.test_code === 'RBS')?.components?.[0];
    const res = await runLab(P.orderId, { CBC: CBC_RESULTS.cic, RBS: { [rbsComp?.name || rbsComp?.component_name]: '5.8' }, URINEGEN: URINE_GENERAL });
    mark('p2Lab'); log(`lab: ${res.specimens} specimens, ${res.results} results approved`);
  }

  // 5. Diagnosis URTI; Amoxicillin + Paracetamol on the CIC bill; pharmacist dispenses
  if (!P.rxId) {
    await api(as('doctor'), 'POST', `/lis/orders/${P.orderId}/diagnoses`, { icd_code: 'J06.9', icd_source: 'who', icd_version: 'ICD-10', description: 'Acute upper respiratory infection, unspecified' });
    const drugs = (await api(as('doctor'), 'GET', `/pharmacy-module/drugs?clinic_id=${CLINIC_ID}&is_active=true&location_id=${state.pharmacyStore.id}&stocked_only=true`)).body;
    const amx = drugs.find((d) => d.drug_code === 'AMX500'); const pcm = drugs.find((d) => d.drug_code === 'PCM500');
    const r = await api(as('doctor'), 'POST', '/pharmacy-module/prescriptions', {
      clinic_id: CLINIC_ID, patient_id: P.id, doctor_id: state.users.doctor.id, prescription_date: today(), prescribed_by_name: 'Dr. James Lado Wani',
      lines: [
        { drug_id: amx.id, quantity_prescribed: 15, unit_of_measure: 'capsule', dose_strength: '500 mg', dose_amount: 1, frequency: 'TDS', duration_days: 5, notes: 'Complete the course', location_id: state.pharmacyStore.id, location_name: state.pharmacyStore.name },
        { drug_id: pcm.id, quantity_prescribed: 18, unit_of_measure: 'tablet', dose_strength: '1000 mg', dose_amount: 2, frequency: 'TDS', duration_days: 3, notes: 'For fever and pain', location_id: state.pharmacyStore.id, location_name: state.pharmacyStore.name },
      ],
    });
    P.rxId = r.body.id; P.rxNumber = r.body.prescription_number; save();
    const line = (d, doses) => { const upp = Number(d.units_per_pack) || 1; const packs = doses / upp; const total = Math.round(Number(d.selling_price) * packs * 100) / 100;
      return { serviceId: d.id, serviceName: d.drug_name, quantity: doses, packQuantity: packs, unitPrice: Math.round(total / doses * 10000) / 10000, totalPrice: total, category: 'Pharmacy / Inventory' }; };
    await billLines(as('pharmacy'), P, [line(amx, 15), line(pcm, 18)], { schemeId: CIC, notes: 'Auto-generated from pharmacy prescription' });
    log(`diagnosis J06.9; prescription ${P.rxNumber} billed to CIC`);
  }
  if (!done('p2Dispense')) {
    const rx = (await api(as('pharmacy'), 'GET', `/pharmacy-module/prescriptions/${P.rxId}`)).body;
    for (const l of rx.lines || []) {
      const out = Number(l.quantity_prescribed) - Number(l.total_quantity_dispensed || 0);
      if (out <= 0) continue;
      await api(as('pharmacy'), 'POST', '/pharmacy-module/dispensing', {
        clinic_id: CLINIC_ID, prescription_id: P.rxId, prescription_line_id: l.id, patient_id: P.id, drug_id: l.drug_id, pharmacist_id: state.users.pharmacy.id,
        batch_id: '', from_location_id: state.pharmacyStore.id, quantity_dispensed: out, unit_of_measure: l.unit_of_measure, unit_price: 0,
        dispensing_notes: TAG, patient_counselling_provided: true, counselling_notes: 'Amoxicillin three times a day for 5 days; finish the course.' }, { allow: [409] });
    }
    mark('p2Dispense'); log('dispensed');
  }

  // 6. Bill → invoice for CIC (credit, 30 days)
  if (!P.invoiceId) {
    const bill = (await api(as('accountant'), 'GET', `/patient-bills/${P.billId}`)).body;
    const lines = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services || [];
    P.billTotal = Number(bill.total_amount); P.billCurrency = bill.bill_currency;
    const r = await api(as('accountant'), 'POST', '/invoices', {
      bill_id: bill.id, patient_id: bill.patient_id, patient_name: bill.patient_name, clinic_id: bill.clinic_id, amount: Number(bill.balance_amount),
      currency: bill.bill_currency, payment_terms: 30, notes: `CIC Insurance — member ${P.member} — ${TAG}`,
      services: lines.filter((l) => !l.isVoided && !l.paid), scheme_id: CIC, scheme_name: 'CIC Insurance',
    });
    P.invoiceId = r.body.data?.id; P.invoiceNumber = r.body.data?.invoice_number; save();
    log(`invoice ${P.invoiceNumber} for CIC: ${bill.bill_currency} ${bill.balance_amount}`);
  }

  // 7. Claim → submit → accept → CIC pays in full into the bank
  if (!P.claimId) {
    const r = await api(as('accountant'), 'POST', '/insurance-claims', { scheme_id: CIC, date_from: today(), date_to: today(), invoice_ids: [P.invoiceId], claim_amount: P.billTotal, notes: TAG });
    P.claimId = r.body.data?.id || r.body.id; P.claimNumber = r.body.data?.claim_number || r.body.claim_number; save();
    log(`claim ${P.claimNumber}`);
  }
  if (!done('p2ClaimPaid')) {
    for (const st of ['submitted', 'accepted']) {
      const c = (await api(as('accountant'), 'GET', `/insurance-claims/${P.claimId}`)).body.data;
      if ((st === 'submitted' && c.status === 'pending') || (st === 'accepted' && c.status === 'submitted')) {
        await api(as('accountant'), 'PUT', `/insurance-claims/${P.claimId}/status`, { status: st, notes: `${st === 'submitted' ? 'Submitted to CIC Juba office' : 'Accepted by CIC'} — ${TAG}` });
      }
    }
    const accts = (await api(as('accountant'), 'GET', `/insurance-claims/${P.claimId}/deposit-accounts`)).body.data;
    const bank = accts.find((a) => a.account_code === '1110');
    await api(as('accountant'), 'PUT', `/insurance-claims/${P.claimId}/status`, { status: 'paid', paid_amount: P.billTotal, deposit_account_id: bank.id, notes: `CIC remittance EFT-CIC-26102 into ${bank.account_name} — ${TAG}` });
    mark('p2ClaimPaid'); log(`CIC paid ${P.billCurrency} ${P.billTotal} into ${bank.account_code} ${bank.account_name}`);
  }
  mark('step5');
}

// ═════════════════════════════════════════════════════════════════════════
// STEP 6 — end of day: a small expense, then close the cashier shift
// ═════════════════════════════════════════════════════════════════════════
async function step6() {
  step('STEP 6 — end of day');
  if (!state.expense) {
    const coa = (await api(as('accountant'), 'GET', `/accounting/chart-of-accounts?clinic_id=${CLINIC_ID}`)).body;
    const cash = coa.find((a) => a.account_code === '1105');
    const cats = (await api(ADMIN, 'GET', `/categories?clinic_id=${CLINIC_ID}`)).body;
    const office = (Array.isArray(cats) ? cats : cats.data || []).find((c) => c.type === 'expense' && c.name === 'Office Supplies');
    const r = await api(as('procurement'), 'POST', '/daily-expenses', {
      expense_date: today(), description: 'Office stationery — receipt books, pens, printer paper', amount: 35000,
      category: 'Office Supplies', category_id: office?.id, account_id: cash.id, account_name: cash.account_name,
      payment_method: 'Cash', notes: TAG,
    });
    state.expense = { id: r.body.id || r.body.data?.id, amount: 35000 }; save();
    log('expense request: Office stationery SSP 35,000');
  }
  if (!done('expensePaid')) {
    for (let i = 0; i < 2; i++) await api(ADMIN, 'POST', `/daily-expenses/${state.expense.id}/approve`, { notes: `Approved — ${TAG}` }, { allow: [400] });
    const r = await api(as('accountant'), 'POST', `/daily-expenses/${state.expense.id}/pay`, {});
    state.expense.voucher = r.body.voucher_number || r.body.data?.voucher_number; save();
    mark('expensePaid'); log('expense approved and paid from 1105 Cash at Hand');
  }
  if (!done('shiftClosed')) {
    const cur = (await api(as('cashier'), 'GET', '/cashier/current-shift')).body;
    const shift = cur.shift || cur;
    const cashIn = [state.p1?.payment1?.amount, state.p1?.payment2?.amount].filter(Boolean).reduce((a, b) => a + b, 0);
    const counted = Number(shift.opening_balance || 50000) + cashIn;
    const r = await api(as('cashier'), 'POST', `/cashier/close-shift/${shift.id}`, { closing_balance: counted, notes: `Counted ${counted} — ${TAG}` });
    state.shiftClose = { counted, expected: Number(r.body.expected_cash), variance: Number(r.body.cash_variance) }; save();
    mark('shiftClosed'); log(`shift closed: counted ${counted}, expected ${r.body.expected_cash}, variance ${r.body.cash_variance}`);
  }
  mark('step6');
}

// ═════════════════════════════════════════════════════════════════════════
// Opening balance and exchange rates
// ═════════════════════════════════════════════════════════════════════════
const OPENING_DAY = '2026-10-24'; // the day before the demo day: the hospital's opening position

/** Owner's capital of SSP 2,000,000 paid into the bank, posted as a journal entry through the app. */
async function openingBalance() {
  step('Opening balance — owner\'s capital into the bank');
  if (done('openingBalance')) { log(`already posted: ${state.openingBalance}`); return; }
  const coa = (await api(ADMIN, 'GET', `/accounting/chart-of-accounts?clinic_id=${CLINIC_ID}`)).body;
  const acct = (code) => (Array.isArray(coa) ? coa : coa.data || []).find((a) => a.account_code === code);
  const bank = acct('1110'); const capital = acct('3100');
  if (!capital.is_active) {
    await api(ADMIN, 'PUT', `/accounting/chart-of-accounts/${capital.id}`, { is_active: true });
    log('3100 Owner\'s Capital switched on');
  }
  const je = (await api(as('accountant'), 'POST', '/accounting/journal-entries', {
    clinic_id: CLINIC_ID, entry_date: OPENING_DAY, reference: 'DEMO-opening-balance',
    description: 'Opening balance — owner\'s capital paid into Bank Account – Main',
    narration: `The hospital's opening position before the demo day. ${TAG}`,
    lines: [
      { account_id: bank.id, debit_amount: 2000000, credit_amount: 0, description: 'Opening balance' },
      { account_id: capital.id, debit_amount: 0, credit_amount: 2000000, description: 'Owner\'s capital' },
    ],
  })).body;
  await api(as('accountant'), 'POST', `/accounting/journal-entries/${je.id}/submit`, {});
  await api(ADMIN, 'POST', `/accounting/journal-entries/${je.id}/approve`, {});
  await api(as('accountant'), 'POST', `/accounting/journal-entries/${je.id}/post`, {});
  state.openingBalance = `${je.je_number} (${OPENING_DAY}): Dr 1110 Bank 2,000,000 / Cr 3100 Owner's Capital`; save();
  mark('openingBalance'); log(`posted ${state.openingBalance}`);
}

/**
 * Today's USD→SSP rate in force (7,800), and the stale SSP→USD 7,500 row switched off. Safe to run
 * before every demo. A new rate is added only when none applies today (a new rate ends the
 * previous one the day before it starts, so earlier days keep their own rate).
 */
async function rates() {
  step('Exchange rates');
  const list = (await api(ADMIN, 'GET', `/accounting/exchange-rates?clinic_id=${CLINIC_ID}`)).body;
  const all = Array.isArray(list) ? list : list.data || [];
  const t = today();
  const live = all.filter((r) => r.from_currency === 'USD' && r.to_currency === 'SSP' && r.is_active
    && String(r.effective_date).slice(0, 10) <= t && (!r.expiry_date || String(r.expiry_date).slice(0, 10) >= t))
    .sort((a, b) => String(b.effective_date).localeCompare(String(a.effective_date)))[0];
  if (live) {
    log(`USD→SSP in force today: ${Number(live.rate)} (since ${String(live.effective_date).slice(0, 10)})${Number(live.rate) === 7800 ? '' : ' — not 7,800, check it'}`);
  } else {
    await api(ADMIN, 'POST', '/accounting/exchange-rates', { clinic_id: CLINIC_ID, from_currency: 'USD', to_currency: 'SSP', rate: 7800, effective_date: t, source: 'manual' });
    log(`USD→SSP 7,800 added for ${t}`);
  }
  for (const r of all.filter((x) => x.from_currency === 'SSP' && x.to_currency === 'USD' && x.is_active && Number(x.rate) === 7500)) {
    await api(ADMIN, 'PUT', `/accounting/exchange-rates/${r.id}`, { is_active: false });
    log(`stale SSP→USD 7,500 (from ${String(r.effective_date).slice(0, 10)}) switched off`);
  }
}

// ═════════════════════════════════════════════════════════════════════════
async function main() {
  await login(ADMIN, ADMIN_PW);
  // Demo users log in once their passwords are set (step 1 sets them on a fresh tenant).
  const loginUsers = async () => { for (const u of USERS) { if (state.users?.[u.key]?.passwordSet) await login(u.email, u.password); } };
  await loginUsers();
  if (want('step1')) await step1();
  if (want('opening')) await openingBalance();
  if (want('rates')) await rates();
  if (want('step2')) await step2();
  if (want('step3')) await step3();
  if (want('step4')) await step4();
  if (want('step5')) await step5();
  if (want('step6')) await step6();
  log('\nSeed finished. State in scripts/demo/.demo-state.json');
}

main().catch((e) => { console.error('\nSEED FAILED:', e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 800)); process.exit(1); });

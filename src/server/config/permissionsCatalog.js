/**
 * Single source of truth for the dynamic Roles & Privileges system.
 *
 * PRIVILEGES is one entry per real backend enforcement point — the ~50+
 * hardcoded role arrays this replaces (BILLING_WRITE, INVENTORY_READ,
 * LIS_CLINICAL, etc. — one array per authorize() call site across ~38 route
 * files). DEFAULT_ROLE_PRIVILEGES is the exact current effective permission
 * matrix, hand-transcribed from those arrays so the cutover changes nothing
 * on day one — only the mechanism (DB lookup instead of hardcoded array)
 * changes. From here on, role_privileges in the database is the only thing
 * that matters; this file is the one-time seed, not an ongoing shadow copy.
 *
 * Deliberately excluded (see plan): requireApprovalPermission's 9 approval
 * types (a separate per-USER grant system, approval_permissions table —
 * more granular than roles on purpose, not folded in here), branch scoping
 * (branchAccessControl.js/branchFilter.js — restricts which rows, not which
 * actions), and labIntegration.js's 'integration' JWT pseudo-role (a machine
 * credential that never calls authorize()).
 *
 * roles.js's own role/privilege-management routes and users.js's create/
 * delete routes stay permanently hardcoded authorize(['admin']) — never
 * privileges here — so a role can never be granted the ability to edit the
 * permission system itself. inventory.js's DELETE /items/clear-all stays
 * hardcoded too (irreversible bulk data loss, not a normal CRUD action).
 */

const SYSTEM_ROLES = [
  { role_key: 'admin', name: 'Administrator', description: 'Full system access' },
  { role_key: 'reception', name: 'Reception', description: 'Front-desk registration and scheduling' },
  { role_key: 'doctor', name: 'Doctor', description: 'Clinical care and prescribing' },
  { role_key: 'lab', name: 'Laboratory', description: 'Lab requests, specimens, and results' },
  { role_key: 'pharmacy', name: 'Pharmacy', description: 'Dispensing and pharmacy inventory' },
  { role_key: 'reports', name: 'Reports', description: 'Read-only reporting access' },
  { role_key: 'accountant', name: 'Accountant', description: 'Accounting and billing operations' },
  { role_key: 'finance_manager', name: 'Finance Manager', description: 'Financial oversight and approvals' },
  { role_key: 'auditor', name: 'Auditor', description: 'Read-only audit access' },
  { role_key: 'procurement', name: 'Procurement', description: 'Purchasing and supplier management' },
  { role_key: 'nurse', name: 'Nurse', description: 'Nursing care and triage' },
  { role_key: 'cashier', name: 'Cashier', description: 'Payment collection and cash handling' },
];

// [key, name, module, description, roles]
const CATALOG = [
  ['accounting.read', 'View accounting & reports', 'accounting', 'Chart of accounts, ledger, journal entries, financial reports (read)', ['admin', 'accountant', 'finance_manager', 'auditor']],
  ['accounting.write', 'Manage accounting entries', 'accounting', 'Create/edit chart of accounts, post journal entries', ['admin', 'accountant', 'finance_manager']],
  ['accounting.rates.read', 'View exchange rates', 'accounting', 'View currencies and exchange rates', ['admin', 'accountant', 'finance_manager', 'cashier', 'reception', 'pharmacy']],
  ['accounting.rates.write', 'Manage exchange rates', 'accounting', 'Create/edit/delete currencies and exchange rates', ['admin', 'accountant', 'finance_manager']],
  ['accounting.chart_of_accounts.list', 'List chart of accounts', 'accounting', 'Broader read access to the chart-of-accounts list specifically', ['admin', 'accountant', 'finance_manager', 'auditor', 'cashier', 'procurement']],
  ['accounting.chart_of_accounts.initialize', 'Initialize chart of accounts', 'accounting', 'One-time setup of a clinic’s chart of accounts', ['admin']],
  ['accounting.journal_entries.approve', 'Approve/reject journal entries', 'accounting', 'Approve or reject a submitted journal entry', ['admin', 'finance_manager']],
  ['fx.write', 'Manage FX settings', 'accounting', 'Currency conversion, revaluation, FX report settings', ['admin', 'accountant', 'finance_manager']],
  ['ledger_accounts.write', 'Manage ledger accounts', 'accounting', 'Create/edit/delete ledger accounts', ['admin', 'accountant', 'finance_manager']],
  ['assets.view', 'View fixed assets', 'accounting', 'Asset register, categories, depreciation and reports (read)', ['admin', 'accountant', 'finance_manager', 'auditor']],
  ['assets.write', 'Manage fixed assets', 'accounting', 'Register/edit assets and categories, run depreciation, revalue', ['admin', 'accountant', 'finance_manager']],
  ['assets.dispose', 'Dispose of fixed assets', 'accounting', 'Record an asset disposal and its gain/loss posting', ['admin', 'finance_manager']],

  ['billing.write', 'Manage billing adjustments', 'billing', 'Bill line items, discounts, write-offs, credit notes, insurance claims on a bill', ['admin', 'reception', 'doctor', 'finance_manager', 'accountant']],
  ['bills.read', 'View patient bills', 'billing', 'View bills, receipts, search', ['admin', 'reception', 'doctor', 'cashier', 'finance_manager', 'accountant', 'auditor', 'pharmacy', 'lab']],
  ['bills.write_charge', 'Create bills / add charges', 'billing', 'Create a new bill or add services to one', ['admin', 'reception', 'doctor', 'cashier', 'pharmacy', 'lab']],
  ['bills.financial_action', 'Edit / void bill items', 'billing', 'Edit a bill, void a line item', ['admin', 'cashier', 'reception', 'finance_manager', 'accountant']],
  ['bills.collect_payment', 'Collect bill payments', 'billing', 'Record a payment against a bill', ['admin', 'cashier', 'reception', 'finance_manager', 'accountant', 'pharmacy']],
  ['bills.delete', 'Delete bills', 'billing', 'Permanently delete a bill', ['admin']],
  ['claims.write', 'Manage insurance claims', 'billing', 'Create/edit/delete insurance claims', ['admin', 'reception', 'finance_manager', 'accountant']],
  ['invoices.write', 'Manage invoices', 'billing', 'Create invoices, record payments, cancel, mark paid', ['admin', 'reception', 'finance_manager', 'accountant']],
  ['proforma.write', 'Manage proforma invoices', 'billing', 'Create, delete, convert proforma invoices', ['admin', 'reception', 'doctor']],
  ['receipts.write', 'Change receipt status', 'billing', 'Void/update a receipt’s status', ['admin', 'reception', 'doctor', 'pharmacy', 'cashier']],
  ['schemes.write', 'Manage insurance schemes', 'billing', 'Scheme CRUD, memberships, pricing, discounts', ['admin', 'finance_manager', 'accountant']],
  ['deposits.write', 'Take patient deposits', 'billing', 'Create a patient deposit', ['admin', 'cashier', 'reception', 'finance_manager', 'accountant']],
  ['deposits.read', 'View deposit balances', 'billing', 'View a patient’s deposit balance and history', ['admin', 'cashier', 'reception', 'finance_manager', 'accountant', 'doctor']],

  ['cashier.write', 'Cashier shift actions', 'cashier', 'Start/close a shift, transfer cash', ['admin', 'reception', 'pharmacy', 'cashier']],
  ['cash_transfers.write', 'Record cash transfers', 'cashier', 'Create a cash transfer between accounts', ['admin', 'accountant', 'finance_manager', 'reception', 'pharmacy', 'cashier']],
  ['expenses.read', 'View daily expenses', 'cashier', 'View expenses, supplier bills, approvals', ['admin', 'cashier', 'finance_manager', 'accountant', 'procurement']],
  ['expenses.write', 'Record daily expenses', 'cashier', 'Create/edit/pay expenses and supplier bills', ['admin', 'cashier', 'procurement']],

  ['clinical.chief_complaints.write', 'Record chief complaints', 'clinical', 'Add a patient chief complaint', ['admin', 'doctor', 'nurse', 'reception']],
  ['clinical.diagnoses.write', 'Record diagnoses', 'clinical', 'Add a clinical diagnosis', ['admin', 'doctor', 'nurse']],
  ['clinical.encounters.write', 'Manage visits/encounters', 'clinical', 'Create a visit, edit/close visit details', ['admin', 'doctor', 'nurse', 'reception', 'lab']],
  ['clinical.prescriptions.write', 'Write clinical prescriptions', 'clinical', 'Prescribe medication from a clinical encounter', ['admin', 'doctor']],
  ['clinical.queue.write', 'Manage clinical queue', 'clinical', 'Edit/remove a patient from the clinical queue', ['admin', 'reception', 'nurse', 'doctor', 'lab']],
  ['clinical.services.manage', 'Manage service catalogue', 'clinical', 'Create/edit/delete billable services', ['admin', 'doctor', 'lab']],
  ['clinical.services.reprice', 'Bulk reprice services', 'clinical', 'Bulk price adjustment on services', ['admin', 'finance_manager', 'accountant']],
  ['patients.write', 'Manage patients', 'clinical', 'Create/edit patient records', ['admin', 'reception', 'doctor', 'nurse', 'lab']],
  ['patients.delete', 'Delete patients', 'clinical', 'Permanently delete a patient record', ['admin']],
  ['queue.write', 'Manage patient queue', 'clinical', 'Create/edit/delete patient queue entries', ['admin', 'reception', 'nurse', 'doctor', 'lab']],
  ['visits.write', 'Create visits', 'clinical', 'Register a new patient visit', ['admin', 'reception', 'doctor', 'nurse']],

  ['inpatient.facility.read', 'View wards/rooms/beds', 'inpatient', 'View inpatient facility structure', ['admin', 'doctor', 'reception', 'lab']],
  ['inpatient.facility.write', 'Manage wards/rooms/beds', 'inpatient', 'Create/edit/delete wards, rooms, beds', ['admin']],
  ['inpatient.admissions.write', 'Manage admissions', 'inpatient', 'Admission requests, admit, discharge', ['admin', 'doctor', 'reception']],
  ['inpatient.clinical.write', 'Inpatient clinical notes', 'inpatient', 'Doctor notes, nursing notes, drug administration entries', ['admin', 'doctor']],
  ['inpatient.ancillary.write', 'Order inpatient lab/radiology', 'inpatient', 'Lab/radiology requests for an inpatient', ['admin', 'doctor', 'lab']],
  ['inpatient.medications.manage', 'View/administer inpatient medications', 'inpatient', 'View/edit inpatient prescriptions and drug administrations', ['admin', 'doctor', 'pharmacy']],

  ['theatre.view', 'View theatre/OR', 'theatre', 'Operation requests, rooms, schedule, and operation detail (read)', ['admin', 'doctor', 'nurse']],
  ['theatre.write', 'Manage theatre/OR', 'theatre', 'Create requests, schedule/start/complete operations, checklists, vitals, rooms', ['admin', 'doctor', 'nurse']],

  ['inventory.read', 'View inventory', 'inventory', 'Items, batches, transactions, valuation, reports', ['admin', 'pharmacy', 'finance_manager', 'accountant', 'procurement']],
  ['inventory.write', 'Manage inventory', 'inventory', 'Items, locations, batches, adjustments, physical counts', ['admin', 'pharmacy', 'procurement']],
  ['inventory.adjustments.approve', 'Approve inventory adjustments', 'inventory', 'Approve/reject a stock adjustment', ['admin', 'finance_manager', 'procurement']],

  ['lab.requests.write', 'Create lab requests', 'lab', 'Order a lab test', ['admin', 'lab', 'doctor']],
  ['lab.results.write', 'Enter lab results', 'lab', 'Auto-save/send lab results', ['admin', 'lab']],

  ['lis.registration.write', 'Edit LIS participant registration', 'lis', 'Edit a registered LIS participant', ['admin', 'reception']],
  ['lis.participants.read', 'View LIS participants', 'lis', 'View the LIS participant directory', ['admin', 'reception', 'doctor', 'lab', 'nurse', 'pharmacy', 'cashier', 'finance_manager', 'accountant']],
  ['lis.participants.create', 'Register LIS participants', 'lis', 'Register a new LIS participant', ['admin', 'reception', 'doctor', 'pharmacy', 'lab']],
  ['lis.queue.write', 'Manage LIS queue', 'lis', 'Queue a participant, call next, view queue', ['admin', 'reception', 'lab', 'doctor', 'nurse']],
  ['lis.dashboard.read', 'View lab dashboard', 'lis', 'View the lab operations dashboard', ['admin', 'reception', 'lab', 'doctor', 'nurse']],
  ['lis.clinical.write', 'Manage LIS orders', 'lis', 'Create an order, add tests, notes, close an order', ['admin', 'doctor', 'reception']],
  ['lis.clinical.read', 'View LIS orders', 'lis', 'View orders and visit summaries', ['admin', 'doctor', 'reception', 'lab']],
  ['lis.triage.write', 'Enter triage vitals', 'lis', 'Record nurse triage vitals on an order', ['admin', 'nurse']],
  ['nursing.procedures.write', 'Manage nursing procedures', 'lis', 'Record injections, minor procedures, and dressings performed by a nurse', ['admin', 'nurse']],
  ['nursing.procedures.order', 'Order billable nursing procedures', 'lis', 'Order an injection, dressing, or minor procedure for a nurse to carry out (doctor, or reception for a walk-in order)', ['admin', 'doctor', 'reception']],
  ['antenatal.write', 'Manage antenatal (ANC) care', 'lis', 'Register ANC patients, record visits, and print the antenatal card', ['admin', 'nurse', 'doctor']],
  ['appointments.write', 'Manage appointments', 'lis', 'Schedule follow-up appointments and queue a patient to the doctor who asked for one', ['admin', 'doctor', 'reception']],
  ['lis.specimen.write', 'Manage specimens', 'lis', 'Collect, dispatch, QC, route specimens; enter results', ['admin', 'lab']],
  ['lis.results.review', 'Review LIS results', 'lis', 'Manager review of pending results', ['admin', 'lab']],
  ['lis.results.read', 'View LIS result history', 'lis', 'View specimen/result history', ['admin', 'lab', 'doctor']],
  ['lis.clinical.insights.write', 'Generate clinical insights', 'lis', 'Request AI-assisted differential diagnosis suggestions for a visit', ['admin', 'doctor']],
  ['referrals.write', 'Manage patient referrals', 'referrals', 'Create, accept, reject, or cancel an inter-branch patient referral', ['admin', 'doctor']],

  ['radiology.read', 'View radiology requests', 'radiology', 'View the radiology request queue and reports', ['admin', 'doctor', 'lab']],
  ['radiology.write', 'Manage radiology requests', 'radiology', 'Confirm a radiology request and file its report', ['admin', 'doctor', 'lab']],

  ['reports.dhis2.view', 'View DHIS2 monthly report', 'reports', 'Compute, review, save, print/export the monthly HMIS facility report', ['admin', 'reports']],
  ['reports.dhis2.finalize', 'Finalize DHIS2 monthly report', 'reports', 'Lock a DHIS2 report as final and manage its lab/inventory mappings', ['admin']],

  ['pharmacy.read', 'View pharmacy data', 'pharmacy', 'Drugs, stock levels, pricing history, reports', ['admin', 'pharmacy', 'doctor']],
  ['pharmacy.write', 'Manage pharmacy operations', 'pharmacy', 'Drugs, dispensing, returns, charges, pricing', ['admin', 'pharmacy']],
  ['pharmacy.prescribe', 'Manage clinical prescriptions', 'pharmacy', 'Patient allergies, prescriptions, interaction checks', ['admin', 'pharmacy', 'doctor']],
  ['pharmacy.admin', 'Manage pharmacy settings', 'pharmacy', 'Pharmacy module settings', ['admin']],
  ['pharmacy.controlled_substances.read', 'View controlled substances log', 'pharmacy', 'Controlled substances register and audit log', ['admin', 'pharmacy']],

  ['procurement.read', 'View procurement data', 'procurement', 'Suppliers, requisitions, POs, GRNs, reports', ['admin', 'finance_manager', 'accountant', 'procurement']],
  ['procurement.write', 'Manage procurement', 'procurement', 'Suppliers, requisitions, GRNs, attachments', ['admin', 'finance_manager', 'accountant', 'procurement']],
  ['procurement.purchase_orders.write', 'Manage purchase orders', 'procurement', 'Create/edit purchase orders and PO items', ['admin', 'procurement']],
  ['procurement.settings.manage', 'Manage procurement settings', 'procurement', 'Clinic-level procurement settings', ['admin']],

  // Payroll data is sensitive (salaries, bank details) — admin-only by default.
  // A tenant that wants to delegate this can create a custom role via Roles &
  // Privileges and grant these exact keys, rather than this app adding a new
  // 'hr' role to the users.role ENUM (real MySQL-widen-list friction for no
  // real benefit over the existing custom-role mechanism).
  ['hr.employees.read', 'View employees & consultants', 'hr', 'Employee/consultant profiles and salary structures', ['admin']],
  ['hr.employees.write', 'Manage employees & consultants', 'hr', 'Create/edit employees, consultants, and salary components', ['admin']],
  ['hr.payroll.read', 'View payroll', 'hr', 'Payroll runs, payslips, and payroll history', ['admin']],
  ['hr.payroll.write', 'Run and manage payroll', 'hr', 'Create, approve, and pay payroll runs', ['admin']],
  ['hr.salary_advances.read', 'View salary advances', 'hr', 'Employee cash advances and repayment history', ['admin']],
  ['hr.salary_advances.write', 'Manage salary advances', 'hr', 'Request, approve, disburse, and record repayment of salary advances', ['admin']],
  ['hr.leave.read', 'View leave', 'hr', 'Leave types, requests, and employee leave balances', ['admin']],
  ['hr.leave.write', 'Manage leave', 'hr', 'Create, approve, and reject leave requests', ['admin']],

  ['setup.facilities.manage', 'Manage facilities & branches', 'setup', 'Create/edit/delete facilities and branches', ['admin']],
  ['setup.clinics.manage', 'Manage clinics', 'setup', 'Create/edit/delete clinics', ['admin']],
  ['setup.departments.manage', 'Manage departments', 'setup', 'Create/edit/delete departments', ['admin']],
  ['setup.services.manage', 'Manage service definitions', 'setup', 'Create/edit/delete/seed billable service definitions', ['admin']],
  ['setup.lab_tests.manage', 'Manage lab test catalogue', 'setup', 'Create/edit/delete/seed/bulk-upload lab tests', ['admin']],
  ['setup.api_configurations.manage', 'Manage API keys', 'setup', 'Generate/revoke integration API keys', ['admin']],
  ['approvals.manage', 'Grant approval permissions', 'setup', 'Grant/revoke a user’s per-action approval permission', ['admin']],
  ['setup.facility_settings.manage', 'Manage facility configurations', 'setup', 'Change queue receipt/billing-redirect toggles and the patient number prefix/suffix', ['admin']],

  // Standalone navigation destinations with no single API resource behind
  // them, so no existing privilege above already represents "can see this
  // page" — used only by the frontend sidebar/route guards, not any API route.
  ['pages.dashboard.view', 'View dashboard', 'pages', 'Access to the main dashboard landing page', ['admin', 'reception', 'doctor', 'lab', 'pharmacy', 'reports', 'accountant', 'finance_manager', 'auditor', 'nurse']],
  ['pages.reports.view', 'View reports section', 'pages', 'Access to the Reports section and its sub-reports', ['admin', 'reports', 'finance_manager', 'accountant', 'auditor']],
  ['pages.visits_history.view', 'View patient visits history', 'pages', 'Access to the clinical visits history page', ['admin', 'doctor']],
  ['pages.patients_bill.view', 'View Patient Bills page', 'pages', 'Access to the Patient Bills page', ['admin', 'reception', 'doctor']],
  ['pages.patient_referral.view', 'View Patient Referral page', 'pages', 'Access to the Patient Referral page', ['admin', 'doctor', 'reception', 'nurse']],
  ['pages.lis_registration.view', 'View patient registration page', 'pages', 'Access to the LIS patient registration page', ['admin', 'reception', 'lab']],
  ['pages.setup_lab_tests.view', 'View lab tests setup page', 'pages', 'Access to the lab tests setup page', ['admin', 'doctor', 'lab']],
  ['pages.setup_departments.view', 'View departments setup page', 'pages', 'Access to the departments setup page', ['admin', 'doctor']],
  ['pages.setup_clinics.view', 'View clinics setup page', 'pages', 'Access to the clinics setup page', ['admin', 'doctor']],
  ['pages.setup_facility.view', 'View facility setup page', 'pages', 'Access to the facility setup page', ['admin', 'doctor']],
  ['pages.setup_wards.view', 'View wards setup page', 'pages', 'Access to the wards setup page', ['admin', 'doctor']],
  ['pages.setup_rooms.view', 'View rooms setup page', 'pages', 'Access to the rooms setup page', ['admin', 'doctor']],
  ['pages.setup_configurations.view', 'View configurations setup page', 'pages', 'Access to the facility configurations setup page', ['admin', 'doctor']],
  ['pages.procurement_requisitions.view', 'View purchase requisitions page', 'pages', 'Access to the purchase requisitions page', ['admin', 'finance_manager', 'accountant', 'doctor', 'pharmacy', 'procurement']],
  // Deliberately never granted to any role — Setup > Security manages roles,
  // privileges, and user accounts, so it must stay permanently admin-only,
  // exactly like the backend routes it fronts (see roles.js, users.js
  // create/delete) — admin passes via the unconditional bypass, never via a
  // grant, so this can never be delegated by mistake through the UI it itself
  // controls.
  ['pages.security.access', 'View Security & User Management', 'pages', 'Permanently admin-only — manages roles, privileges, and user accounts', []],
];

const PRIVILEGES = CATALOG.map(([privilege_key, name, module, description]) => ({ privilege_key, name, module, description }));

const DEFAULT_ROLE_PRIVILEGES = Object.fromEntries(CATALOG.map(([privilege_key, , , , roles]) => [privilege_key, roles]));

module.exports = { SYSTEM_ROLES, PRIVILEGES, DEFAULT_ROLE_PRIVILEGES };

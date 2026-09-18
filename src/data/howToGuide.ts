// Content for the in-app How To / Help page (src/pages/HowTo.tsx). Kept as
// plain data, separate from the page's rendering/search logic, so the guide
// can grow without touching the component — and so search can flatten and
// scan it without caring how it's displayed.
//
// Grouped into the same five top-level sections the sidebar itself uses
// (see Sidebar.tsx's sectionLabel calls) so the guide's structure matches
// the navigation a user already knows, rather than inventing a new one.
//
// Steps are written from a direct read of each page's actual source (button
// labels, field names, required-field markers) rather than guessed from the
// route name — a "how to" guide that describes a button that doesn't exist
// is worse than no guide at all.

export interface GuideEntry {
  /** What this guide is called — matches the sidebar/page label wherever one exists. */
  title: string;
  /** The route this guide is about, if it has one — rendered as a jump-to link. */
  path?: string;
  /** Numbered steps, in the order a user actually performs them. */
  steps: string[];
  /** Optional callout for a required-fields note, gotcha, or who can do this. */
  note?: string;
}

export interface GuideSection {
  id: string;
  title: string;
  entries: GuideEntry[];
}

export const HOW_TO_GUIDE: GuideSection[] = [
  {
    id: 'clinical-workflow',
    title: 'Clinical Workflow',
    entries: [
      {
        title: 'Register a new patient',
        path: '/lis/registration',
        steps: [
          'Open Patient Registry from the sidebar.',
          'Fill in Basic Information: First Name and Last Name (required), Gender, Phone Number, Date of Birth (age fills in automatically), and Residence.',
          'Fill in Insurance & Queue: pick a Scheme if the patient has insurance (defaults to Cash) — this reveals a Membership Number field.',
          'Optionally queue the patient immediately under "Queue on Registration": pick a Clinic, then a Doctor and Room appear to choose from.',
          'Click "Register Patient".',
          'If a matching patient already exists (by phone or name+DOB), a "Patient Already Exists" dialog offers to edit their phone number or queue them instead of creating a duplicate.',
        ],
        note: 'Only First Name and Last Name are required. Search the Patient Directory table below the form before registering, to avoid duplicates.',
      },
      {
        title: 'Record vitals at Triage',
        path: '/triage',
        steps: [
          'Open Triage from the sidebar.',
          'Click a patient in the "Waiting" list on the left (shows Triaged/Not Triaged status and wait time).',
          'Enter Blood Pressure, Pulse, Temperature, Resp. Rate, Weight, Height, SpO2, and Fasting Status — none are required, fill in whatever was measured.',
          'Click "Save Vitals".',
        ],
        note: 'This is nurse-only vitals entry. Chief complaint and full history are recorded later by the doctor on the Clinical page.',
      },
      {
        title: 'Read the Laboratory Queue display',
        path: '/lis/queue',
        steps: [
          'Open Queue Display from the sidebar — this is a read-only monitor screen, meant for a waiting-room TV.',
          '"Now Calling" shows the most recently called patients; "Waiting List" shows everyone still waiting with a live wait-time counter.',
          'Toggle "Audio On" to have the screen announce each patient by voice as they are called from the Clinical page.',
        ],
      },
      {
        title: 'Consult a patient (vitals, history, tests, admission requests)',
        path: '/lis/orders',
        steps: [
          'Open Clinical from the sidebar — use the "Place Order" tab for a new/ongoing visit.',
          'Select the patient from the queue (use "Call" to announce them on the Queue Display) or search for them.',
          'Record Chief Complaint, vitals (pre-filled if triage already entered them), and history (presenting illness, medical/surgical/family/social/economic history, allergies, impressions).',
          'Click "Next: Select Tests" to pick lab tests and/or billable services — a Cash/Scheme toggle appears if the patient has insurance.',
          'Add clinical notes, then click "Submit Order" — this bills the selected tests/services and sends tests to the LIS collection queue.',
          'Switch to the "Visit Summary" tab to manage an already-ordered visit: save a diagnosis, prescribe medicine, request another service, request an inpatient admission, or close the visit.',
        ],
      },
      {
        title: 'Request an inpatient admission from a consultation',
        path: '/lis/orders',
        steps: [
          'On the Clinical page, open the patient\'s Visit Summary tab.',
          'Click "Request Admission" and enter a Diagnosis (required) and reason.',
          'Submit — the request appears on Inpatient → Admissions for ward staff to process (Process or Decline).',
        ],
      },
      {
        title: 'Prescribe medication during a consultation',
        path: '/lis/orders',
        steps: [
          'On the Clinical page\'s Visit Summary tab, find "Prescribe Medicine".',
          'Pick a Drug from the catalog, or tick "Not in stock — patient buys from an outside pharmacy" and type the medicine name.',
          'Set Dose, Frequency, and Duration (days) — Qty is suggested automatically but can be typed manually.',
          'Add the line, then submit — this creates the prescription and bills it (external/no-price items are skipped from billing).',
        ],
      },
      {
        title: 'Dispense a prescription or make a walk-in pharmacy sale',
        path: '/pharmacy-dispensing',
        steps: [
          'Open Pharmacy → Dispensing from the sidebar.',
          'Search for and select the patient — any pending prescription for them loads automatically. For a walk-in with no record, use "+ Register Walk-in patient".',
          'Use the "Add Product" card to pick a drug, quantity, and price (editable, with an optional discount) and click "Add" — this adds to the existing prescription or starts a new walk-in sale/bill.',
          'Under "Record Payment", enter the amount and method (Cash, Card, Bank Transfer, Cheque, or Credit) and click "Save Payment".',
          'Tick which line items to dispense and click "Dispense Selected" — this is blocked while there is an outstanding cash balance (insurance-billed items are exempt).',
        ],
        note: 'Dispensing requires an open cashier shift for taking payment (a "Start Shift" banner appears if none is open) — dispensing itself does not require one.',
      },
      {
        title: 'Process a pharmacy return',
        path: '/pharmacy-returns',
        steps: [
          'Open Pharmacy → Returns and click "Process Return".',
          'Search for the original Dispensing Record by dispensing number, drug, or patient.',
          'Enter the Quantity to Return (capped at what\'s left un-returned) and pick a Reason: Expired, Damaged, Unused, Patient Request, Wrong Drug, or Other.',
          'Check the live Estimated Refund, then click "Process Return" — this posts a refund and adjusts pharmacy stock.',
        ],
      },
      {
        title: 'Set up a ward',
        path: '/setup/wards',
        steps: [
          'Open Setup → Wards (or the Inpatient section) and click "Add Ward".',
          'Enter Ward Name and Ward Code (required), Capacity, Ward Type (General/Surgical/Maternity/Pediatric/ICU/Emergency/Psychiatric/Isolation), and a Billing Service — this sets the daily bed rate.',
          'Click "Create Ward".',
        ],
      },
      {
        title: 'Add rooms and beds to a ward',
        path: '/setup/rooms',
        steps: [
          'Open Setup → Rooms and click "Add Room".',
          'Choose Room Type: Ward (pick the ward it belongs to) or Consultation.',
          'Enter the Room Number.',
          'For a ward room, add beds right in the same dialog: type a Bed Number and click add, repeating for each bed, before saving.',
        ],
      },
      {
        title: 'Admit a patient',
        path: '/inpatient/admissions',
        steps: [
          'Open Inpatient → Admissions.',
          'If there\'s a pending admission request from a doctor, click "Process" on it to pre-fill the form (or "Decline").',
          'Otherwise, search and select the Patient, then pick Ward → Room → Bed (only available beds are selectable).',
          'Set Admission Type (Planned/Emergency/Transfer), Attending Doctor, and enter the Admission Reason (required) and a preliminary diagnosis.',
          'Click "Admit Patient" — the bed is marked occupied and the patient appears under Admitted Patients.',
        ],
      },
      {
        title: 'Chart an inpatient stay (notes, medications, labs, nursing)',
        path: '/inpatient/patients',
        steps: [
          'Open Inpatient → Admitted Patients and click "View" on the patient.',
          'Use the tabs to record: Doctor Notes (assessment, vitals, diagnosis, treatment plan, progress status), Prescriptions, Nursing notes, Drug Administration (mark each dose given/refused/missed), Lab Requests, and Radiology.',
          'Every priced prescription, lab test, or imaging request placed here bills automatically to the patient\'s active inpatient bill.',
          'Use "View Bills" in the page header at any time to jump straight to this patient\'s current bill.',
        ],
      },
      {
        title: 'Discharge a patient',
        path: '/inpatient/patients',
        steps: [
          'Open the patient\'s page from Admitted Patients and click "Discharge" in the header.',
          'Select the Outcome — Alive, Deceased, or Absconded (required).',
          'Enter the discharge reason and a discharge summary (both required).',
          'Confirm — this frees the bed, finalizes ward charges, and closes the admission.',
          'Afterward, use the "Discharge Summary" button (shown in place of Discharge) to generate a full printable summary of the stay — notes, medications given, and lab/radiology results.',
        ],
        note: 'Discharge cannot be undone from the app — double-check the outcome and summary before confirming.',
      },
      {
        title: 'Filter admitted vs. discharged patients',
        path: '/inpatient/patients',
        steps: [
          'On the Admitted Patients page, use the Status filter (In Bed / Discharged / All) to switch between who is currently admitted and who has left.',
          'Use the Outcome filter (Alive / Deceased / Absconded) to narrow discharged patients further.',
          'Combine with the search box and admission-date range to find a specific stay, or click "Export CSV" for the current filter.',
        ],
      },
      {
        title: 'Collect a lab specimen',
        path: '/lis/collection',
        steps: [
          'Open LIS Module → Specimen Collection.',
          'Patients with pending tests are grouped in the left-hand queue, showing how many tests are "Ready to collect" vs. "Unpaid".',
          'Select a patient, confirm sample details, and click "Print & Collect" for one test or "Print Labels & Collect All" for every ready test at once.',
        ],
        note: 'Only tests that are actually paid for show as collectible — an unpaid test stays blocked until it is paid.',
      },
      {
        title: 'Enter lab results',
        path: '/lis/results-entry',
        steps: [
          'Open LIS Module → Results Entry.',
          'Under the "Worklist" tab, click a patient row, then click a specific test on the right to load its result-entry grid.',
          'Enter each parameter\'s Result Value — reference ranges and a LOW/HIGH/NORMAL flag are shown automatically.',
          'For routine panels, "Fill Common Results" one-click fills typical normal values (still editable).',
          'Click "Save & Next Test" to save and move to the next un-entered test in the order.',
        ],
      },
      {
        title: 'Review and approve lab results',
        path: '/lis/review',
        steps: [
          'Open LIS Module → Manager Review.',
          'Select a patient/order on the left, then a test on the right to view its results.',
          'Click "Approve Results" to release the result, or add Manager Notes and click "Query / Reject" to send it back for correction.',
          'If several tests on the order are ready, "Approve All N Tests" approves them in one click.',
        ],
        note: 'Only users with lab manager/review privileges see this page.',
      },
    ],
  },
  {
    id: 'billing-finance',
    title: 'Billing & Finance',
    entries: [
      {
        title: "Find and pay a patient's bill",
        path: '/patients-bill',
        steps: [
          'Open Patients Bill → Patient Bills from the sidebar.',
          'Search for the patient or bill number, or click "Create New Bill" to start one for a patient (reuses their existing open bill if there is one).',
          'Click "Pay" on a bill — tick specific unpaid items to pay just those, or leave unchecked to pay the full balance.',
          'Enter the Amount, Method (Cash/Card/Bank Transfer/Cheque/Credit), and Reference, then click "Save Payment" ("Create Invoice" for Credit).',
          'A cash or card payment prints a receipt automatically.',
        ],
      },
      {
        title: 'Add or void an item on a bill',
        path: '/patients-bill',
        steps: [
          'Open the bill from Patient Bills to reach its detail page.',
          'Use "Add Service / Product" to pick a service or drug, set quantity/price and an optional discount, and add it to the bill.',
          'An unpaid, uninvoiced line can be voided from its row if it was added in error.',
        ],
      },
      {
        title: 'Create a proforma invoice',
        path: '/proforma-invoices',
        steps: [
          'Open Patients Bill → Proforma Invoice.',
          'Select the patient and add the services/items expected to be charged.',
          'Save and print/download — a proforma is an estimate, not a real charge, useful for insurance pre-authorization or quoting a patient before treatment.',
        ],
      },
      {
        title: 'Set up an insurance scheme and its pricing',
        path: '/scheme-management',
        steps: [
          'Open Accounting → Schemes & Pricing.',
          'Create the scheme (insurer/company name) and its billing terms.',
          'Set scheme-specific prices per service/test/drug where they differ from the cash price — anything left blank falls back to the standard price.',
          'Enroll a patient in the scheme from Patient Registry (the Insurance & Queue section) or their bill, using their Membership Number.',
        ],
      },
      {
        title: 'Manage insurance billing and claims',
        path: '/billing-management',
        steps: [
          'Open Accounting → Billing Management to see scheme-billed invoices awaiting submission to an insurer.',
          'Group and export claims for a scheme over a date range.',
          'Open Claim Details to track a claim\'s status (submitted, part-paid, rejected, settled) and record the insurer\'s payment when it arrives.',
        ],
      },
      {
        title: 'Open and close a cashier shift',
        path: '/cashier/shift',
        steps: [
          'Open Accounting → Cashier Shift and click "Start Shift", entering the Opening Balance.',
          'While open, "Shift Receipts" tracks every payment taken, broken down by Cash/Mobile Money/Card.',
          'To close: click "Close Shift", enter the "Physically Counted Cash" — a Balanced/Over/Short banner appears live (add notes if there\'s a variance), then confirm.',
          'Use "Transfer Cash" any time to move cash at hand to another account (e.g. the bank), or right after closing to bank the counted cash.',
        ],
      },
      {
        title: 'Set up the chart of accounts',
        path: '/accounting/chart-of-accounts',
        steps: [
          'Open Accounting → Chart of Accounts.',
          'Accounts are grouped by type (Asset, Liability, Equity, Revenue, Expense) with a code and name.',
          'Add a new account under the right type, or edit an existing one — most transactions post automatically to the right account, so this screen is mainly for setup or correction.',
        ],
      },
      {
        title: 'Post a manual journal entry',
        path: '/accounting/journal-entries',
        steps: [
          'Open Accounting → Journal Entries and click "New Journal Entry".',
          'Set the Entry Date, Reference, Currency (fetches the live exchange rate automatically), and Description.',
          'Add at least two lines: pick an Account per line and enter either a Debit or a Credit amount — "Add Line" for more.',
          'The entry can only be created once total debits equal total credits (a live Balanced/Unbalanced badge shows this).',
          'New entries start as "draft" — Submit → Approve (or Reject) → Post to hit the ledger; a rejected entry can be reverted to draft.',
        ],
        note: 'Most charges (bills, payroll, supplier payments) post their own journal entries automatically — use this only for corrections or entries with no other source screen.',
      },
      {
        title: 'View the General Ledger and financial reports',
        path: '/accounting/general-ledger',
        steps: [
          'Open Accounting → General Ledger to see every posted transaction, filterable by account and date range.',
          'Open Accounting → Financial Reports for the Income Statement and other standard reports over a chosen period.',
          'Open Accounting → Receivables to see outstanding patient/insurance balances.',
        ],
      },
      {
        title: 'Manage exchange rates',
        path: '/accounting/exchange-rates',
        steps: [
          'Open Accounting → Exchange Rates.',
          'Add or update the rate between the facility\'s base currency and any other currency it bills or pays in.',
          'Every multi-currency bill, payment, and report converts using the rate in effect on that transaction\'s date.',
        ],
      },
      {
        title: 'Record a cash transfer between accounts',
        path: '/accounting/cash-transfer',
        steps: [
          'Open Accounting → Cash Transfer.',
          'Choose the source and destination accounts (e.g. cash at hand to bank).',
          'Enter the amount and a note, then confirm — this posts a balanced journal entry automatically.',
        ],
      },
    ],
  },
  {
    id: 'supply-chain',
    title: 'Supply Chain',
    entries: [
      {
        title: 'Add a new inventory item',
        path: '/inventory/items',
        steps: [
          'Open Inventory → Item Master.',
          'Basic Information: Item Name (required), Category, Barcode (scan/type/generate), Unit of Measure, Description — Item Code auto-generates.',
          'Set Unit Cost and Selling Price under Pricing & Costing.',
          'For a brand-new item, set Opening Stock (Quantity on Hand, Expiry Date, Storage Location) — this section becomes read-only stock info once the item exists.',
          'Set Reorder Levels (Min/Max Stock, Reorder Qty, Lead Time) and Tracking Flags (Batch Tracking, Expiry Tracking, Controlled Substance).',
          'Click "Create Item".',
        ],
        note: 'For adding stock to an item that already exists, use Inventory → Transactions instead — the item form no longer edits stock directly.',
      },
      {
        title: 'Bulk-manage items (import, export, reprice)',
        path: '/inventory/items',
        steps: [
          'Use "Export" on the Item Directory to download the current catalog as CSV.',
          'Use "Bulk Upload" to download a template, fill it in, and upload it back to create/update many items at once.',
          'Use "Price Adjustment" to raise or lower selling prices by a percentage (or rebase to a new exchange rate), optionally scoped to one category.',
        ],
      },
      {
        title: 'Set up stock locations',
        path: '/inventory/locations',
        steps: [
          'Open Inventory → Stock Locations.',
          'Add each physical store/shelf/ward stock point that holds inventory (e.g. Main Store, Pharmacy Store, Ward Stock).',
          'Items are received into and issued from a specific location, so stock levels are always tied to where the item actually is.',
        ],
      },
      {
        title: 'Record a stock transaction or transfer',
        path: '/inventory/transactions',
        steps: [
          'Open Inventory → Transactions to see every receipt, issue, adjustment, and transfer.',
          'To move stock between locations, create a transfer: choose the item, quantity, source and destination location.',
        ],
      },
      {
        title: 'Track batches and expiry',
        path: '/inventory/batches',
        steps: [
          'Open Inventory → Batch Tracking.',
          'Every received batch shows its batch/lot number, expiry date, and remaining quantity.',
          'Use this screen to find what is expiring soon or to trace a specific batch back to the orders it was issued against.',
        ],
      },
      {
        title: 'Run a physical stock count',
        path: '/inventory/physical-counts',
        steps: [
          'Open Inventory → Physical Counts and click "New Physical Count".',
          'Choose the Count Type (Full/Cycle/Spot Check) and Location (leave blank for all locations), then "Start Count".',
          'Open the count and "Add Item" per item counted — the system quantity is shown alongside for comparison, and variance is computed automatically.',
          'Click "Complete Count", then "Reconcile & Create Adjustments" to auto-generate an adjustment for every variance found.',
        ],
      },
      {
        title: 'Approve a stock adjustment',
        path: '/inventory/physical-counts',
        steps: [
          'Switch to the "Adjustments" tab.',
          'Click "New Adjustment" to raise one directly: pick the Item, Location, enter the Physical Count, and choose a Variance Reason (Recount Error/Shrinkage/Theft/Damage/Recording Error/Other).',
          'A pending adjustment can be Approved (updates actual stock) or Rejected (with a reason) from its row.',
        ],
      },
      {
        title: 'Check inventory valuation and COGS',
        path: '/inventory/valuation',
        steps: [
          'Open Inventory → Valuation & COGS.',
          'This shows the current value of stock on hand and the cost of goods sold over a period, based on how items were received and issued.',
        ],
      },
      {
        title: 'Add a new supplier',
        path: '/procurement/suppliers-mgmt',
        steps: [
          'Open Procurement → Suppliers.',
          'Fill in Basic Information: Supplier Name (required), Supplier Type, Tax ID.',
          'Add Contact Details and, under Payment & Banking, Payment Terms, Credit Limit, and bank details.',
          'Click "Create Supplier".',
        ],
        note: 'A supplier can be placed on hold (with a reason) from the directory\'s row actions — this blocks new purchase orders against them.',
      },
      {
        title: 'Raise a purchase requisition',
        path: '/procurement/requisitions',
        steps: [
          'Open Procurement → Requisitions.',
          'Pick a Department, Type (Routine/Urgent/Emergency), Required By date, and a Storage Location for the whole requisition.',
          'Under "Add Item", pick an item from that store\'s stock (or "Not in store?" to type one manually), set Qty and Est. Unit Price, and click "Add Item to List".',
          'Click "Create Requisition", then "Submit for Approval" once ready.',
        ],
      },
      {
        title: 'Turn an approved requisition into a purchase order',
        path: '/procurement/requisitions',
        steps: [
          'Open the approved requisition\'s detail and click "Create Purchase Order".',
          'Pick the Supplier (required), Required Delivery Date, Payment Terms, and Currency — amounts convert automatically using the live exchange rate.',
          'Click "Create Purchase Order" — this posts the PO and moves you to Purchase Orders.',
        ],
      },
      {
        title: 'Create and approve a purchase order',
        path: '/procurement/purchase-orders',
        steps: [
          'Open Procurement → Purchase Orders and click "New Purchase Order" (or convert a requisition, see above).',
          'Choose the Supplier, dates, payment terms, currency, and add line items.',
          'Click "Create Purchase Order" — it starts as Draft.',
          'Move it forward with "Submit for Check" → "Approve" → "Authorize". Only an Approved or Authorized PO can be received against.',
        ],
      },
      {
        title: 'Receive goods against a purchase order',
        path: '/procurement/goods-receipt',
        steps: [
          'Open Procurement → Goods Receipt.',
          'Select the Purchase Order (only approved/authorized POs are offered) — this pre-fills the location and line items.',
          'Set the Received Location and Overall Condition, and adjust each line\'s Received Qty, Condition, Batch #, and Expiry Date.',
          'Click "Create GRN", then "Mark Inspected" once checked, and finally "Accept" (creates the stock receipt) or "Reject" it with a reason.',
        ],
      },
      {
        title: 'Record a daily expense or pay a supplier bill',
        path: '/procurement/daily-expenses',
        steps: [
          'Open Procurement → Expenses.',
          'On the Expenses tab, click "Add Expense": set Date, Category, Description, Amount, Payment Method, and the account to deduct from — it then needs Approve/Reject from a reviewer.',
          'On the Bills tab, a supplier bill needs 3 approvals before "Pay" unlocks; paying prints a downloadable voucher.',
          'The Consultant Bills tab pays consultant fee bills the same way.',
        ],
      },
      {
        title: 'Run procurement reports',
        path: '/procurement/reports',
        steps: [
          'Open Procurement → Reports.',
          'Filter by date range and/or supplier to see spend, outstanding bills, and purchase order history.',
          'Export to CSV or generate a printable report from the totals shown.',
        ],
      },
    ],
  },
  {
    id: 'human-resources',
    title: 'Human Resources',
    entries: [
      {
        title: 'Add an employee or consultant',
        path: '/hr/employees',
        steps: [
          'Open Human Resources → Employees (salaried staff) or Consultants & Doctors (fee-based providers) and click "Add New Employee".',
          'Enter First Name and Last Name (required), plus gender, DOB, national ID, phone, email, address, job title, department, hire date, and contract type.',
          'Add bank details for payment and, optionally, link the person to a user account so they can log in.',
          'Submit to save — then open their profile to set salary components and a consultant fee percentage where relevant.',
        ],
      },
      {
        title: "Manage an employee's salary structure",
        path: '/hr/salary-structures',
        steps: [
          'Open Human Resources → Salary Structures, or open it directly from an employee\'s profile.',
          'Add allowance or deduction line items (e.g. housing allowance, loan repayment) with an amount or a percentage of basic salary.',
          'These components are picked up automatically the next time payroll is run for that employee.',
        ],
      },
      {
        title: 'Record a salary advance',
        path: '/hr/salary-advances',
        steps: [
          'Open Human Resources → Salary Advances.',
          'Select the employee, enter the amount and date given.',
          'The advance is deducted automatically from that employee\'s next payroll run until fully recovered.',
        ],
      },
      {
        title: 'Record and approve leave',
        path: '/hr/leave',
        steps: [
          'Open Human Resources → Leave.',
          'Add a leave request for an employee with the type (annual, sick, unpaid, etc.) and date range.',
          'Approve or reject it — approved leave is reflected in the employee\'s record.',
        ],
      },
      {
        title: 'Run payroll',
        path: '/hr/payroll',
        steps: [
          'Open Human Resources → Payroll and click "Run Payroll" — pick Month, Year, and (optionally) a Payment Account, then "Create Draft".',
          'This drafts one pay line per active employee from their current salary structure. Open the run to review and adjust lines before approving.',
          'Click "Approve" (a payment account must be set first).',
          'Click "Pay All Remaining" to disburse every unpaid line at once, or pay individual lines one at a time.',
          'Download the Payroll Sheet or an individual Payslip from the run\'s detail page at any point.',
        ],
        note: 'Once a run is approved its lines can no longer be edited — check every line carefully before approving.',
      },
    ],
  },
  {
    id: 'analytics-admin',
    title: 'Analytics & Admin',
    entries: [
      {
        title: 'Find a report',
        path: '/reports/dashboard',
        steps: [
          'Open Reports from the sidebar.',
          'Use the left sidebar to browse by group: Overview, Patients & Billing, Clinical, Operations, Inventory, Financial, and Administration — or use "Search reports..." to filter the list directly.',
          'Click a report to open it, then set its date range and any filters (branch, doctor, category) at the top.',
        ],
      },
      {
        title: 'Manage lab tests and services',
        path: '/setup/lab-tests',
        steps: [
          'Open Setup → Lab Tests to add or price a laboratory test (name, code, category, price, sample type).',
          'Open Setup → Services to add or price any other billable service (consultation, imaging, procedure).',
          'Open Setup → Departments to manage the department list used across HR and clinical records.',
        ],
      },
      {
        title: 'Configure facility and branch details',
        path: '/setup/facility',
        steps: [
          'Open Setup → Facility, "Hospital / Clinic Details" tab.',
          'Set the logo, Facility Name, Facility Type, Phone, Email, and Street Address (all required), plus city, license number, and bed capacity.',
          'This is what appears on every printed bill, receipt, payslip, and report.',
          'Use the "Create Branch" tab to add another physical location, with its own phone, address, manager, and opening hours.',
        ],
      },
      {
        title: 'Create roles, users, and set permissions',
        path: '/setup/security',
        steps: [
          'Open Setup → Security.',
          'On the Users tab: enter Full Name and Email (required), pick a Role and any Additional Roles, and click "Create User" — a temporary password is shown once.',
          'On the Roles & Privileges tab: click "New Role", set a Role Key (lowercase, no spaces) and Display Name, then "Create Role".',
          'Pick the role from the dropdown to manage its privileges — move privileges between "All Privileges" and "Role Privileges" using the checkboxes and arrow buttons.',
        ],
        note: 'Only an admin, or a role explicitly granted security access, can see this page.',
      },
      {
        title: 'Configure approval workflows',
        path: '/setup/approvals',
        steps: [
          'Open Setup → Approvals.',
          'Set which actions (e.g. purchase orders over a certain amount, expense claims) require approval, and who can approve them.',
        ],
      },
      {
        title: 'Connect external API integrations',
        path: '/setup/api-configurations',
        steps: [
          'Open Setup → API Configurations.',
          'Add the credentials/endpoint for an external system your facility integrates with (e.g. SMS, insurance verification, lab equipment).',
          'Test the connection before saving, if a test option is shown.',
        ],
      },
      {
        title: 'Update your own profile, password, and signature',
        path: '/profile',
        steps: [
          'Open Profile from the sidebar/account menu.',
          'Click "Edit Profile" to change your Full Name, then "Save Changes" (email, role, and clinic can only be changed by an admin).',
          'Click "Change" under Account Security to change your password — enter your current password, then a new one twice.',
          'Under "Electronic Signature", click "Add Signature" — draw it on the canvas or upload an image, preview it, and click "Save Signature".',
        ],
        note: 'Your saved signature is stamped automatically on documents you approve or sign elsewhere in the app — payslips, lab results, vouchers, prescriptions.',
      },
    ],
  },
];

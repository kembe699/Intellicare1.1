// Content for the in-app How To / Help page (src/pages/HowTo.tsx). Kept as
// plain data, separate from the page's rendering/search logic, so the guide
// can grow without touching the component.
//
// Flat list, one entry per real action a user takes in the system — every
// entry is its own accordion item rather than grouped under a module, and
// every title is phrased "How to <do the thing>" so it reads like an index
// a person can scan or search, not a nav mirror.
//
// Steps are written from a direct read of each page's actual source (button
// labels, field names, required-field markers) rather than guessed from the
// route name — a "how to" guide that describes a button that doesn't exist
// is worse than no guide at all.

export interface GuideEntry {
  /** Always phrased "How to ...". */
  title: string;
  /** The route this guide is about, if it has one — rendered as a jump-to link. */
  path?: string;
  /** Numbered steps, in the order a user actually performs them. */
  steps: string[];
}

export const HOW_TO_GUIDE: GuideEntry[] = [
  {
    title: 'How to Register a New Patient',
    path: '/lis/registration',
    steps: [
      'Open Patient Registry from the sidebar.',
      'Fill in Basic Information: First Name and Last Name (required), Gender, Phone Number, Date of Birth (age fills in automatically), and Residence.',
      'Fill in Insurance & Queue: pick a Scheme if the patient has insurance (defaults to Cash) — this reveals a Membership Number field.',
      'Optionally queue the patient immediately under "Queue on Registration": pick a Clinic, then a Doctor and Room appear to choose from.',
      'Click "Register Patient".',
      'If a matching patient already exists (by phone or name and date of birth), a "Patient Already Exists" dialog offers to edit their phone number or queue them instead of creating a duplicate.',
      'Search the Patient Directory table below the form before registering, to avoid duplicates.',
    ],
  },
  {
    title: 'How to Record Vitals at Triage',
    path: '/triage',
    steps: [
      'Open Triage from the sidebar.',
      'Click a patient in the "Waiting" list on the left (shows Triaged/Not Triaged status and wait time).',
      'Enter Blood Pressure, Pulse, Temperature, Resp. Rate, Weight, Height, SpO2, and Fasting Status — none are required, fill in whatever was measured.',
      'Click "Save Vitals".',
    ],
  },
  {
    title: 'How to Read the Laboratory Queue Display',
    path: '/lis/queue',
    steps: [
      'Open Queue Display from the sidebar — this is a read-only monitor screen, meant for a waiting-room TV.',
      '"Now Calling" shows the most recently called patients; "Waiting List" shows everyone still waiting with a live wait-time counter.',
      'Toggle "Audio On" to have the screen announce each patient by voice as they are called from the Clinical page.',
    ],
  },
  {
    title: 'How to Consult a Patient and Place Lab/Imaging Orders',
    path: '/lis/orders',
    steps: [
      'Open Clinical from the sidebar — use the "Place Order" tab for a new or ongoing visit.',
      'Select the patient from the queue (use "Call" to announce them on the Queue Display) or search for them.',
      'Record Chief Complaint, vitals (pre-filled if triage already entered them), and history: presenting illness, medical/surgical/family/social/economic history, allergies, impressions.',
      'Click "Next: Select Tests" to pick lab tests and/or billable services — a Cash/Scheme toggle appears if the patient has insurance.',
      'Add clinical notes, then click "Submit Order" — this bills the selected tests/services and sends tests to the LIS collection queue.',
    ],
  },
  {
    title: 'How to Manage an Ongoing Visit (Visit Summary)',
    path: '/lis/orders',
    steps: [
      'Open Clinical from the sidebar and switch to the "Visit Summary" tab.',
      'Browse or search visits by date range and patient, then click one to open it.',
      'Click "Save Diagnosis" to add a diagnosis — multiple diagnoses can accumulate and are listed separately.',
      'Use "Request Another Service" to order a follow-up lab test or billable service without leaving the summary.',
      'Click "Close Visit" once the encounter is complete (this asks for confirmation).',
      'Use the print buttons for a standalone prescription printout or a full visit summary (vitals, diagnoses, tests, results, medicines).',
    ],
  },
  {
    title: 'How to Request an Inpatient Admission from a Consultation',
    path: '/lis/orders',
    steps: [
      'On the Clinical page, open the patient\'s Visit Summary tab.',
      'Click "Request Admission" and enter a Diagnosis (required) and reason.',
      'Submit — the request appears on Inpatient → Admissions for ward staff, who can Process or Decline it.',
    ],
  },
  {
    title: 'How to Prescribe Medication During a Consultation',
    path: '/lis/orders',
    steps: [
      'On the Clinical page\'s Visit Summary tab, find "Prescribe Medicine".',
      'Pick a Drug from the catalog, or tick "Not in stock — patient buys from an outside pharmacy" and type the medicine name.',
      'Set Dose, Frequency, and Duration in days — Qty is suggested automatically but can be typed manually.',
      'Add the line, then submit — this creates the prescription and bills it (external or no-price items are skipped from billing).',
    ],
  },
  {
    title: 'How to Dispense a Prescription or Make a Walk-in Pharmacy Sale',
    path: '/pharmacy-dispensing',
    steps: [
      'Open Pharmacy → Dispensing from the sidebar.',
      'Search for and select the patient — any pending prescription for them loads automatically. For a walk-in with no record, use "+ Register Walk-in patient".',
      'Use the "Add Product" card to pick a drug, quantity, and price (editable, with an optional discount) and click "Add" — this adds to the existing prescription or starts a new walk-in sale.',
      'Under "Record Payment", enter the amount and method (Cash, Card, Bank Transfer, Cheque, or Credit) and click "Save Payment".',
      'Tick which line items to dispense and click "Dispense Selected" — this is blocked while there is an outstanding cash balance (insurance-billed items are exempt).',
    ],
  },
  {
    title: 'How to Process a Pharmacy Return',
    path: '/pharmacy-returns',
    steps: [
      'Open Pharmacy → Returns and click "Process Return".',
      'Search for the original Dispensing Record by dispensing number, drug, or patient.',
      'Enter the Quantity to Return (capped at what\'s left un-returned) and pick a Reason: Expired, Damaged, Unused, Patient Request, Wrong Drug, or Other.',
      'Check the live Estimated Refund, then click "Process Return" — this posts a refund and adjusts pharmacy stock.',
    ],
  },
  {
    title: 'How to Set Up a Ward',
    path: '/setup/wards',
    steps: [
      'Open Setup → Wards and click "Add Ward".',
      'Enter Ward Name and Ward Code (required), Capacity, Ward Type (General/Surgical/Maternity/Pediatric/ICU/Emergency/Psychiatric/Isolation), and a Billing Service, which sets the daily bed rate.',
      'Click "Create Ward".',
    ],
  },
  {
    title: 'How to Add Rooms and Beds to a Ward',
    path: '/setup/rooms',
    steps: [
      'Open Setup → Rooms and click "Add Room".',
      'Choose Room Type: Ward (pick which ward it belongs to) or Consultation.',
      'Enter the Room Number.',
      'For a ward room, add beds right in the same dialog: type a Bed Number and click add, repeating for each bed, before saving.',
    ],
  },
  {
    title: 'How to Configure Queue Receipts, Billing Redirect, and Patient Numbering',
    path: '/setup/configurations',
    steps: [
      'Open Setup → Configurations.',
      'Toggle "Print queue receipt" to turn the printed queue slip on or off for this facility.',
      'Toggle "Go straight to billing after queuing" to control whether queuing a patient jumps to their bill — the bill is still created either way.',
      'Set a Prefix and, optionally, a Suffix for this facility\'s patient numbers; the preview below shows an example.',
      'Click "Save Changes".',
    ],
  },
  {
    title: 'How to Admit a Patient',
    path: '/inpatient/admissions',
    steps: [
      'Open Inpatient → Admissions.',
      'If there\'s a pending admission request from a doctor, click "Process" on it to pre-fill the form, or "Decline".',
      'Otherwise, search and select the Patient, then pick Ward → Room → Bed (only available beds are selectable).',
      'Set Admission Type (Planned/Emergency/Transfer), Attending Doctor, and enter the Admission Reason (required) and a preliminary diagnosis.',
      'Click "Admit Patient" — the bed is marked occupied and the patient appears under Admitted Patients.',
    ],
  },
  {
    title: 'How to Chart an Inpatient Stay',
    path: '/inpatient/patients',
    steps: [
      'Open Inpatient → Admitted Patients and click "View" on the patient.',
      'Use the tabs to record Doctor Notes (assessment, vitals, diagnosis, treatment plan, progress status), Prescriptions, Nursing notes, Drug Administration (mark each dose given, refused, or missed), Lab Requests, and Radiology.',
      'Every priced prescription, lab test, or imaging request placed here bills automatically to the patient\'s active inpatient bill.',
      'Use "View Bills" in the page header at any time to jump straight to this patient\'s current bill.',
    ],
  },
  {
    title: 'How to Discharge a Patient',
    path: '/inpatient/patients',
    steps: [
      'Open the patient\'s page from Admitted Patients and click "Discharge" in the header.',
      'Select the Outcome — Alive, Deceased, or Absconded (required).',
      'Enter the discharge reason and a discharge summary (both required).',
      'Confirm — this frees the bed, finalizes ward charges, closes the admission, and cannot be undone afterward.',
      'Afterward, use the "Discharge Summary" button, shown in place of Discharge, to generate a full printable summary of the stay: notes, medications given, and lab/radiology results.',
    ],
  },
  {
    title: 'How to Filter Admitted and Discharged Patients',
    path: '/inpatient/patients',
    steps: [
      'On the Admitted Patients page, use the Status filter (In Bed / Discharged / All) to switch between who is currently admitted and who has left.',
      'Use the Outcome filter (Alive / Deceased / Absconded) to narrow discharged patients further.',
      'Combine with the search box and admission-date range to find a specific stay, or click "Export CSV" for the current filter.',
    ],
  },
  {
    title: 'How to Collect a Lab Specimen',
    path: '/lis/collection',
    steps: [
      'Open LIS Module → Specimen Collection.',
      'Patients with pending tests are grouped in the left-hand queue, showing how many tests are "Ready to collect" versus "Unpaid" — only paid tests can be collected.',
      'Select a patient, confirm sample details, and click "Print & Collect" for one test or "Print Labels & Collect All" for every ready test at once.',
    ],
  },
  {
    title: 'How to Enter Lab Results',
    path: '/lis/results-entry',
    steps: [
      'Open LIS Module → Results Entry.',
      'Under the "Worklist" tab, click a patient row, then click a specific test on the right to load its result-entry grid.',
      'Enter each parameter\'s Result Value — reference ranges and a LOW/HIGH/NORMAL flag are shown automatically.',
      'For routine panels, click "Fill Common Results" to one-click fill typical normal values, which can still be edited.',
      'Click "Save & Next Test" to save and move to the next un-entered test in the order.',
    ],
  },
  {
    title: 'How to Review and Approve Lab Results',
    path: '/lis/review',
    steps: [
      'Open LIS Module → Manager Review. Only users with lab manager/review privileges see this page.',
      'Select a patient/order on the left, then a test on the right to view its results.',
      'Click "Approve Results" to release the result, or add Manager Notes and click "Query / Reject" to send it back for correction.',
      'If several tests on the order are ready, click "Approve All N Tests" to approve them in one click.',
    ],
  },
  {
    title: "How to View a Patient's Visit History",
    path: '/clinical/visits-history',
    steps: [
      'Open Patient Visits History from the sidebar.',
      'Search for the patient by name or patient number.',
      'Browse their past visits, each showing the date, doctor, diagnosis, and services/tests ordered on that visit.',
    ],
  },
  {
    title: 'How to Use the Dashboard',
    path: '/dashboard',
    steps: [
      'Open Dashboard from the sidebar — it is the default landing page for most roles.',
      'Switch the date range with the Today / This Week / This Month buttons, or pick a custom From/To range.',
      'Check "Today at a Glance" for patient counts, queue size, pending lab tests, and low stock alerts.',
      'Use the Quick Actions tiles (Register Patient, Clinical Visit, Lab Queue, Dispense Drugs) to jump straight into a task.',
      'Scroll down for Recent Payments and the Paid vs. Outstanding breakdown for the selected period.',
    ],
  },
  {
    title: "How to Find and Pay a Patient's Bill",
    path: '/patients-bill',
    steps: [
      'Open Patients Bill → Patient Bills from the sidebar.',
      'Search for the patient or bill number, or click "Create New Bill" to start one (reuses their existing open bill if there is one).',
      'Click "Pay" on a bill — tick specific unpaid items to pay just those, or leave unchecked to pay the full balance.',
      'Enter the Amount, Method (Cash/Card/Bank Transfer/Cheque/Credit), and Reference, then click "Save Payment" ("Create Invoice" for Credit).',
      'A cash or card payment prints a receipt automatically.',
    ],
  },
  {
    title: 'How to Add or Void an Item on a Bill',
    path: '/patients-bill',
    steps: [
      'Open the bill from Patient Bills to reach its detail page.',
      'Use "Add Service / Product" to pick a service or drug, set quantity and price with an optional discount, and add it to the bill.',
      'An unpaid, uninvoiced line can be voided from its row if it was added in error.',
    ],
  },
  {
    title: 'How to Create a Proforma Invoice',
    path: '/proforma-invoices',
    steps: [
      'Open Patients Bill → Proforma Invoice.',
      'Select the patient and add the services/items expected to be charged.',
      'Save and print or download — a proforma is an estimate, not a real charge, useful for insurance pre-authorization or quoting a patient before treatment.',
    ],
  },
  {
    title: 'How to Find and Reprint a Receipt',
    path: '/receipts',
    steps: [
      'Open Patients Bill → Receipts from the sidebar.',
      'Search by receipt number, patient name, or date range.',
      'Open a receipt to view its full breakdown, or print/download it again.',
    ],
  },
  {
    title: 'How to Manage Credit Invoices',
    path: '/invoices',
    steps: [
      'Open Patients Bill → Invoices from the sidebar — invoices are created whenever a bill is paid with the Credit method instead of cash.',
      'Search or filter to find an invoice, and open it to see its payment terms and balance.',
      'Record a payment against the invoice as it is settled, the same way as a bill payment.',
    ],
  },
  {
    title: 'How to Set Up an Insurance Scheme and Its Pricing',
    path: '/scheme-management',
    steps: [
      'Open Accounting → Schemes & Pricing.',
      'Create the scheme (insurer or company name) and its billing terms.',
      'Set scheme-specific prices per service, test, or drug where they differ from the cash price — anything left blank falls back to the standard price.',
      'Enroll a patient in the scheme from Patient Registry or their bill, using their Membership Number.',
    ],
  },
  {
    title: 'How to Manage Insurance Billing and Claims',
    path: '/billing-management',
    steps: [
      'Open Accounting → Billing Management to see scheme-billed invoices awaiting submission to an insurer.',
      'Group and export claims for a scheme over a date range.',
    ],
  },
  {
    title: 'How to Track an Insurance Claim',
    path: '/billing-management',
    steps: [
      'From Billing Management, open a specific claim to view Claim Details.',
      'Check its status: submitted, part-paid, rejected, or settled.',
      'Record the insurer\'s payment against the claim when it arrives.',
    ],
  },
  {
    title: 'How to Open and Close a Cashier Shift',
    path: '/cashier/shift',
    steps: [
      'Open Accounting → Cashier Shift and click "Start Shift", entering the Opening Balance.',
      'While open, "Shift Receipts" tracks every payment taken, broken down by Cash/Mobile Money/Card.',
      'To close: click "Close Shift", enter the "Physically Counted Cash" — a Balanced/Over/Short banner appears live, add notes if there\'s a variance, then confirm.',
      'Use "Transfer Cash" any time to move cash at hand to another account, such as the bank, or right after closing to bank the counted cash.',
    ],
  },
  {
    title: 'How to Set Up the Chart of Accounts',
    path: '/accounting/chart-of-accounts',
    steps: [
      'Open Accounting → Chart of Accounts.',
      'Accounts are grouped by type: Asset, Liability, Equity, Revenue, Expense, each with a code and name.',
      'Add a new account under the right type, or edit an existing one.',
    ],
  },
  {
    title: 'How to Post a Manual Journal Entry',
    path: '/accounting/journal-entries',
    steps: [
      'Open Accounting → Journal Entries and click "New Journal Entry".',
      'Set the Entry Date, Reference, Currency (the live exchange rate is fetched automatically), and Description.',
      'Add at least two lines: pick an Account per line and enter either a Debit or a Credit amount, using "Add Line" for more.',
      'The entry can only be created once total debits equal total credits — a live Balanced/Unbalanced badge shows this.',
      'New entries start as "draft" — move them forward with Submit, then Approve or Reject, then Post to hit the ledger; a rejected entry can be reverted to draft.',
    ],
  },
  {
    title: 'How to View the General Ledger',
    path: '/accounting/general-ledger',
    steps: [
      'Open Accounting → General Ledger.',
      'Filter by account and date range to see every posted transaction.',
    ],
  },
  {
    title: 'How to Check Outstanding Balances (Receivables)',
    path: '/accounting/receivables',
    steps: [
      'Open Accounting → Receivables.',
      'View outstanding patient and insurance balances, filterable by date and by scheme.',
    ],
  },
  {
    title: 'How to Run Financial Reports',
    path: '/accounting/reports',
    steps: [
      'Open Accounting → Financial Reports.',
      'Choose the Income Statement or another standard report.',
      'Set the period, then view or export the result.',
    ],
  },
  {
    title: 'How to Manage Exchange Rates',
    path: '/accounting/exchange-rates',
    steps: [
      'Open Accounting → Exchange Rates.',
      'Add or update the rate between the facility\'s base currency and any other currency it bills or pays in.',
      'Every multi-currency bill, payment, and report converts using the rate in effect on that transaction\'s date.',
    ],
  },
  {
    title: 'How to Record a Cash Transfer Between Accounts',
    path: '/accounting/cash-transfer',
    steps: [
      'Open Accounting → Cash Transfer.',
      'Choose the source and destination accounts, for example cash at hand to bank.',
      'Enter the amount and a note, then confirm — this posts a balanced journal entry automatically.',
    ],
  },
  {
    title: 'How to Add a New Inventory Item',
    path: '/inventory/items',
    steps: [
      'Open Inventory → Item Master.',
      'Fill in Basic Information: Item Name (required), Category, Barcode, Unit of Measure, Description — Item Code auto-generates.',
      'Set Unit Cost and Selling Price under Pricing & Costing.',
      'For a brand-new item, set Opening Stock: Quantity on Hand, Expiry Date, Storage Location.',
      'Set Reorder Levels (Min/Max Stock, Reorder Qty, Lead Time) and Tracking Flags (Batch Tracking, Expiry Tracking, Controlled Substance).',
      'Click "Create Item".',
    ],
  },
  {
    title: 'How to Bulk-Import, Export, or Reprice Inventory Items',
    path: '/inventory/items',
    steps: [
      'On the Item Master page, click "Export" to download the current catalog as CSV.',
      'Click "Bulk Upload" to download a template, fill it in, and upload it back to create or update many items at once.',
      'Click "Price Adjustment" to raise or lower selling prices by a percentage, or rebase to a new exchange rate, optionally scoped to one category.',
    ],
  },
  {
    title: 'How to Set Up Stock Locations',
    path: '/inventory/locations',
    steps: [
      'Open Inventory → Stock Locations.',
      'Add each physical store, shelf, or ward stock point that holds inventory, for example Main Store, Pharmacy Store, or Ward Stock.',
      'Items are received into and issued from a specific location, so stock levels are always tied to where the item actually is.',
    ],
  },
  {
    title: 'How to Record a Stock Transaction or Transfer',
    path: '/inventory/transactions',
    steps: [
      'Open Inventory → Transactions to see every receipt, issue, adjustment, and transfer.',
      'To move stock between locations, create a transfer: choose the item, quantity, source location, and destination location.',
    ],
  },
  {
    title: 'How to Track Batches and Expiry',
    path: '/inventory/batches',
    steps: [
      'Open Inventory → Batch Tracking.',
      'Every received batch shows its batch/lot number, expiry date, and remaining quantity.',
      'Use this screen to find what is expiring soon or to trace a specific batch back to the orders it was issued against.',
    ],
  },
  {
    title: 'How to Run a Physical Stock Count',
    path: '/inventory/physical-counts',
    steps: [
      'Open Inventory → Physical Counts and click "New Physical Count".',
      'Choose the Count Type (Full/Cycle/Spot Check) and Location, leaving Location blank for all locations, then click "Start Count".',
      'Open the count and click "Add Item" per item counted — the system quantity is shown alongside for comparison, and variance is computed automatically.',
      'Click "Complete Count", then "Reconcile & Create Adjustments" to auto-generate an adjustment for every variance found.',
    ],
  },
  {
    title: 'How to Approve a Stock Adjustment',
    path: '/inventory/physical-counts',
    steps: [
      'Switch to the "Adjustments" tab on the Physical Counts page.',
      'Click "New Adjustment" to raise one directly: pick the Item, Location, enter the Physical Count, and choose a Variance Reason (Recount Error/Shrinkage/Theft/Damage/Recording Error/Other).',
      'A pending adjustment can be Approved, which updates actual stock, or Rejected with a reason, from its row.',
    ],
  },
  {
    title: 'How to Check Inventory Valuation and COGS',
    path: '/inventory/valuation',
    steps: [
      'Open Inventory → Valuation & COGS.',
      'Review the current value of stock on hand and the cost of goods sold over a period, based on how items were received and issued.',
    ],
  },
  {
    title: 'How to Add a New Supplier',
    path: '/procurement/suppliers-mgmt',
    steps: [
      'Open Procurement → Suppliers.',
      'Fill in Basic Information: Supplier Name (required), Supplier Type, Tax ID.',
      'Add Contact Details and, under Payment & Banking, Payment Terms, Credit Limit, and bank details.',
      'Click "Create Supplier".',
      'A supplier can be placed on hold with a reason from the directory\'s row actions, which blocks new purchase orders against them.',
    ],
  },
  {
    title: 'How to Raise a Purchase Requisition',
    path: '/procurement/requisitions',
    steps: [
      'Open Procurement → Requisitions.',
      'Pick a Department, Type (Routine/Urgent/Emergency), Required By date, and a Storage Location for the whole requisition.',
      'Under "Add Item", pick an item from that store\'s stock, or click "Not in store?" to type one manually, set Qty and Est. Unit Price, and click "Add Item to List".',
      'Click "Create Requisition", then "Submit for Approval" once ready.',
    ],
  },
  {
    title: 'How to Turn a Requisition into a Purchase Order',
    path: '/procurement/requisitions',
    steps: [
      'Open the approved requisition\'s detail and click "Create Purchase Order".',
      'Pick the Supplier (required), Required Delivery Date, Payment Terms, and Currency — amounts convert automatically using the live exchange rate.',
      'Click "Create Purchase Order" — this posts the PO and moves you to Purchase Orders.',
    ],
  },
  {
    title: 'How to Create a Purchase Order',
    path: '/procurement/purchase-orders',
    steps: [
      'Open Procurement → Purchase Orders and click "New Purchase Order".',
      'Choose the Supplier, dates, payment terms, currency, and add line items.',
      'Click "Create Purchase Order" — it starts as Draft.',
      'Move it forward with "Submit for Check", then "Approve", then "Authorize". Only an Approved or Authorized PO can be received against.',
    ],
  },
  {
    title: 'How to Receive Goods Against a Purchase Order',
    path: '/procurement/goods-receipt',
    steps: [
      'Open Procurement → Goods Receipt.',
      'Select the Purchase Order — only approved or authorized POs are offered — which pre-fills the location and line items.',
      'Set the Received Location and Overall Condition, and adjust each line\'s Received Qty, Condition, Batch #, and Expiry Date.',
      'Click "Create GRN", then "Mark Inspected" once checked, and finally "Accept" to create the stock receipt, or "Reject" with a reason.',
    ],
  },
  {
    title: 'How to Record a Daily Expense',
    path: '/procurement/daily-expenses',
    steps: [
      'Open Procurement → Expenses, "Expenses" tab.',
      'Click "Add Expense" and set the Date, Category, Description, Amount, Payment Method, and the account to deduct from.',
      'Submit — it then needs Approve or Reject from a reviewer before it posts.',
    ],
  },
  {
    title: 'How to Pay a Supplier Bill',
    path: '/procurement/daily-expenses',
    steps: [
      'Open Procurement → Expenses, "Bills" tab.',
      'A supplier bill needs 3 approvals before "Pay" unlocks — click "Approve" to add yours.',
      'Once fully approved, click "Pay" and complete the payment form — this prints a downloadable voucher.',
    ],
  },
  {
    title: 'How to Run Procurement Reports',
    path: '/procurement/reports',
    steps: [
      'Open Procurement → Reports.',
      'Filter by date range and/or supplier to see spend, outstanding bills, and purchase order history.',
      'Export to CSV or generate a printable report from the totals shown.',
    ],
  },
  {
    title: 'How to Add an Employee or Consultant',
    path: '/hr/employees',
    steps: [
      'Open Human Resources → Employees for salaried staff, or Consultants & Doctors for fee-based providers, and click "Add New Employee".',
      'Enter First Name and Last Name (required), plus gender, date of birth, national ID, phone, email, address, job title, department, hire date, and contract type.',
      'Add bank details for payment and, optionally, link the person to a user account so they can log in.',
      'Submit to save, then open their profile to set salary components and a consultant fee percentage where relevant.',
    ],
  },
  {
    title: "How to Manage an Employee's Salary Structure",
    path: '/hr/salary-structures',
    steps: [
      'Open Human Resources → Salary Structures, or open it directly from an employee\'s profile.',
      'Add allowance or deduction line items, such as a housing allowance or loan repayment, with an amount or a percentage of basic salary.',
      'These components are picked up automatically the next time payroll is run for that employee.',
    ],
  },
  {
    title: 'How to Record a Salary Advance',
    path: '/hr/salary-advances',
    steps: [
      'Open Human Resources → Salary Advances.',
      'Select the employee, enter the amount and date given.',
      'The advance is deducted automatically from that employee\'s next payroll run until fully recovered.',
    ],
  },
  {
    title: 'How to Record and Approve Leave',
    path: '/hr/leave',
    steps: [
      'Open Human Resources → Leave.',
      'Add a leave request for an employee with the type — annual, sick, unpaid, and so on — and date range.',
      'Approve or reject it — approved leave is reflected in the employee\'s record.',
    ],
  },
  {
    title: 'How to Run Payroll',
    path: '/hr/payroll',
    steps: [
      'Open Human Resources → Payroll and click "Run Payroll" — pick Month, Year, and optionally a Payment Account, then "Create Draft".',
      'This drafts one pay line per active employee from their current salary structure — open the run to review and adjust lines before approving.',
      'Click "Approve" (a payment account must be set first) — once approved, lines can no longer be edited.',
      'Click "Pay All Remaining" to disburse every unpaid line at once, or pay individual lines one at a time.',
      'Download the Payroll Sheet or an individual Payslip from the run\'s detail page at any point.',
    ],
  },
  {
    title: 'How to Find and Run a Report',
    path: '/reports/dashboard',
    steps: [
      'Open Reports from the sidebar.',
      'Browse the left sidebar by group — Overview, Patients & Billing, Clinical, Operations, Inventory, Financial, Administration — or use "Search reports..." to filter directly.',
      'Click a report to open it, then set its date range and any filters such as branch, doctor, or category at the top.',
    ],
  },
  {
    title: 'How to Manage Lab Tests and Billable Services',
    path: '/setup/lab-tests',
    steps: [
      'Open Setup → Lab Tests to add or price a laboratory test: name, code, category, price, sample type.',
      'Open Setup → Services to add or price any other billable service, such as a consultation, imaging, or a procedure.',
    ],
  },
  {
    title: 'How to Manage Departments',
    path: '/setup/departments',
    steps: [
      'Open Setup → Departments (also reachable from Human Resources → Departments).',
      'Add or edit the department list used across HR records and clinical requisitions.',
    ],
  },
  {
    title: 'How to Configure Facility Details',
    path: '/setup/facility',
    steps: [
      'Open Setup → Facility, "Hospital / Clinic Details" tab.',
      'Set the logo, Facility Name, Facility Type, Phone, Email, and Street Address (all required), plus city, license number, and bed capacity.',
      'This is what appears on every printed bill, receipt, payslip, and report.',
    ],
  },
  {
    title: 'How to Add a Branch Location',
    path: '/setup/facility',
    steps: [
      'Open Setup → Facility, "Create Branch" tab.',
      'Fill in Branch Name, Phone, and Street Address (required), plus city, region, manager details, opening/closing time, and bed capacity.',
      'Save — the new branch appears under the "Branches" tab and becomes selectable in the branch switcher for multi-branch users.',
    ],
  },
  {
    title: 'How to Create a User Account',
    path: '/setup/security',
    steps: [
      'Open Setup → Security, "Users" tab.',
      'Enter Full Name and Email Address (required).',
      'Pick a Role, any Additional Roles, and a branch to assign the user to.',
      'Click "Create User" — a temporary password is shown once, right after creation.',
    ],
  },
  {
    title: 'How to Create Roles and Set Permissions',
    path: '/setup/security',
    steps: [
      'Open Setup → Security, "Roles & Privileges" tab.',
      'Click "New Role", set a Role Key (lowercase, no spaces) and a Display Name, then "Create Role".',
      'Pick the role from the dropdown to manage its privileges — move privileges between "All Privileges" and "Role Privileges" using the checkboxes and arrow buttons.',
    ],
  },
  {
    title: 'How to Configure Approval Workflows',
    path: '/setup/approvals',
    steps: [
      'Open Setup → Approvals.',
      'Set which actions — for example purchase orders over a certain amount, or expense claims — require approval, and who can approve them.',
    ],
  },
  {
    title: 'How to Connect an External API Integration',
    path: '/setup/api-configurations',
    steps: [
      'Open Setup → API Configurations.',
      'Add the credentials and endpoint for an external system your facility integrates with, such as SMS, insurance verification, or lab equipment.',
      'Test the connection before saving, if a test option is shown.',
    ],
  },
  {
    title: 'How to Update Your Profile, Password, and Signature',
    path: '/profile',
    steps: [
      'Open Profile from the sidebar or account menu.',
      'Click "Edit Profile" to change your Full Name, then "Save Changes" — email, role, and clinic can only be changed by an admin.',
      'Click "Change" under Account Security to change your password: enter your current password, then a new one twice.',
      'Under "Electronic Signature", click "Add Signature", then draw it on the canvas or upload an image, preview it, and click "Save Signature".',
      'Your saved signature is stamped automatically on documents you approve or sign elsewhere in the app: payslips, lab results, vouchers, prescriptions.',
    ],
  },
  {
    title: 'How to Switch Branches',
    steps: [
      'If you have access to more than one branch, a branch picker appears in the top bar next to the notification bell.',
      'Open it and select the branch to switch to — the whole app, from patient lists to bills, immediately scopes to that branch.',
    ],
  },
  {
    title: 'How to View Notifications',
    steps: [
      'Click the bell icon in the top bar — a red badge shows how many are unread.',
      'Click a notification to jump straight to what it refers to; unread ones are marked read automatically.',
      'Use "Mark all read" to clear the badge without opening each one.',
    ],
  },
];

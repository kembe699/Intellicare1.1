# IntelliCare — Client Requests Investigation

**Scope:** Read-only investigation of the client's requests: (1) receivables,
payables, credits and revenue; (2) the HR duty roster and its link to
attendance; (3) the procurement cycle. No code, data, schema, routes or config
were changed. One SQL statement was run inside `BEGIN … ROLLBACK` on the local
preview database to confirm a failure (§1.1). Nothing was written.

**Branch read:** `feature/central-categories` (includes the new Categories /
AccountResolver work).

**Reused from `docs/accounting-map/REPORT.md`:** the posting architecture (§3:
`createGLEntry` + `JournalPostingService` both feed `account_ledger`), the
module posting table (§5), and the confirmed gaps (§7). In particular these
were re-checked on this branch and still hold: bill delete with no ledger
reversal, insurance-claim payment posted outside its transaction, GRN posting
not atomic, and no supplier-return route. Those findings are cited below as
"accounting-map §7 #n" rather than investigated again.

**Not covered:** the original request text was cut off partway through Part 3
step 2 ("Request for quotation / supplier quotations /"). Part 3 below traces
the whole procurement cycle as it exists in code. Part 4 (sidebar
arrangement) was sent separately and is included below.

**Demo data note:** figures marked "preview DB" come from the local demo
facility seeded on 2026-10-23 (fictional patients and suppliers, no real data).

---

## Summary

| Area | State |
|---|---|
| AR list / aging | **Three separate implementations**, all computed from `patient_bills`, none from the ledger. They use different age rules (bill date vs due date), different buckets (4 vs 5) and different status filters. |
| AR per insurer/scheme | **Partial.** Receivables post to 1210 for scheme bills, but no screen lists "what each insurer owes". |
| Statements (patient, insurer, supplier) | **Not found.** |
| Insurance claims cycle | **Exists:** create from invoices → submit → accept → part-pay/pay or reject. A shortfall or rejection has **no write-off path** of its own. |
| `patient_receivables` table | **Broken on enum-typed schemas.** Every payment's sync fails silently (confirmed on preview/template). Its endpoints have no UI anyway. |
| AP list / aging | **Exists**, but built from **PO totals (ordered value)**. The ledger's 2100 is built from **GRN values (received value)**. They differ by design. |
| Supplier credits / returns / debit notes | **Not found.** |
| Credit notes (patients) | **API only, no UI.** |
| Patient deposits | **Exists** per patient. No list of all deposit balances. |
| Corporate credit accounts | **Partial.** "Corporate" scheme type exists; its credit limit is stored but never enforced. |
| Revenue reports | Many exist. Cash-basis reports read `receipts`, billed reports read `patient_bills`, P&L reads the ledger. **No reconciliation report.** One report (Revenue by category) is always empty. |
| USD base + SSP | Mostly handled per currency. Exceptions: **hard-coded `'SSP'` conversion target** in three revenue/performance reports, and **payroll silently uses rate 1** when no rate exists. |
| Duty roster | **Not found.** Attendance has one fixed shift per employee and an explicit "no rostering" design. Clock-in has **no schedule check**. |
| Procurement | PR → PO → GRN → supplier bill (3 approvals) → payment exists. **RFQ/quotation comparison, 3-way match, supplier returns, over-receipt guard: missing.** A GRN can be raised against a PO in any status. |
| Sidebar / payments | Money goes out from **7 different menu areas** (Procurement, HR, Theatre, Pharmacy, Patients Bill, Accounting, plus an expense page with no menu entry). Moving payments under Accounting is mostly menu work plus a `mode`/tab prop on existing pages, a few new pages, and **no backend change**. Several orphans found, including a receipt-refund approval step no screen can perform. |

---

## PART 1 — Receivables, payables, credits, revenue

### 1.1 Accounts receivable

#### Patient and insurance receivables list

| Screen / API | Source | What it shows | Ledger? | Currency |
|---|---|---|---|---|
| **Accounting → Receivables** (`src/pages/accounting/Receivables.tsx:44`) → `GET /api/accounting/receivables` (`src/server/routes/accounting.js:839-874`) | `patient_bills` | **Every** bill, including fully paid ones. Due date falls back to bill date + 30 days (`:860`). Status shown as Paid/Overdue/Current is computed in the browser (`Receivables.tsx:57-61`). | No | No currency column returned; mixed-currency bills shown as plain numbers |
| **Billing Management → Receivables & Aging** (`src/pages/BillingManagement.tsx:96-98`) → `GET /api/billing/receivables/aging`, `/overdue`, `/reports/outstanding-balance` (`src/server/routes/billingEnhanced.js:1005-1168`) | `patient_bills` | Open bills, aging, and outstanding **per patient per currency** (`:1149-1162`) | No | Yes: grouped by `bill_currency` (`:1012-1031`) |
| `GET /api/accounting/patient-receivables` and `/patient-receivables/aging` (`accounting.js:877-973`) | `patient_receivables` | Same idea from a separate table | No | No |

- **No frontend caller** was found for the two `patient-receivables` endpoints (grep of `src/pages`, `src/components`).
- **Per scheme/insurer:** not found as a receivables list. The receivable account is chosen per bill, 1210 for scheme bills and 1200 otherwise (`src/server/services/AccountingService.js:314-318`). No screen groups open balances by scheme. The closest is the Revenue report's billed-by-scheme view (`src/server/routes/reportRevenue.js:253-301`), which shows billed amounts, not what's owed.
- **Standalone invoices** (Invoices page, `src/pages/Invoices.tsx`) post their own receivable (`src/server/routes/invoices.js:172-180`). They are not in `patient_bills`, so they **don't appear in any of the AR lists or agings above**.
- **No server permission on the Billing Management GETs:** `billingEnhanced.js:986`, `:1005`, `:1057`, `:1077`, `:1142` have no `authorize(...)` and no branch scoping. Only the global login check applies.

#### `patient_receivables` — the payment sync fails

- A row is created with each bill (`AccountingService.js:452-466`) and topped up on add-services (`:595-599`).
- Each payment tries to update it (`src/server/routes/patientBills.js:2044-2060`) with `status = CASE … 'paid' … 'partial' END`. On a schema where `status` is an **enum**, Postgres rejects text→enum assignment. Confirmed on the preview DB inside a rolled-back transaction: `column "status" is of type enum_patient_receivables_status but expression is of type text`.
- The error is swallowed (`:2058-2060`, `console.warn` only). Preview DB result: all 8 demo bills still show `amount_paid = 0` in `patient_receivables`, although 7 were paid.
- The same `CASE` pattern is used in the top-up (`AccountingService.js:598`).
- **Which real tenants are affected is unclear.** The preview and `tenant_template` schemas have the enum; the schema dump `pgout/1_schema.sql:2160` has `status text`, where the SQL would work.
- Even when it works, the payment sync both lowers `amount_due` **and** raises `amount_paid` (`patientBills.js:2050-2051`). The aging endpoint then computes `amount_due − amount_paid` (`accounting.js:928`), so each payment would be counted twice.
- Discounts, write-offs and credit notes never update this table. The only writers are the three listed above.

#### AR aging

| Implementation | Ages by | Buckets | Statuses included | Currency |
|---|---|---|---|---|
| Reports → AR Aging (`src/pages/reports/ARAgingReport.tsx` → `src/server/routes/reportARAging.js:96-116`) | **bill_date** | 4: 0-30, 31-60, 61-90, 90+ (`:47-54`) | `pending`, `partial` only (`:111`) | **Not handled.** Sums `balance_amount` across all currencies (`:126-132`) |
| Billing Management (`billingEnhanced.js:1005-1054`) | **due_date** | 5: current, 1-30, 31-60, 61-90, 90+ | anything not `paid` with balance > 0 | Per currency |
| `accounting.js:908-973` (no UI) | due_date | 5 | `pending`/`partial`/`overdue` | No |

- A bill switched to credit gets `status='active'` (`invoices.js:124`). The Reports AR Aging (`reportARAging.js:111`) **leaves those bills out**; Billing Management includes them.
- The client's requested buckets (current / 30 / 60 / 90 / 90+) match the Billing Management version, not the Reports version.

#### Statements

**Not found.** The PDF generator only produces invoice, bill and receipt
(`src/server/routes/documents.js:58`, `:112`, `:167`). No statement route or
page was found for patients, insurers or suppliers (grep for
"statement of account", "patient statement", "supplier statement").

#### Insurance claims cycle

| Step | Exists | Where | Ledger |
|---|---|---|---|
| Credit bill → invoice ("Save as credit") | Yes | `components/billing/SaveAsCreditModal.tsx` → `POST /api/invoices` (`invoices.js:88-185`) | Bill-linked: no new entry (the receivable was posted with the bill). Standalone: Dr 1210/1200, Cr revenue (`:172-180`) |
| Create claim (one scheme, one currency, chosen invoices, date range) | Yes | `POST /api/insurance-claims` (`src/server/routes/insuranceClaims.js:160-255`) | None |
| Submit / accept | Yes | `PUT /:id/status` (`:385-430`); history in `insurance_batch_claim_status_history` (`:427`) | None |
| Part-payment / payment | Yes | Same route. Paid amount is spread across the claim's invoices, then their bills (`:437-476`) | Dr 1110 Bank (else 1100), Cr receivable (`:486-511`), outside the route's transaction (accounting-map §7 #20) |
| Rejection | Yes (status + reason) | `:420`. Rejected claims can be edited again (`:539-540`) | **None.** The receivable stays open |
| Write-off of shortfall / bad debt | **Partial** | No claim-level write-off. Only the bill-level write-off below can clear it | — |
| PDF of claim | Yes | `GET /:id/pdf` (`:563`) | — |

#### Write-off, discounts, bad debt

- **Write-off** (`POST /api/billing/bills/:id/write-off`, `billingEnhanced.js:436-509`, called from `BillingManagement.tsx:167`): sets the balance to 0 and status `written_off`. Posts Dr **5700** Bad Debt, Cr the bill's receivable (1200/1210).
- **Discount** (`:322-431`, UI `BillingManagement.tsx:132`): Dr **5230** (created on the fly if missing, `:386-394`), Cr receivable.
- In both, the ledger call runs **without the route's transaction** (`:403`, `:481`), and a ledger failure is only logged (`:420-422`, `:498-500`). The bill can change while the ledger doesn't.

#### Receivables reconciliation

- **Not found:** no screen or report compares the AR list with the 1200/1210 balances (grep for "reconcil" found only cashier shift, physical count and income statement).
- Preview DB: open bill balances 252,450 = ledger 1200 balance 252,450. They match in the demo.
- Known ways they drift apart:
  - **Bill delete:** `patientBills.js:1447-1458` calls `bill.destroy()` with no reversal (accounting-map §7 #1).
  - **Standalone invoices:** in the ledger but not in `patient_bills`.
  - **Invoice cancel:** `invoices.js:288-298` resets the invoice/bill with no ledger reversal of a standalone invoice's posting.
  - **Swallowed ledger failures** in discount, write-off, claim payment and credit note.

### 1.2 Accounts payable

#### Supplier balances

| Screen / API | Source | Notes |
|---|---|---|
| Daily Expenses → supplier bills: `GET /api/daily-expenses/supplier-bills` (`src/server/routes/daily-expenses.js:305-328`) | `purchase_orders` with status `authorized`/`received` | Balance = `total_amount − paid_amount` per PO |
| Supplier profile (`src/pages/procurement/SupplierProfile.tsx:89`) → `GET /api/procurement/suppliers/:id/purchase-orders` (`src/server/routes/procurement.js:1132-1180`) | `purchase_orders` | Billed / paid / outstanding **per currency** |

**AP list vs the 2100 ledger balance: they are built from different things.**

- **2100 is credited at GRN acceptance**, for received quantity × PO unit price (`procurement.js:2103`; the cost is taken from `purchase_order_items.unit_price`, `:1937-1945`).
- **The AP list uses the PO's ordered total** (`daily-expenses.js:314`).
- Partial receipts, and POs that are authorized but not yet received, therefore show as owed while 2100 doesn't include them.
- **Quick supplier bills** (`POST /purchase-orders/quick-bill`, `procurement.js:1050-1120`) are created as `authorized` POs with **no ledger entry**. When paid they post straight to expense (`daily-expenses.js:575-596`), so they never pass through 2100.
- Preview DB: AP list 1,061,950 vs ledger 2100 = 1,060,000. The 1,950 comes from two older POs (PO-2026-0001/0002) marked `received` with GRNs but no 2100 posting. That's consistent with accounting-map §7 #5 (GRN posting not atomic), but the cause is **unclear** (logs not available).

#### AP aging, payments, statements

- **AP aging:** exists in Reports → Procurement (`src/server/routes/reportProcurement.js:222-296`, detail and summary).
  - It ages by **order_date**, because POs have no due date (`:219`).
  - It includes PO statuses `received`, `approved`, `authorized` (`:235`, `:271`), so approved-but-not-authorized POs count as payable.
  - `routes/reports.js:1751-1820` also contains an AP aging query, but no mount of `routes/reports.js` as an API router was found in `index.js`. Whether it's reachable is **unclear**.
- **Supplier payment:** `POST /api/daily-expenses/supplier-bill-payment` (`daily-expenses.js:437-620`). It needs 3 approvals (`:450-456`) and posts Dr 2100 (GRN-booked share), plus an FX difference to 5610, Cr the chosen cash/bank account.
  - **No overpayment guard:** `newPaid` can exceed the total (`:458-461`).
- **Supplier statements:** not found.

#### Consultant and staff payables

- **Consultant bills:** generated from a percentage of consultation revenue (`src/server/routes/hr.js:624`). **Nothing posts at creation**, so there is no payable on the ledger. Payment posts Dr 5110, Cr the chosen account (`daily-expenses.js:642-720`). This is cash basis. Reports: `reportProcurement.js:299-360`.
- **Payroll:** each employee's line posts at payment: Dr 5100/5110 gross, Cr deductions to 2200 or the component's own `account_code`, Cr net pay to the payment account (`src/server/services/PayrollPayment.js:43-61`).
  - **Paying PAYE/NSSF etc. to the authorities** (Dr 2210/2230, Cr bank): not found. It could only be done with a manual journal entry.
  - **FX:** if no exchange rate is found, payroll silently uses **rate 1** (`PayrollPayment.js:33-36`). That matters for a USD-base tenant paying in SSP or the reverse.
- **AP reconciliation:** not found.

### 1.3 Credits

| Item | Exists | Where | How it posts |
|---|---|---|---|
| Patient deposits (2150) | Yes, per patient | `src/server/routes/patientDeposits.js:251` balance, `:274` history, `:288` take deposit, `:353` refund (needs `deposit_refund_approve`). UI in `PatientsBill.tsx`, `BillDetails.tsx` | Take: Dr cash/bank, Cr 2150. Refund: reverse (`:213-225`). Use against a bill: Dr 2150, Cr receivable |
| List of all deposit balances | **Not found** | — | — |
| Patient credit notes | **API only** | `billingEnhanced.js:528-716` (create, approve, apply). **No frontend caller** (grep `credit-notes`) | Apply: Dr the revenue accounts the bill originally posted to (largest first), Cr receivable (`:645-697`). **Adds the credit to the bill's `paid_amount`** (`:615`), so "collected" figures read from bills are inflated |
| Discounts / write-offs | Yes | §1.1 | 5230 / 5700 |
| Credit notes to insurers | Not found as a separate document | — | — |
| Supplier credits, returns, debit notes, overpayment credits | **Not found** | GRN reject works only before acceptance (`procurement.js:2185-2195`) | — |
| Corporate / credit clients billed monthly | **Partial** | Scheme type "Corporate" (`src/pages/SchemeManagement.tsx:33`). Credit bills become invoices; a claim can bundle a scheme's invoices for a date range (`insuranceClaims.js:160-163`) | `is_credit_allowed` / `credit_limit` are saved (`src/server/routes/schemes.js:194-236`) but **never checked anywhere** (grep) |

### 1.4 Revenue reports

| Report | Endpoint | Source | Basis |
|---|---|---|---|
| Income Statement | `reportIncomeStatement.js:390` | `account_ledger`, with `receipts` used to spread cash across revenue lines | Cash by default; `?basis=accrual` optional (`:1-20`) |
| Trial balance / IS / balance sheet (Accounting) | `accounting.js:978-1200` | `account_ledger` via `AccountingService` | Ledger |
| Accounting report (by branch, cash flow, GL, account history, expenses, equity) | `reportAccounting.js:70-411` | `account_ledger` | Ledger |
| Revenue by scheme / branch / payment method / item, detail, trend | `reportRevenue.js:154-430` | `receipts` | Cash collected |
| Billed by branch / scheme / status (outpatient/inpatient by heuristic) | `reportRevenue.js:254-301` | `patient_bills` | Billed |
| Service cost analysis | `reportRevenue.js:433-512` | Revenue from bills, COGS from `account_ledger` (`:490-497`) | Mixed |
| By cashier | `reportBillingByUser.js:47` | `receipts` | Cash |
| By clinic / department | `reportClinicPerformance.js:215` | `patient_bills` + `receipts` | Mixed |
| By doctor | `reportDoctorPerformance.js:192` | `patient_bills` (doctor matched by heuristic) | Billed |
| Dashboard overview | `reportOverview.js:97` | `patient_bills` + `receipts` | Mixed |
| Cancelled transactions | `reportCancelledTransactions.js:57` | `patient_bills` + `receipts` | — |
| Billing Management reports | `billingEnhanced.js:1171-1300` | `patient_bills` / `receipts` | — |
| Billing Management → Revenue by category | `billingEnhanced.js:1203-1240` | `bill_line_items` | **Always empty.** The only writer is `POST /billing/bills/:id/line-items` (`:147-225`), which no screen calls. Preview DB: 0 rows for 8 bills |

- **Do they agree?** There's no automated check. Receipts-based and ledger-based figures diverge wherever a ledger posting was skipped or never reversed: bill delete, swallowed ledger failures, invoice cancel (§1.1, accounting-map §7).
- **Currency:** `reportRevenue.js:95-101`, `reportClinicPerformance.js` and `reportDoctorPerformance.js` (3 occurrences each) convert scheme amounts to a **hard-coded `'SSP'`**. `patientBills.js:637` states that at least one tenant runs a USD base, so on that tenant these figures are converted into the wrong currency.

---

## PART 2 — HR duty roster and attendance

### 2.1 What exists today

| Piece | Where | Notes |
|---|---|---|
| `shifts` (name, start/end time, grace minutes, working days) | `src/server/config/ensureAttendanceTables.js:33-46`; CRUD `src/server/routes/attendance.js:212-285` | `working_days` is saved but **never used** in any calculation (grep) |
| One shift per employee | `employee_shift_assignments` (`ensureAttendanceTables.js:52-60`, `UNIQUE(employee_id)`); assign `attendance.js:287-306` | No history and no dates. The design note says "no rostering, one current shift assignment per employee" (`:9-10`, `:48-50`) |
| Department default shift | `department_shift_defaults` (`:63-99`); write-only route `attendance.js:314-333` | **Never read** by anything (no GET; not used by the view) |
| Attendance records | `attendance_records` (`:102-124`): in/out, site, GPS, method, status, reject reason | |
| Daily summary | `attendance_days` view (`:170-204`) | Lateness and early leave are measured against the employee's **current** shift, so changing a shift rewrites history. Times are compared with `::time`, so night shifts that cross midnight compute wrong late/early minutes |
| Today board, reports, record list, manual correction (audited) | `attendance.js:335`, `:399`, `:458`, `:490`; audit table `:138-147` | Report has days present, hours, late count/minutes, early leave, leave days (`:412-430`). **No absence count** (needs a schedule) and **no overtime** |
| Department heads | `departments.head_employee_id` (`src/server/routes/departments.js:184-256`); per-employee override `employee_approver_overrides`; resolved in `src/server/utils/approverResolution.js:9-35` | Already used for leave and advance approvals by the HOD in the staff portal (`src/server/routes/employeePortal.js:720-830`) |
| Leave | `leave_requests` (`ensureHRTables.js:~360-380`), statuses including `approved_by_hod`, `approved` | Can be used for roster conflict checks |
| Staff portal | `src/pages/staff/StaffClock.tsx`, `StaffLeave.tsx`, `StaffApprovals.tsx`, … | Has an Approvals tab for HODs already |
| Privileges | `src/server/config/permissionsCatalog.js:155-169` (`attendance.view`, `attendance.manage_sites`, `attendance.correct`, `hr.leave.*`, …) | No roster privileges |
| Roster / rota tables | **Not found** | |

### 2.2 How clock-in works and where the roster check goes

`POST /api/employee-portal/attendance/clock` (`employeePortal.js:222-314`) is
**the only place that writes clock-ins** (grep for `INSERT INTO attendance_records`):

1. It checks the QR token and site (`:229-259`), then the geofence (`:261-265`).
2. Duplicate-tap guard (`:275-277`).
3. For `type === 'in'`: rejects if already clocked in (`:280-283`), then sets `shift_date = CURRENT_DATE` (`:284-285`).
4. For `type === 'out'`: uses the open clock-in's `shift_date`, which handles overnight shifts (`:291-293`).
5. Stores the accepted record (`:296`).

**The roster check goes between `:283` and `:284`.** Look up today's roster
entry, or an approved exception, for this employee. If there is none, store a
`rejected` record with a reason (as `:281` does) and return the message.
Rejected taps are already recorded, which gives HR an audit trail of blocked
attempts for free.

Two existing details need care:
- Rejected rows use the JavaScript UTC date (`:257`, `:263`), while accepted rows use the database `CURRENT_DATE` (`:284`). The roster lookup should use one consistent clinic-local date.
- A night shift that starts before midnight must match the roster day it *starts* on, and the early-arrival window may cross midnight.

### 2.3 What's missing

Monthly roster per department; HOD submit → HR approve workflow; roster
visibility (HOD / HR / employee); a schedule-based clock-in rule; unscheduled
duty requests; shift swaps; rostered-vs-attended, absence and overtime
reports; shift types such as Off and On-call; per-date shift history.

### 2.4 Proposed design (not built)

**Shift definitions.** Extend `shifts`:
- `code` (M/E/N/OFF/OC), `kind` (`work` | `off` | `on_call`) and `color`.
- `crosses_midnight` (derived when end ≤ start), `paid_hours`, and `early_window_min` / `late_window_min` for the clock-in window. Keep `grace_minutes` for lateness.
- Keep the current single `employee_shift_assignments` as the fallback for employees not on a roster. That keeps today's behaviour for clinics that don't use rosters.

**Tables:**
- `duty_rosters`: `id`, `clinic_id`, `branch_id`, `department_id`, `period` (YYYY-MM), `status` (`draft` | `submitted` | `approved` | `returned`), `submitted_by`/`at`, `approved_by`/`at`, `return_reason`, `version`. Unique on (department, period).
- `duty_roster_entries`: `roster_id`, `employee_id`, `duty_date`, `shift_id`, `note`. Unique on (roster, employee, date); one shift per employee per day to start.
- `attendance_exceptions` (unscheduled duty requests): `employee_id`, `duty_date`, `shift_id`, `reason`, `status` (`pending` | `approved` | `rejected`), `requested_at`, `decided_by` (employee or user), `decided_at`.
- `shift_swap_requests`: requester and counterpart employee, each one's roster entry, `status` (`pending_counterpart` | `pending_approval` | `approved` | `rejected` | `cancelled`), approver, timestamps.

**Monthly roster workflow:**
- The HOD builds a grid of employees × days.
- Helpers: copy the previous month (realigned to weekdays), bulk fill (select cells → shift), and a weekly pattern repeat.
- Approved leave in the period is overlaid; any working shift on a leave day is flagged as a conflict and blocks Submit until resolved. Missing coverage per day is shown as a warning.
- Draft → Submit → HR Approve or Return (with reason). The HOD edits only while Draft/Returned.
- Changes after approval create a new version and need re-approval. Swaps and exceptions don't reopen the roster.
- The HOD is resolved through the existing `approverResolution.js`, so the leave-approval HOD and the roster HOD are the same person.

**Visibility:**
- HOD: their own department(s), via `departments.head_employee_id` plus overrides.
- HR: all departments.
- Employee: their own month in the staff portal (new "My Roster" tab), plus a read-only department view if the clinic wants it.

**Clock-in rule** (in `employeePortal.js` at the spot in §2.2):
- Allowed if an approved roster entry for today, or yesterday for a night shift, has `kind=work|on_call` and the current time is within `[start − early_window, end]`; or if an approved exception exists.
- Otherwise: blocked, and the record is stored as `rejected` with reason "Not rostered today". The portal then offers "Request unscheduled duty", which notifies the HOD and HR through the existing notification service. Once approved, the employee can tap again.
- Departments with no approved roster for the month fall back to today's behaviour. This is a per-clinic setting, so the rule can be rolled out department by department.

**Swaps:** the employee requests, the counterpart accepts, then the HOD (or HR) approves. On approval the two roster entries are swapped and logged.

**Reports:**
- Rostered vs attended, per employee per day: present, absent (rostered, no clock-in), unrostered attendance, and leave.
- Lateness and early leave against the **rostered** shift of that date. This fixes the "current shift rewrites history" issue.
- Overtime: hours worked beyond the shift's paid hours, plus approved unscheduled duty.
- Monthly CSV export, same pattern as `attendance.js:399-457`.

**Privileges:** `roster.view_own_dept`, `roster.edit_own_dept` (HOD), `roster.approve` (HR), `roster.view_all`, `attendance.exceptions.approve`. The portal side uses the existing HOD resolution, not app privileges.

**Routes (new):** `/api/rosters` (list/get/create/update entries/copy-previous/submit/approve/return), `/api/rosters/exceptions`, `/api/rosters/swaps`, `/api/attendance/reports/roster-vs-actual`; staff portal: `GET /roster`, `POST /roster/exception`, `POST /roster/swap`, plus HOD approval endpoints next to the existing leave ones.

**Pages:** HR → Duty Rosters (department/month picker, grid editor, status bar, conflicts panel); HR → Roster Approvals; staff portal → My Roster, Request Unscheduled Duty, Swap Request; HOD Approvals tab gains exceptions and swaps.

**Effort estimate:**

| Piece | Effort |
|---|---|
| Shift definition extensions (kinds, windows, night shifts) | S |
| Roster tables + CRUD + submit/approve/return workflow | M |
| Roster grid editor (copy previous, bulk fill, leave conflicts) | L |
| Visibility (HOD/HR/employee) + staff portal "My Roster" | M |
| Clock-in rule + unscheduled duty requests + approvals | M |
| Shift swaps (request, counterpart accept, approval) | M |
| Reports: rostered vs attended, absence, lateness by rostered shift, overtime | M |
| Night-shift fix in lateness calculation (replace the `::time` comparison) | S |

---

## PART 3 — Procurement cycle

| # | Step | State | Where | Statuses / approvals | Ledger |
|---|---|---|---|---|---|
| 1 | Purchase requisition (department request) | **EXISTS** | Page `src/pages/procurement/PurchaseRequisitions.tsx`; `POST /api/procurement/purchase-requisitions` (`src/server/routes/procurement.js:517-600`), stores `department`, `cost_center_id` | draft → submitted → approved / rejected / cancelled (`:664-760`). **One approval level** (`pr_approve`) | None (correct) |
| 2 | RFQ / supplier quotations / comparison | **MISSING** (partial: attach a quotation file) | Only an optional "Quotation" attachment on a PO (`PurchaseOrders.tsx:770`, `PurchaseRequisitions.tsx:1205`; storage `procurement.js:41`, `:146`, `:2841`). No RFQ document, no per-supplier quotes, no comparison or selection | — | — |
| 3 | Purchase order | **EXISTS** | `PurchaseOrders.tsx`; `POST /purchase-orders` (`procurement.js:915-1048`), can be created from a PR (`pr_id`) | draft → check → approved → authorized, or cancelled (`:1478-1560`): **three gates** (`po_check`, `po_approve`, `po_authorize`) | None (correct) |
| 4 | Goods receipt (GRN) | **PARTIAL** | `GoodsReceiptNotes.tsx`; `POST /goods-receipt-notes` (`procurement.js:1632-1740`) | pending_inspection → inspected → accepted / rejected (`:1742`, `:1779`, `:2185`); approvals `grn_inspect`, `grn_accept`. **No PO status check:** a GRN can be raised against a draft or cancelled PO (`:1640-1644`). **No over-receipt check.** PO quantities and "received" status update at GRN **creation**, before inspection (`:1701-1730`). GRN numbers come from `COUNT(*)` (`:1647-1648`), so two GRNs created at the same moment can get the same number | Dr inventory (now via `AccountResolver`, item → category), Cr 2100, at **accept**. Not atomic with the stock update (accounting-map §7 #5) |
| 5 | Supplier invoice capture / 3-way match | **MISSING** | GRN stores a free-text `invoice_number` only (`:1634`). Cost always comes from the PO price (`:1937-1945`). No invoice amount, no price/quantity variance (accounting-map §7 #6) | — | — |
| 6 | Supplier bill approval | **EXISTS** | `POST /daily-expenses/supplier-bills/:po_id/approve` (`daily-expenses.js:348-407`) | **3 levels**, a different approver each time unless the person is marked sole approver | — |
| 7 | Supplier payment | **EXISTS** | `POST /daily-expenses/supplier-bill-payment` (`:437-620`) | Needs 3 approvals. **No overpayment guard** (`:458-461`) | Dr 2100 (or expense if there's no GRN), FX difference to 5610, Cr cash/bank |
| 8 | Quick supplier bill (no PO lines) | **EXISTS** | `POST /purchase-orders/quick-bill` (`procurement.js:1050-1120`) | Created as `authorized` | None at creation; expense on payment |
| 9 | Returns to supplier / debit notes | **MISSING** | GRN reject only before acceptance (`:2185-2195`) | — | — |
| 10 | Stock transfer between stores | **EXISTS** | `/api/stock-transfers`, pages `StockTransferRequests.tsx` | — | None (correct) |
| 11 | Supplier performance | **EXISTS** | `procurement.js:401`, `:437` | — | — |
| 12 | Procurement reports | **EXISTS** | `reportProcurement.js` (pending bills, bills due, payments, AP aging, consultant bills); `procurement.js:2555-2840` | — | — |

---

---

## PART 4 — Sidebar arrangement (all payments under Accounting)

### 4.1 Current sidebar tree

Source: `src/components/layout/Sidebar.tsx`.
- Menu data: `navItems` (`:87-101`) and one `NavDropdown` object per group (`:104-248`).
- Render order and section headings: `:469-937`.
- Each item is shown only if the user has its privilege (`:345`, `:351`). A group shows if any of its items is visible.
- **Dropdowns are one level deep:** items are flat; there's no nested sub-group support.
- Page components come from the `<Route>` table in `src/App.tsx`.

| Section (heading) | Group | Item | Route | Privilege | Page component |
|---|---|---|---|---|---|
| — | — | Dashboard | `/dashboard` | `pages.dashboard.view` | `Dashboard` |
| Clinical Workflow | — | Patient Registry | `/lis/registration` | `pages.lis_registration.view` | `LISRegistration` |
| | — | Appointments | `/appointments` | `appointments.write` | `Appointments` |
| | — | Queue Display | `/lis/queue` | `lis.queue.write` | `LISQueue` |
| | Nursing Station | Triage | `/triage` | `lis.triage.write` | `Triage` |
| | | Nursing Procedures | `/nursing/procedures` | `nursing.procedures.write` / `.order` | `NursingProcedures` |
| | | Antenatal Care | `/nursing/antenatal` | `antenatal.write` | `Antenatal` |
| | — | Clinical | `/lis/orders` | `lis.clinical.read` | `LISTestOrders` |
| | — | Radiology | `/radiology` | `radiology.read` | `RadiologyQueue` |
| | — | Patient Referral | `/patient-referrals` | `pages.patient_referral.view` | `PatientReferrals` |
| | Inpatient | Admissions | `/inpatient/admissions` | `inpatient.admissions.write` | `Admissions` |
| | | Admitted Patients | `/inpatient/patients` | `inpatient.admissions.write` | `AdmittedPatients` |
| | Theatre / OR | Operation Requests | `/theatre/requests` | `theatre.view` | `TheatreRequests` |
| | | Operations Board | `/theatre/operations` | `theatre.view` | `TheatreOperations` |
| | LIS Module | Specimen Collection | `/lis/collection` | `lis.results.read` | `LISCollection` |
| | | Results Entry | `/lis/results-entry` | `lis.specimen.write` | `LISResultsEntry` |
| | | Manager Review | `/lis/review` | `lis.results.review` | `LISManagerReview` |
| | Pharmacy | Prescriptions | `/pharmacy-prescriptions` | `pharmacy.prescribe` | `PrescriptionManagement` |
| | | Dispensing | `/pharmacy-dispensing` | `pharmacy.write` | `DispensingWorkflow` |
| | | Returns | `/pharmacy-returns` | `pharmacy.write` | `PharmacyReturns` |
| Billing & Finance | Patients Bill | Patient Bills | `/patients-bill` | `pages.patients_bill.view` | `PatientsBill` |
| | | Proforma Invoice | `/proforma-invoices` | `proforma.write` | `ProformaInvoice` |
| | | Receipts | `/receipts` | `receipts.write` | `Receipts` |
| | | Invoices | `/invoices` | `invoices.write` | `Invoices` |
| | Accounting | Chart of Accounts | `/accounting/chart-of-accounts` | `accounting.write` | `ChartOfAccounts` |
| | | General Ledger | `/accounting/general-ledger` | `accounting.read` | `GeneralLedger` |
| | | Journal Entries | `/accounting/journal-entries` | `accounting.write` | `JournalEntriesPage` |
| | | Receivables | `/accounting/receivables` | `accounting.read` | `ReceivablesPage` |
| | | Fixed Assets | `/accounting/fixed-assets/register` | `assets.view` | `FixedAssetsLayout` → `FixedAssetsRegister` |
| | | Exchange Rates | `/accounting/exchange-rates` | `accounting.rates.write` | `ExchangeRatesPage` |
| | | Cash Transfer | `/accounting/cash-transfer` | `cash_transfers.write` | `AccountingCashTransfer` |
| | | Billing Management | `/billing-management` | `billing.write` | `BillingManagement` |
| | | Schemes & Pricing | `/scheme-management` | `schemes.write` | `SchemeManagement` |
| | | Cashier Shift | `/cashier/shift` | `cashier.write` | `CashierShift` |
| Supply Chain | Inventory | Item Master | `/inventory/items` | `inventory.read` | `ItemMaster` |
| | | Stock Locations | `/inventory/locations` | `inventory.read` | `StockLocations` |
| | | Lab Consumables | `/inventory/lab-test-consumables` | `inventory.read` | `LabTestConsumables` |
| | | Transactions | `/inventory/transactions` | `inventory.read` | `StockTransactions` |
| | | Batch Tracking | `/inventory/batches` | `inventory.write` | `BatchTracking` |
| | | Physical Counts | `/inventory/physical-counts` | `inventory.read` | `PhysicalCounts` |
| | | Valuation & COGS | `/inventory/valuation` | `inventory.adjustments.approve` / `inventory.read` | `ValuationCOGS` |
| | Procurement | Suppliers | `/procurement/suppliers-mgmt` | `procurement.read` | `SuppliersManagement` |
| | | Requisitions | `/procurement/requisitions` | `pages.procurement_requisitions.view` | `PurchaseRequisitions` |
| | | Purchase Orders | `/procurement/purchase-orders` | `procurement.purchase_orders.write` | `PurchaseOrders` |
| | | Goods Receipt | `/procurement/goods-receipt` | `procurement.write` / `pharmacy.write` | `GoodsReceiptNotes` |
| | | **Expenses** | `/procurement/daily-expenses` | `expenses.write` | `DailyExpenses` (tabs: Expenses, Supplier Bills, Consultant Bills — `DailyExpenses.tsx:887-892`) |
| | | Stock Transfers | `/procurement/stock-transfers` | `stock_transfers.use` | `StockTransferRequests` |
| | | Reports | `/procurement/reports` | `procurement.read` | `ProcurementReports` |
| Human Resources | Human Resources | Employees | `/hr/employees` | `hr.employees.read` | `EmployeesManagement` |
| | | Consultants & Doctors | `/hr/consultants` | `hr.employees.read` | `ConsultantsManagement` |
| | | **Departments** | `/setup/departments` | `pages.setup_departments.view` | `Departments` (a Setup page) |
| | | Salary Structures | `/hr/salary-structures` | `hr.employees.read` | `SalaryStructuresManagement` |
| | | Salary Advances | `/hr/salary-advances` | `hr.salary_advances.read` | `SalaryAdvancesManagement` |
| | | Leave | `/hr/leave` | `hr.leave.read` | `LeaveManagement` |
| | | Payroll | `/hr/payroll` | `hr.payroll.read` | `PayrollManagement` |
| | | Requests | `/hr/requests` | `hr.leave.read` | `RequestsInbox` |
| | | Attendance Sites | `/hr/attendance/sites` | `attendance.manage_sites` | `AttendanceSites` |
| | | Attendance | `/hr/attendance` | `attendance.view` | `AttendanceDashboard` |
| Analytics & Admin | — | Reports | `/reports` | `pages.reports.view` | `PasswordVerification` → `/reports/dashboard` |
| | Setup | Lab Tests | `/setup/lab-tests` | `pages.setup_lab_tests.view` | `LabTests` |
| | | Services | `/setup/services` | `clinical.services.manage` | `Services` |
| | | Categories | `/setup/categories` | `pages.setup_categories.view` | `Categories` |
| | | Clinics | `/setup/clinics` | `pages.setup_clinics.view` | `Clinics` |
| | | Facility | `/setup/facility` | `pages.setup_facility.view` | `FacilitySetup` |
| | | Uncoded Diagnoses | `/setup/diagnosis-coding` | `clinical.diagnoses.write` | `UncodedDiagnoses` |
| | | Wards | `/setup/wards` | `pages.setup_wards.view` | `WardsManagement` |
| | | Rooms | `/setup/rooms` | `pages.setup_rooms.view` | `RoomsManagement` |
| | | Configurations | `/setup/configurations` | `pages.setup_configurations.view` | `FacilityConfigurations` |
| | | API Configurations | `/setup/api-configurations` | `setup.api_configurations.manage` | `ApiConfigurations` |
| | | Security | `/setup/security` | `pages.security.access` | `Security` |
| | | Approvals | `/setup/approvals` | `approvals.manage` | `Approvals` |
| | | Store Access | `/setup/store-access` | `stock_transfers.manage` | `LocationAccess` |
| (footer) | — | Profile | `/profile` | — | `Profile` (`Sidebar.tsx:944-964`) |

The staff portal (`/staff/*`: clock, leave, advances, payroll, approvals) is a separate app with its own layout. It isn't part of this sidebar.

### 4.2 Where money is paid out or moved

| Action | Menu location today | Route (page) | Page file | API | Privilege / approval | Ledger postings |
|---|---|---|---|---|---|---|
| Daily expense: create | Procurement → Expenses | `/procurement/daily-expenses` | `pages/procurement/DailyExpenses.tsx:610` | `POST /api/daily-expenses` (`daily-expenses.js:1072`) | `expenses.write` | None |
| Daily expense: approve | same page | same | `DailyExpenses.tsx:501` | `POST /:id/approve` (`:823`) | `expense_approve` (2 levels) | None |
| **Daily expense: pay** | no menu entry (expense detail) | `/procurement/daily-expenses/:id` | `pages/procurement/ExpenseDetail.tsx:84` | `POST /:id/pay` (`:721`) | `expenses.write` | Dr category's expense account (via `AccountResolver`, fallback 5900 → 9999), Cr the account chosen at creation |
| Expense voucher (print) | same detail page | same | `ExpenseDetail.tsx:119` (`printVoucher`) | — | `expenses.read` | — |
| Supplier bill approval | Procurement → Expenses → Supplier Bills tab | `/procurement/daily-expenses` | `DailyExpenses.tsx:467` | `POST /supplier-bills/:po_id/approve` (`:348`) | `supplier_bill_approve` (3 levels) | None |
| **Supplier bill payment** | same tab | same | `DailyExpenses.tsx:628` | `POST /supplier-bill-payment` (`:437`) | `expenses.write` + 3 approvals | Dr 2100 (or inferred expense/5900 if no GRN), FX difference 5610, Cr chosen cash/bank |
| Quick supplier bill (create) | Procurement → Suppliers → supplier profile | `/procurement/suppliers-mgmt/:id` | `SupplierProfile.tsx:148` | `POST /api/procurement/purchase-orders/quick-bill` (`procurement.js:1050`) | `procurement.purchase_orders.write` | None until paid (then as supplier bill payment, direct to expense) |
| Consultant bill: generate | HR → Consultants & Doctors → profile | `/hr/consultants/:id` | `EmployeeProfile.tsx:130-140` | `POST /api/hr/consultants/:id/bills` (`hr.js:582`) | `hr.employees.write` | None |
| **Consultant bill: pay** | Procurement → Expenses → Consultant Bills tab | `/procurement/daily-expenses` | `DailyExpenses.tsx:438` | `POST /consultant-bill-payment` (`daily-expenses.js:642`) | `expenses.write` | Dr 5110, Cr chosen account |
| **Theatre team payouts** | Theatre / OR → Operations Board → operation | `/theatre/operations/:id` | `TheatreOperationDetail.tsx:395` | `POST /api/theatre/operations/:id/team-payouts/pay` (`theatre.js:229`) | `theatre.payout` | Dr 5110, Cr chosen account (`TheatreService.js:43,440,461`) |
| Payroll run: create / approve | HR → Payroll | `/hr/payroll`, `/hr/payroll/:id` | `PayrollManagement.tsx`, `PayrollRunDetail.tsx` | `hr.js:1243`, `:1388` | `hr.payroll.write`, `payroll_run_approve` | None |
| **Payroll payment** (all / one line) | HR → Payroll → run | `/hr/payroll/:id` | `PayrollRunDetail.tsx:107`, `:127` | `POST /payroll/runs/:id/pay` (`hr.js:1532`), `/lines/:lineId/pay` (`:1479`) | `hr.payroll.write` | Dr 5100 (5110 for consultants), Cr deduction accounts (2200 or the component's code), Cr chosen payment account (`PayrollPayment.js:43-61`) |
| Payroll self-confirm (QR) | Staff portal / public link | `/payroll-sign/...`, `/staff/payroll` | `PayrollSign`, `StaffPayroll` | `publicPayroll.js`, `employeePortal.js:420` | signing token | Same as payroll payment |
| **Salary advance: disburse** | HR → Salary Advances | `/hr/salary-advances` | `SalaryAdvancesManagement.tsx:160` | `POST /api/hr/salary-advances/:id/disburse` (`salaryAdvances.js:320`) | `hr.salary_advances.write` | Dr 1250 (auto-created), Cr chosen account (`:358`) |
| **Deposit refund** | Patients Bill → Patient Bills | `/patients-bill` | `PatientsBill.tsx:328` | `POST /api/patient-deposits/:id/refund` (`patientDeposits.js:353`) | `deposit_refund_approve` | Dr 2150, Cr cash/bank (`:213-225`) |
| **Receipt void / refund** | Patients Bill → Receipts | `/receipts` | `Receipts.tsx:182` | `PUT /api/receipts/:id/status` (`receipts.js:589`) | `receipts.write`; without `receipt_void_approve` it goes to `pending_void` / `pending_refund` (`:656-664`) | Reverses the payment entry at its original rate (accounting-map §3) |
| Receipt void/refund approval | **no UI** | — | — | `POST /:id/approve-void`, `/reject-void` (`receipts.js:740`, `:802`) | `receipt_void_approve` | As above |
| **Pharmacy return refund** | Pharmacy → Returns | `/pharmacy-returns` | `PharmacyReturns.tsx:93` | `POST /api/pharmacy-module/returns` (`pharmacyModule.js:1982`) | `pharmacy.write` | Dr 4120 (else 4100), Cr 1100 (else 1105). COGS not reversed (accounting-map §7 #3) |
| **Cash transfer** | Accounting → Cash Transfer | `/accounting/cash-transfer` | `pages/accounting/CashTransfer.tsx:106` | `POST /api/cash-transfers` (`cash-transfers.js:35`) | `cash_transfers.write` | Dr destination, Cr source (both chosen) |
| **Cashier cash hand-over** | Accounting → Cashier Shift | `/cashier/shift` | `CashierShift.tsx:471` | `POST /api/cashier/transfer-cash` (`cashier.js:452`) | `cashier.write` | Dr destination, Cr source. Destination is found by name match, including "petty cash" (`cashier.js:495`; `CashierShift.tsx:256`) |
| Petty cash | **Not found** as a feature | — | — | — | — | Account 1108 exists. Usable only as a cash-transfer destination or as an expense's paid-from account |
| Bank deposit | **Not found** as a feature | — | — | — | — | Possible only as a cash transfer Cash → Bank |
| Supplier statutory remittance (PAYE/NSSF) | **Not found** | — | — | — | — | Manual journal only |

### 4.3 Where money is received

| Action | Menu location today | Page / API | Privilege | Ledger postings |
|---|---|---|---|---|
| Bill payment | Patients Bill → Patient Bills (list and bill detail) | `PatientsBill.tsx:617`, `BillDetails.tsx:684` → `POST /api/patient-bills/:id/payments` (`patientBills.js:1468`) | `bills.collect_payment` + an open cashier shift (`:1490-1505`) | Dr cash/bank (by payment method) or 2150, Cr 1200/1210; FX difference 5610 |
| Receipts list / reprint | Patients Bill → Receipts | `Receipts.tsx` | `receipts.write` | — |
| Patient deposit | Patients Bill → Patient Bills | `PatientsBill.tsx` → `POST /api/patient-deposits` (`patientDeposits.js:288`) | `deposits.write` | Dr cash/bank, Cr 2150 |
| Invoice (credit) payment | Patients Bill → Invoices | `components/billing/RecordPaymentModal.tsx:58` → `POST /api/invoices/:id/payments` (`invoices.js:222`) | `invoices.write` | Dr cash/bank, Cr 1210/1200 |
| Insurance claim payment | Accounting → Billing Management → Insurance Claims tab, and claim detail | `BillingManagement.tsx:533`, `ClaimDetails.tsx:103` → `PUT /api/insurance-claims/:id/status` (`insuranceClaims.js:385`) | `claims.write` | Dr 1110 (else 1100), Cr 1210/1200 |
| Salary advance repayment (cash) | HR → Salary Advances | `SalaryAdvancesManagement.tsx:161` → `POST /:id/repay` (`salaryAdvances.js:395`) | `hr.salary_advances.write` | Dr chosen account, Cr 1250 (`:437`) |
| Salary advance repayment (payroll deduction) | HR → Payroll | Deduction component on the payroll line | `hr.payroll.write` | Cr the deduction's account (1250 if so coded) at payroll payment |
| Pharmacy sale | Pharmacy → Dispensing | Billed through the patient bill; collected on Patients Bill | — | As bill payment |

### 4.4 Proposed sidebar (not built)

Principles:
- **Preparing and requesting stay in their own module.** Departments raise expense requests; HR keeps leave, advance requests, payroll preparation and rosters; Procurement keeps requisitions, POs and GRNs.
- **Every button that pays money out moves to Accounting.**
- **No route is removed; privileges are unchanged.** New URLs are added as aliases that open the same page component in a different mode or tab.

```
BILLING & FINANCE
  Patients Bill                         (unchanged — collection at the counter)
    Patient Bills        /patients-bill
    Proforma Invoice     /proforma-invoices
    Receipts             /receipts
    Invoices             /invoices
  Accounting
    — General —
    Chart of Accounts    /accounting/chart-of-accounts
    General Ledger       /accounting/general-ledger
    Journal Entries      /accounting/journal-entries
    Financial Reports    /accounting/reports                (NEW menu link; page exists, today only reachable from Dashboard)
    Fixed Assets         /accounting/fixed-assets/register
    Exchange Rates       /accounting/exchange-rates
    Schemes & Pricing    /scheme-management
    Cashier Shift        /cashier/shift
    — Receivables —
    A/R & Aging          /accounting/receivables            (later: merge Billing Mgmt's Receivables & Aging tab into this)
    Insurance Claims     /accounting/receivables/claims     → BillingManagement, tab=insurance
    Credit Notes         /accounting/receivables/credit-notes   (NEW page, Part 1 item; API exists)
    Discounts & Write-offs /billing-management              (renamed "Billing Management"; tab=receivables)
    Statements           /accounting/receivables/statements (NEW page, Part 1 item)
    — Payables —
    A/P & Aging          /accounting/payables               (NEW page over reportProcurement ap-aging endpoints)
    Supplier Bills       /accounting/payables/supplier-bills → DailyExpenses, tab=bills (approve + pay)
    Statements           /accounting/payables/statements    (NEW page)
    — Payments —
    Expenses             /accounting/payments/expenses      → DailyExpenses in "payments" mode (approved, awaiting payment → Pay)
    Supplier Payments    /accounting/payments/suppliers     → DailyExpenses, tab=bills, filtered to fully approved
    Consultant Payments  /accounting/payments/consultants   → DailyExpenses, tab=consultant-bills + theatre team payouts list
    Staff Payments       /accounting/payments/staff         (NEW page: unpaid lines of approved payroll runs + approved advances awaiting disbursement)
    Refunds              /accounting/payments/refunds       (NEW page: pending receipt void/refund approvals, deposit refunds, pharmacy return refunds)
    Cash Transfers       /accounting/cash-transfer
    Petty Cash           /accounting/payments/petty-cash    (NEW view: 1108 balance + transfers in + expenses paid from 1108)

SUPPLY CHAIN
  Procurement
    Suppliers            /procurement/suppliers-mgmt         (quick bill stays here: it's raising a bill, not paying it)
    Requisitions         /procurement/requisitions
    Purchase Orders      /procurement/purchase-orders
    Goods Receipt        /procurement/goods-receipt
    Expense Requests     /procurement/daily-expenses         (same URL; "requests" mode: create, track, approve. No Supplier/Consultant tabs, no Pay)
    Stock Transfers      /procurement/stock-transfers
    Reports              /procurement/reports

HUMAN RESOURCES
  Employees, Consultants & Doctors (bill generation stays), Salary Structures,
  Salary Advances (request/approve; Disburse → link to Accounting › Staff Payments),
  Leave, Payroll (prepare/approve; Pay → link to Accounting › Staff Payments),
  Requests, Attendance Sites, Attendance, Duty Rosters (Part 2)
  (Departments item removed from HR — it opens Setup; see 4.5)
```

**Theatre:** "Pay team" on `TheatreOperationDetail` is replaced by a link to Accounting › Consultant Payments. The fee split is still calculated and shown on the operation.

**Keeping URLs and privileges:**
- Every existing route stays in `App.tsx`. `/procurement/daily-expenses` keeps its URL (renamed in the menu only).
- New `/accounting/...` routes reuse the existing components with an `initialTab` / `mode` prop.
- No backend route or privilege changes.

**Caveat on "privileges unchanged":** creating and paying an expense both need `expenses.write` (`daily-expenses.js:721`, `:1072`), and payroll preparation and payment both need `hr.payroll.write`. The move is therefore navigational only: a user who can raise an expense can still reach the Pay screen. Real separation of duties needs new privileges (e.g. `expenses.pay`, `hr.payroll.pay`), listed as an optional follow-up.

**Files that change:**

| File | Kind of change |
|---|---|
| `src/components/layout/Sidebar.tsx` | **Menu config.** New Accounting items. An optional `group` field on `NavItem`, rendered as small sub-headings inside a dropdown, since dropdowns are currently flat. Rename "Expenses" → "Expense Requests". Remove HR "Departments" and add it to Setup. Fix the open-state checks (`:270` misses `/billing-management`, while `:744` includes it). Exact-match highlighting (`:759` etc.) needs a prefix match for the new sub-routes |
| `src/App.tsx` | New alias routes (same components, same `requiredPrivilege`) |
| `src/pages/procurement/DailyExpenses.tsx` | **Split by mode:** accept `mode` (`requests` \| `payments`) and `initialTab`. Requests mode hides the Supplier/Consultant tabs; payments mode lists approved-unpaid |
| `src/pages/procurement/ExpenseDetail.tsx` | Show the Pay button only when opened from Accounting (navigational) |
| `src/pages/BillingManagement.tsx` | Accept `initialTab` for the claims and receivables deep links |
| `src/pages/hr/PayrollRunDetail.tsx`, `src/pages/hr/SalaryAdvancesManagement.tsx` | Replace Pay/Disburse buttons with "Pay in Accounting" links (repayment can stay) |
| `src/pages/theatre/TheatreOperationDetail.tsx` | Replace "Pay team" with a link |
| **New pages** | `pages/accounting/StaffPayments.tsx`, `Refunds.tsx` (includes the missing receipt void/refund approval UI), `PettyCash.tsx`, `Payables.tsx`; plus `CreditNotes.tsx` and `Statements.tsx` from Part 1 |
| Backend | **None** for the move itself. New pages call existing endpoints; Statements, Petty Cash and Payables need read endpoints (Part 1 work) |

### 4.5 Duplicated, misnamed and orphaned items

| Finding | Evidence |
|---|---|
| **HR → Departments opens a Setup page.** Setup's own menu has no Departments item. The HR group collapses when you arrive, because it only stays open for `/hr` paths | `Sidebar.tsx:134`, `:269`; route `App.tsx` `/setup/departments` |
| **Expenses under Procurement** also holds Supplier Bills and Consultant Bills, i.e. all supplier and consultant *payments* | `Sidebar.tsx:122`; `DailyExpenses.tsx:887-892` |
| **Consultant bills split across HR and Procurement:** generated in HR (consultant profile), paid under Procurement → Expenses | `EmployeeProfile.tsx:130-140`; `DailyExpenses.tsx:438` |
| **Payments inside clinical/HR pages:** theatre payouts (Theatre), payroll and advances (HR), deposit refunds (Patients Bill), pharmacy refunds (Pharmacy) | §4.2 |
| **Receivables twice:** Accounting → Receivables and Billing Management → Receivables & Aging, with different logic (Part 1 §1.1) | `Sidebar.tsx:163`, `:167` |
| **Billing Management sits under Accounting** but is really receivables, claims, discounts, write-offs and billing reports | `BillingManagement.tsx:180-184` |
| **Two procurement report pages:** Procurement → Reports (`ProcurementReports.tsx`, `/api/procurement/reports/*`) and Reports → Procurement (`reports/ProcurementReport.tsx`, `/api/reports-v2/procurement`) | `Sidebar.tsx:124`; `App.tsx` `procurement` route |
| **Two accounting report pages:** `/accounting/reports` (`FinancialReports.tsx`) and Reports → Accounting (`reports/AccountingReport.tsx`) | `App.tsx` |
| **Orphan: `/accounting/reports`** — no menu entry; only reachable from a Dashboard button | `Dashboard.tsx:327` |
| **Orphan: `/clinical/visits-history`** (`PatientVisitsHistory`) — no menu entry and no link anywhere | grep of `src/` |
| **Orphan: `/assistant`** — no menu entry; reached through the floating button | `FloatingAssistantButton.tsx:25` |
| **Orphan API: receipt void/refund approval** — requests go to `pending_*` but no screen can approve or reject them | `receipts.js:656-664`, `:740`, `:802` |
| **Orphan API: credit notes** — create/approve/apply exist, no UI | `billingEnhanced.js:528-716` |
| **Orphan: expense detail** is where expenses are paid, but there's no menu entry (reached by clicking an expense) | `ExpenseDetail.tsx:84` |
| Clinical Workflow heading ignores Radiology and Patient Referral when deciding whether to show (a user with only those privileges sees links with no heading) | `Sidebar.tsx:369` vs `:526-532` |
| "Store Access" (stock-transfer permissions) is under Setup, while Stock Transfers is under Procurement | `Sidebar.tsx:246`, `:123` |
| Fixed Assets sub-pages (`/depreciation`, `/reports`) don't highlight the menu item (exact path match on `/register`) | `Sidebar.tsx:759`, `:164` |

---

## Combined, prioritised work list (Parts 1–4)

Effort: S ≈ under 1 day, M ≈ 1–3 days, L ≈ a week or more. "Dep" lists items that must come first.

### P0 — Correctness fixes (money is wrong or a step is blocked)

| # | Item | Part | Effort | Dep |
|---|---|---|---|---|
| 1 | Fix the `patient_receivables` payment sync (enum cast, no double subtraction), or retire the table and its unused endpoints | 1 | S | — |
| 2 | Receipt void/refund approval UI (the `approve-void` / `reject-void` endpoints exist; pending requests are stuck) | 1, 4 | S | — |
| 3 | Supplier payment overpayment guard | 1 | S | — |
| 4 | Payroll: refuse to pay when no exchange rate exists, instead of using 1 | 1 | S | — |
| 5 | Replace hard-coded `'SSP'` with the tenant base currency in the revenue, clinic and doctor reports | 1 | S | — |
| 6 | Credit note apply: stop adding the credit to the bill's `paid_amount` | 1 | S | — |
| 7 | GRN: block receipt against a non-authorized PO, add an over-receipt guard, sequence-safe GRN numbers, and update the PO only on accept | 3 | S–M | — |
| 8 | Bill delete: post a reversing entry, or block delete once posted | 1 | M | — |
| 9 | Discount, write-off, claim payment and credit note: post inside the same transaction; don't swallow failures | 1 | M | — |

### P1 — Sidebar / payments under Accounting (Part 4)

| # | Item | Effort | Dep |
|---|---|---|---|
| 10 | Quick menu fixes: Departments → Setup; add a Financial Reports link; decide on `/clinical/visits-history` (link or remove); open-state and highlight fixes | S | — |
| 11 | Accounting sub-groups (General / Receivables / Payables / Payments) with alias routes; DailyExpenses and BillingManagement `mode`/`initialTab`; rename Expenses → Expense Requests | M | 10 |
| 12 | Staff Payments page (payroll lines + advance disbursements); swap HR Pay/Disburse buttons for links | M | 11 |
| 13 | Refunds page (receipt void/refund approvals, deposit refunds, pharmacy return refunds) | M | 2, 11 |
| 14 | Consultant Payments: add theatre team payouts next to consultant bills; swap the Theatre "Pay team" button for a link | S–M | 11 |
| 15 | Petty Cash view (1108 balance, transfers in, expenses paid from it) | S–M | 11 |
| 16 | Optional: separate "pay" privileges (`expenses.pay`, `hr.payroll.pay`, …) for real separation of duties | M | 11 |

### P2 — Receivables, payables and credits features (Part 1)

| # | Item | Effort | Dep |
|---|---|---|---|
| 17 | One AR aging rule (due date, 5 buckets, per currency, by scheme, including standalone invoices); retire the duplicate implementations | M | 1 |
| 18 | Receivables/payables reconciliation report (lists vs 1200 / 1210 / 2100, with drill-down) | M | 17, 21 |
| 19 | Statements: patient, insurer, supplier (PDF) | M | 17 |
| 20 | Credit Notes page (API exists) | S–M | 6, 11 |
| 21 | Payables page over the existing AP aging endpoints; include quick bills; decide the basis (ordered vs received) | M | 11 |
| 22 | Claim shortfall / rejection write-off at claim level | S | — |
| 23 | Enforce scheme credit limit and "credit allowed" | S–M | — |
| 24 | Rebuild "Revenue by category" from the ledger (today it reads an always-empty table) | S | — |
| 25 | All-patients deposit balances list | S | — |
| 26 | Statutory remittance payments (PAYE/NSSF/NHIF: Dr 2210/2220/2230, Cr bank) under Accounting › Payments | M | 11 |

### P2 — Duty roster (Part 2)

| # | Item | Effort | Dep |
|---|---|---|---|
| 27 | Shift extensions (kinds incl. Off/On-call, windows, night shifts) + fix the night-shift lateness maths | S | — |
| 28 | Roster tables + Draft → Submit → Approve/Return workflow + privileges | M | 27 |
| 29 | Roster grid editor (copy previous, bulk fill, leave conflicts, coverage warnings) | L | 28 |
| 30 | Visibility: HOD / HR / employee ("My Roster" in the staff portal) | M | 28 |
| 31 | Clock-in rule (per-department switch) + unscheduled duty requests and approvals | M | 28, 30 |
| 32 | Shift swaps | M | 28 |
| 33 | Reports: rostered vs attended, absence, lateness by rostered shift, overtime | M | 28 |

### P3 — Procurement (Part 3)

| # | Item | Effort | Dep |
|---|---|---|---|
| 34 | Supplier invoice capture + 3-way match (PO / GRN / invoice) + price variance; AP on received basis | L | 7, 21 |
| 35 | Returns to supplier / debit notes / supplier credits (with stock and 2100 reversal) | M–L | 34 |
| 36 | RFQ: request quotes from several suppliers, record quotes, compare, select → PO | L | — |
| 37 | Multi-level PR approval (configurable levels, like PO) | S–M | — |

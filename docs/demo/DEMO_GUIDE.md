# IntelliCare client demo — guide

A full day at a small Juba hospital (Gudele branch, Sunday 25 October 2026), recorded in the demo
tenant so you can walk a client through it end to end: two patients (one paying cash, one insured
by CIC), the lab, the pharmacy, a supplier order, the cashier's day, HR and the books. Every person,
phone number and company is fictional. Everything was entered through the app itself, logged in as
the staff below, and is tagged **DEMO DATA**.

- **App:** https://intellicare.nilehc.tech
- **Hospital code:** `demo`
- **Branch:** Gudele (all demo staff belong to it)
- **Currency:** SSP. CIC Insurance bills in USD at **1 USD = 7,800 SSP** (rate in force from 22 Oct 2026).

## Logins

| Role | Name | Email | Password |
|---|---|---|---|
| Administrator | Demo Admin | demo@nilehc.tech | DemoAdmin#2026 |
| Reception | Nyandeng Akol | reception@intellicare-demo.ss | Demo#Reception1 |
| Nurse | Rebecca Achan Majok | nurse@intellicare-demo.ss | Demo#Nurse1 |
| Doctor | Dr. James Lado Wani | doctor@intellicare-demo.ss | Demo#Doctor1 |
| Laboratory | Peter Malual Deng | lab@intellicare-demo.ss | Demo#Lab1 |
| Pharmacy | Grace Nyibol Kuol | pharmacy@intellicare-demo.ss | Demo#Pharmacy1 |
| Cashier | Mary Ajak Bol | cashier@intellicare-demo.ss | Demo#Cashier1 |
| Accountant | Samuel Taban Loku | accountant@intellicare-demo.ss | Demo#Accounts1 |
| Procurement | John Garang Akuei | procurement@intellicare-demo.ss | Demo#Procure1 |
| HR Officer | Elizabeth Ayen Chol | hr@intellicare-demo.ss | Demo#HR1 |
| Head of Department | Sister Martha Aluel Deng | hod@intellicare-demo.ss | Demo#HOD1 |

These are demo-only passwords. Change them if the demo tenant is ever shown outside a controlled session.

## Patients

| | Deng Garang Mabior | Achol Ayen Deng |
|---|---|---|
| Patient no. | PTN-000001 | PTN-000002 |
| Pays by | Cash (SSP) | CIC Insurance, member **CIC-JUB-204517** (USD, 30-day credit) |
| Complaint | Fever and headache, 3 days | Cough and fever, 5 days |
| Triage | BP 128/82, pulse 104, T 38.6 °C, SpO₂ 97% | BP 112/74, pulse 98, T 38.1 °C, SpO₂ 95% |
| Lab | Malaria RDT **positive (P. falciparum)**, full blood count | Full blood count, random blood sugar (5.8 mmol/L), urinalysis |
| Diagnosis | B50.9 *P. falciparum* malaria | J06.9 Acute upper respiratory infection |
| Prescription | RX-202610-0001: Coartem 24 tablets, Paracetamol 18 tablets | RX-202610-0011: Amoxicillin 15 capsules, Paracetamol 18 tablets |
| Bill | BILL-2026-281492 — SSP 129,220 | BILL-2026-136801 — USD 23.55 (= SSP 183,690) |
| Paid | Cash: RCP-60727783 (95,000), RCP-60734318 (34,220) | Invoice INV-2610-0001 → claim CLM-2610-0001 → CIC paid USD 23.55 into Bank Account – Main |

Deng's bill: consultation 50,000 + Malaria RDT 15,000 + CBC 30,000 + Coartem 1 pack 20,000 +
Paracetamol 1.8 strips 9,000, plus 18% VAT on the drugs (5,220). Drugs are billed by pack: 18
tablets of a 10-tablet strip is 1.8 strips.

## Documents to open

| What | Number |
|---|---|
| Purchase requisition | PR-2026-0001 |
| Purchase order (Juba Medical Supplies Ltd, SSP 1,710,000) | PO-2026-0001 |
| Goods received into Main Pharmacy Store | GRN-2026-0001 |
| Supplier bill — half paid (SSP 855,000, ref EFT-KCB-2611), half still owed | PO-2026-0001 |
| Office stationery expense, SSP 35,000 | EXP-61457975 |
| Cashier shift — Mary Ajak Bol, opened 50,000, counted 179,220, variance 0 | Shift 1 |

## Staff (HR)

| Employee | Name | Department | Post | Basic (SSP) | Portal code |
|---|---|---|---|---|---|
| EMP-0001 | Rebecca Achan Majok | Nursing | Registered Nurse | 450,000 | 998654 (PIN set: 246810) |
| EMP-0002 | Peter Malual Deng | Laboratory | Laboratory Technologist | 480,000 | 436348 |
| EMP-0003 | Grace Nyibol Kuol | Pharmacy | Pharmacist | 520,000 | 954196 |
| EMP-0004 | Martha Aluel Deng | Nursing | Head of Department | 750,000 | — |

All on the "Clinical staff — standard" structure (housing 60,000 + transport 40,000). Shifts:
Morning 08–16, Evening 16–00, Night 00–08. October rosters for Nursing, Laboratory and Pharmacy
were submitted by the HOD and approved by HR. On 25 October: Rebecca Evening, Peter Morning, Grace
Evening. Rebecca clocked in at the Gudele site through the staff portal (code `demo`, her employee
number and PIN).

## Demo script (about 30 minutes)

1. **Reception** — log in as reception. Open *Patients / Visits History*: two patients registered
   today, one cash, one CIC with member number. Show how Achol was registered under CIC.
2. **Nurse** — log in as the nurse. Open Deng's visit: triage vitals.
3. **Doctor** — log in as the doctor. Deng's consultation notes, the lab order, the result
   (Malaria RDT positive, full CBC with reference ranges), diagnosis B50.9, and the prescription with
   dose, frequency and duration.
4. **Laboratory** — log in as lab. Specimens collected, results entered and approved for both
   patients.
5. **Cashier** — log in as the cashier. Deng's bill BILL-2026-281492 and the two receipts. Note the
   drugs billed by pack and the VAT line.
6. **Pharmacy** — log in as pharmacy. Both prescriptions dispensed; stock: Coartem 39 packs,
   Paracetamol 96.4 strips, Amoxicillin 48.5 strips.
7. **Insurance** — log in as the accountant. Achol's bill in USD at CIC prices, invoice
   INV-2610-0001, claim CLM-2610-0001 with its history (submitted → accepted → paid), and the USD
   payment into the bank at 7,800.
8. **Procurement** — log in as procurement. PR → PO → GRN for Juba Medical Supplies; the supplier
   bill half paid.
9. **End of day** — the cashier's closed shift (variance 0) and the stationery expense (requested,
   approved, paid).
10. **HR** — log in as HR. Employees, salary structure, the approved rosters, Rebecca's clock-in.
11. **Books** — log in as the accountant or admin. Trial balance (balanced, 1,839,220), Income
    Statement with **basis = accrual**: revenue 299,890, cost of sales 25,200, expenses 35,000, net
    239,690. Receivables nil; payables 855,000 to Juba Medical Supplies.
12. **Analytics Assistant** — ask "Give me today's hospital summary", "How many patient visits
    occurred today?", "Which doctor attended to the most patients today?".

## Things to avoid on screen (known issues, fixes pending)

- **Income Statement, cash basis** (the default) shows only the cashier's takings: CIC's payment is
  missing and Deng's VAT is counted as consultation revenue. Use **accrual**.
- **Gudele-only financial reports** show Medical Supplies Expense 2,500 that was reversed on the day,
  and the **cash-flow report** leaves out CIC's bank payment. Use all branches.
- **Laboratory and Pharmacy reports** add CIC's USD amounts to SSP without converting them.
- **Dashboard "visits today"** and **Clinic Performance visits** show 0 (they count an older visits
  table, not LIS visits).
- **Bank Account – Main is negative** (−671,310): the demo has no opening balance, and the supplier
  was paid from the bank.

## Rebuilding or removing the demo

- `scripts/demo/seedClientDemo.mjs` — rebuilds the day through the API (re-runnable: finished steps
  are skipped). Needs `DEMO_ADMIN_PASSWORD`. Progress is kept in `scripts/demo/.demo-state.json`
  (not committed — keep it, the cleanup needs it).
- `scripts/demo/correctDemoLedger.mjs` — the three one-off ledger corrections already applied to
  this demo (only needed for data seeded before the fixes).
- `scripts/demo/cleanupClientDemo.mjs` — removes everything the seed created. Dry run by default;
  `--apply --confirm=tenant_demo` to remove.

// The fixed, standard feature set printed on every quotation as an included
// checklist — one line per module, matching the "Quoted value covers..."
// style of this vendor's existing quotation template rather than a priced
// line-item table (pricing on a quotation is a single bundled total; see
// Quotation model and quotationTemplate.ts).
export interface QuotationFeature {
  name: string;
  description: string;
}

export const QUOTATION_FEATURES: QuotationFeature[] = [
  { name: 'Patient Registration & Queue Management', description: 'Register patients once and route them through registration, triage, and consultation queues automatically.' },
  { name: 'Clinical Consultation & Triage', description: 'Vitals capture, chief complaint, history, diagnosis, and clinical notes for every visit.' },
  { name: 'Laboratory Information System (LIS)', description: 'Test ordering, specimen collection, results entry, and manager review, end to end.' },
  { name: 'Pharmacy & Dispensing', description: 'Prescribing, stock-aware dispensing, and returns, tied directly to patient billing.' },
  { name: 'Inpatient Ward Management', description: 'Ward/room/bed setup, admissions, bedside charting, and discharge with outcome tracking.' },
  { name: 'Billing & Invoicing', description: 'Itemized patient bills, receipts, proforma invoices, and multi-method payment collection.' },
  { name: 'Insurance & Scheme Management', description: 'Scheme-specific pricing, claims tracking, and settlement against insurers.' },
  { name: 'Accounting & General Ledger', description: 'A real chart of accounts, journal entries, and financial reporting — not a bolt-on spreadsheet.' },
  { name: 'Inventory & Procurement', description: 'Stock items, locations, batch/expiry tracking, purchase requisitions through goods receipt.' },
  { name: 'Human Resources & Payroll', description: 'Staff and consultant records, salary structures, and payroll runs that post to the ledger.' },
  { name: 'Reporting & Analytics', description: 'Operational and financial reports across patients, billing, inventory, and staff performance.' },
  { name: 'Role-Based Access & Multi-Branch Support', description: 'Fine-grained permissions per role and a single system spanning multiple facility branches.' },
];

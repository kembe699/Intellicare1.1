/**
 * Platform-admin invoice document — a companion to quotationTemplate.ts,
 * sharing its brand/letterhead conventions but its own (simpler, single-page)
 * layout: a sales invoice with a payment history, not a multi-page contract.
 *
 * Reuses documentTemplate.ts's openPrintWindow/downloadDocumentAsPdf, same
 * as the quotation document — downloadDocumentAsPdf finds pages via
 * `.ic-page, .qt-page`, so this reuses the `.qt-page` class rather than
 * inventing a third page-container convention for that helper to know about.
 */
import type { QuotationCompanyProfile, QuotationCustomer } from './quotationTemplate';

export interface InvoicePayment {
  amount: number | string;
  paid_at: string;
  recorded_by_name?: string | null;
}

export interface InvoiceData {
  invoice_number: string;
  issue_date: string;
  currency: string;
  total_amount: number | string;
  amount_paid: number | string;
  status: 'unpaid' | 'partial' | 'paid';
  quotation?: { quote_number: string } | null;
}

const money = (amount: number | string, currency: string) => {
  const n = parseFloat(String(amount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid' };
const STATUS_COLOR: Record<string, string> = { unpaid: '#dc2626', partial: '#d97706', paid: '#059669' };
const STATUS_BG: Record<string, string> = { unpaid: '#fef2f2', partial: '#fffbeb', paid: '#ecfdf5' };

export function buildInvoiceHTML(invoice: InvoiceData, customer: QuotationCustomer, payments: InvoicePayment[], company: QuotationCompanyProfile): string {
  const total = parseFloat(String(invoice.total_amount || 0));
  const paid = parseFloat(String(invoice.amount_paid || 0));
  const balance = total - paid;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @page { size: A4; margin: 16mm 16mm 18mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #e8ecef; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0F172A; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .qt-page { width: 210mm; min-height: 297mm; margin: 0 auto 8mm; background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,0.12); padding: 16mm; position: relative; }
    @media print {
      html, body { background: #fff; }
      .qt-page { width: 100%; min-height: auto; margin: 0; box-shadow: none; }
    }
    .qt-letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1A7A75; padding-bottom: 12px; margin-bottom: 20px; }
    .qt-logo { max-height: 64px; max-width: 200px; object-fit: contain; }
    .qt-company-name { font-size: 18px; font-weight: 700; color: #0F172A; }
    .qt-company-meta { font-size: 10px; color: #64748B; margin-top: 2px; line-height: 1.5; }
    .qt-doc-title { text-align: right; }
    .qt-doc-title h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #1A7A75; }
    .qt-doc-meta { font-size: 11px; color: #334155; margin-top: 4px; line-height: 1.6; }
    .in-status { display: inline-block; margin-top: 8px; padding: 3px 12px; border-radius: 20px; font-size: 10.5px; font-weight: 700; }
    .qt-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #0F172A; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin: 20px 0 10px; }
    .qt-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 6px; }
    .qt-info-box { background: #F1F5F9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
    .qt-info-box h3 { margin: 0 0 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #1A7A75; }
    .qt-info-row { font-size: 11px; line-height: 1.6; }
    .qt-info-label { color: #64748B; }
    .in-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
    .in-summary-item { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .in-summary-item .label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #64748B; }
    .in-summary-item .value { font-size: 18px; font-weight: 700; color: #0F172A; margin-top: 6px; }
    .in-summary-item.balance .value { color: #1A7A75; }
    .qt-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
    .qt-table thead tr { background: #1A7A75; color: #fff; }
    .qt-table th { padding: 7px 9px; text-align: left; font-size: 9px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
    .qt-table th.right, .qt-table td.right { text-align: right; }
    .qt-table td { padding: 7px 9px; border-bottom: 1px solid #f1f5f9; }
    .qt-table tbody tr:nth-child(even) td { background: #fafbfc; }
    .qt-closing { margin-top: 24px; font-size: 10px; color: #94a3b8; font-style: italic; }
    .qt-footer { position: absolute; bottom: 10mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    .qt-stamp { max-height: 115px; max-width: 115px; object-fit: contain; transform: rotate(-12deg); }
  `;

  const companyAddressLine = [company.address, company.city].filter(Boolean).join(', ');
  const companyMeta = [
    companyAddressLine,
    [company.phone, company.email].filter(Boolean).join('  •  '),
    company.website || '',
  ].filter(Boolean).join('<br/>');

  const paymentsHTML = payments.length > 0
    ? `<table class="qt-table">
        <thead><tr><th>Date</th><th>Recorded By</th><th class="right">Amount</th></tr></thead>
        <tbody>
          ${payments.map((p) => `
            <tr>
              <td>${fmtDate(p.paid_at)}</td>
              <td>${p.recorded_by_name || '—'}</td>
              <td class="right">${money(p.amount, invoice.currency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : `<p style="font-size:11px;color:#64748B;">No payments recorded yet.</p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${invoice.invoice_number} — ${customer.name}</title>
  <style>${css}</style>
</head>
<body>
  <div class="qt-page">
    <div class="qt-letterhead">
      <div>
        ${company.logo ? `<img src="${company.logo}" class="qt-logo" alt="${company.company_name}" />` : `<div class="qt-company-name">${company.company_name}</div>`}
        <div class="qt-company-meta">${companyMeta}</div>
      </div>
      <div class="qt-doc-title">
        <h1>INVOICE</h1>
        <div class="qt-doc-meta">
          ${invoice.invoice_number}<br/>
          Date: ${fmtDate(invoice.issue_date)}
          ${invoice.quotation ? `<br/>Quote: ${invoice.quotation.quote_number}` : ''}
        </div>
        <div class="in-status" style="background:${STATUS_BG[invoice.status]}; color:${STATUS_COLOR[invoice.status]};">${STATUS_LABEL[invoice.status]}</div>
      </div>
    </div>

    <div class="qt-info-grid">
      <div class="qt-info-box">
        <h3>Billed To</h3>
        <div class="qt-info-row"><strong>${customer.name}</strong></div>
        ${customer.contact_person ? `<div class="qt-info-row"><span class="qt-info-label">Contact:</span> ${customer.contact_person}</div>` : ''}
        ${customer.email ? `<div class="qt-info-row"><span class="qt-info-label">Email:</span> ${customer.email}</div>` : ''}
        ${customer.phone ? `<div class="qt-info-row"><span class="qt-info-label">Phone:</span> ${customer.phone}</div>` : ''}
        ${customer.address ? `<div class="qt-info-row"><span class="qt-info-label">Address:</span> ${customer.address}</div>` : ''}
      </div>
      <div class="qt-info-box">
        <h3>Invoice Summary</h3>
        <div class="qt-info-row"><span class="qt-info-label">Currency:</span> ${invoice.currency}</div>
        <div class="qt-info-row"><span class="qt-info-label">Total Amount:</span> ${money(total, invoice.currency)}</div>
        <div class="qt-info-row"><span class="qt-info-label">Status:</span> ${STATUS_LABEL[invoice.status]}</div>
      </div>
    </div>

    <div class="in-summary">
      <div class="in-summary-item"><div class="label">Total</div><div class="value">${money(total, invoice.currency)}</div></div>
      <div class="in-summary-item"><div class="label">Paid</div><div class="value">${money(paid, invoice.currency)}</div></div>
      <div class="in-summary-item balance"><div class="label">Balance Due</div><div class="value">${money(balance, invoice.currency)}</div></div>
    </div>

    <div class="qt-section-title">Payment History</div>
    ${paymentsHTML}

    ${company.stamp ? `<div style="display:flex; justify-content:flex-end; margin-top:24px;"><img src="${company.stamp}" class="qt-stamp" alt="${company.company_name} stamp" /></div>` : ''}
    <p class="qt-closing">This invoice is automatically generated by ${company.company_name}${company.website ? ` — ${company.website}` : ''}.</p>

    <div class="qt-footer">
      <span>${invoice.issue_date.replace(/-/g, '')}</span>
      <span>Page 1</span>
    </div>
  </div>
</body>
</html>`;
}

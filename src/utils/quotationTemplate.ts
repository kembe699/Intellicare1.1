/**
 * Platform-admin quotation document — a self-contained HTML builder distinct
 * from the tenant-facing src/utils/documentTemplate.ts (that one is a
 * single-column, tenant-branded template; this document is vendor-branded
 * and needs a two-column contract layout that has no equivalent there).
 *
 * Reuses documentTemplate.ts's openPrintWindow/downloadDocument only — those
 * two are fully generic (just take an HTML string), so the "print → browser
 * Save as PDF" convention every other document in this app uses stays
 * consistent here too, without forcing this layout through buildDocument()'s
 * single-column shell.
 */
import { QUOTATION_FEATURES } from '@/data/quotationFeatures';

export interface QuotationCompanyProfile {
  company_name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo?: string | null;
  stamp?: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_swift?: string | null;
}

export interface QuotationCustomer {
  name: string;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface QuotationData {
  quote_number: string;
  issue_date: string;
  valid_until: string;
  currency: string;
  total_amount: number | string;
  deployment_model: 'cloud' | 'on_premise';
  concurrent_users?: number | null;
  training_hours: number;
  scope_notes?: string | null;
}

const money = (amount: number | string, currency: string) => {
  const n = parseFloat(String(amount || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export function buildQuotationHTML(quotation: QuotationData, customer: QuotationCustomer, company: QuotationCompanyProfile): string {
  const productName = 'IntelliCare';
  const isCloud = quotation.deployment_model === 'cloud';
  const asfCoverage = isCloud
    ? ['Annual Cloud Computing costs', 'User and Application Support', 'Application Updates']
    : ['Annual Maintenance', 'User and Application Support', 'Application Updates'];

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @page { size: A4; margin: 16mm 16mm 18mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #e8ecef; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0F172A; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .qt-page { width: 210mm; min-height: 297mm; margin: 0 auto 8mm; background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,0.12); padding: 16mm; position: relative; }
    @media print {
      html, body { background: #fff; }
      .qt-page { width: 100%; min-height: auto; margin: 0; box-shadow: none; page-break-after: always; }
      .qt-page:last-child { page-break-after: auto; }
    }
    .qt-letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1A7A75; padding-bottom: 12px; margin-bottom: 20px; }
    .qt-logo { max-height: 64px; max-width: 200px; object-fit: contain; }
    .qt-company-name { font-size: 18px; font-weight: 700; color: #0F172A; }
    .qt-company-meta { font-size: 10px; color: #64748B; margin-top: 2px; line-height: 1.5; }
    .qt-doc-title { text-align: right; }
    .qt-doc-title h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #1A7A75; }
    .qt-doc-meta { font-size: 11px; color: #334155; margin-top: 4px; line-height: 1.6; }
    .qt-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #0F172A; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin: 20px 0 10px; }
    .qt-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 6px; }
    .qt-info-box { background: #F1F5F9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
    .qt-info-box h3 { margin: 0 0 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #1A7A75; }
    .qt-info-row { font-size: 11px; line-height: 1.6; }
    .qt-info-label { color: #64748B; }
    .qt-features { list-style: none; margin: 0; padding: 0; counter-reset: feat; }
    .qt-features li { display: flex; gap: 8px; padding: 7px 0; border-bottom: 1px solid #f1f5f9; font-size: 11px; counter-increment: feat; }
    .qt-features li::before { content: counter(feat) '.'; color: #1A7A75; font-weight: 700; flex-shrink: 0; min-width: 16px; }
    .qt-feature-text { display: flex; flex-direction: column; gap: 2px; }
    .qt-feature-name { font-weight: 600; color: #0F172A; }
    .qt-feature-desc { color: #64748B; }
    .qt-scope-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px; }
    .qt-scope-item { background: #F1F5F9; border-radius: 6px; padding: 10px 12px; text-align: center; }
    .qt-scope-item .label { font-size: 9px; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px; }
    .qt-scope-item .value { font-size: 13px; font-weight: 700; color: #0F172A; margin-top: 3px; }
    .qt-total { margin-top: 24px; padding-top: 14px; border-top: 2px solid #1A7A75; display: flex; justify-content: flex-end; align-items: baseline; gap: 16px; }
    .qt-total .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: #64748B; font-weight: 600; }
    .qt-total .value { font-size: 16px; font-weight: 700; color: #0F172A; }
    .qt-closing-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 24px; gap: 16px; }
    .qt-stamp { max-height: 115px; max-width: 115px; object-fit: contain; flex-shrink: 0; transform: rotate(-12deg); }
    .qt-notes-box { margin-top: 16px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fde68a; border-left: 3px solid #f59e0b; border-radius: 6px; font-size: 11px; }
    .qt-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 8px; }
    .qt-col h2 { font-size: 13px; font-weight: 700; margin: 0 0 12px; color: #0F172A; }
    .qt-col h4 { font-size: 11px; font-weight: 700; margin: 14px 0 4px; color: #1A7A75; }
    .qt-col p, .qt-col li { font-size: 10.5px; line-height: 1.55; color: #334155; }
    .qt-col ul, .qt-col ol { margin: 4px 0; padding-left: 18px; }
    .qt-footer { position: absolute; bottom: 10mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    .qt-closing { margin: 0; font-size: 10px; color: #94a3b8; font-style: italic; }
  `;

  const featuresHTML = QUOTATION_FEATURES.map((f) => `
    <li><span class="qt-feature-text"><span class="qt-feature-name">${f.name}</span><span class="qt-feature-desc">${f.description}</span></span></li>
  `).join('');

  const companyAddressLine = [company.address, company.city].filter(Boolean).join(', ');
  const companyMeta = [
    companyAddressLine,
    [company.phone, company.email].filter(Boolean).join('  •  '),
    company.website || '',
  ].filter(Boolean).join('<br/>');

  const footer = (page: number) => `
    <div class="qt-footer">
      <span>${quotation.issue_date.replace(/-/g, '')}</span>
      <span>Page ${page}</span>
    </div>
  `;

  const page1 = `
    <div class="qt-page">
      <div class="qt-letterhead">
        <div>
          ${company.logo ? `<img src="${company.logo}" class="qt-logo" alt="${company.company_name}" />` : `<div class="qt-company-name">${company.company_name}</div>`}
          <div class="qt-company-meta">${companyMeta}</div>
        </div>
        <div class="qt-doc-title">
          <h1>QUOTATION</h1>
          <div class="qt-doc-meta">
            ${quotation.quote_number}<br/>
            Date: ${fmtDate(quotation.issue_date)}<br/>
            Valid Until: ${fmtDate(quotation.valid_until)}
          </div>
        </div>
      </div>

      <div class="qt-info-grid">
        <div class="qt-info-box">
          <h3>Prepared For</h3>
          <div class="qt-info-row"><strong>${customer.name}</strong></div>
          ${customer.contact_person ? `<div class="qt-info-row"><span class="qt-info-label">Contact:</span> ${customer.contact_person}</div>` : ''}
          ${customer.email ? `<div class="qt-info-row"><span class="qt-info-label">Email:</span> ${customer.email}</div>` : ''}
          ${customer.phone ? `<div class="qt-info-row"><span class="qt-info-label">Phone:</span> ${customer.phone}</div>` : ''}
          ${customer.address ? `<div class="qt-info-row"><span class="qt-info-label">Address:</span> ${customer.address}</div>` : ''}
        </div>
        <div class="qt-info-box">
          <h3>Quotation For</h3>
          <div class="qt-info-row"><strong>${productName} Hospital Management System</strong></div>
          <div class="qt-info-row"><span class="qt-info-label">Deployment:</span> ${isCloud ? 'Cloud (SaaS)' : 'On-Premise'}</div>
          ${quotation.concurrent_users ? `<div class="qt-info-row"><span class="qt-info-label">Concurrent Users:</span> ${quotation.concurrent_users}</div>` : ''}
          <div class="qt-info-row"><span class="qt-info-label">Training:</span> ${quotation.training_hours} hours</div>
        </div>
      </div>

      <div class="qt-section-title">System Features Included</div>
      <ul class="qt-features">${featuresHTML}</ul>

      ${quotation.scope_notes ? `<div class="qt-notes-box"><strong>Notes for this quotation:</strong> ${quotation.scope_notes}</div>` : ''}

      <div class="qt-total">
        <span class="label">Total Quoted Value</span>
        <span class="value">${money(quotation.total_amount, quotation.currency)}</span>
      </div>

      ${footer(1)}
    </div>
  `;

  const page2 = `
    <div class="qt-page">
      <div class="qt-columns">
        <div class="qt-col">
          <h2>Terms and Conditions</h2>
          <p>*This quotation is valid for 60 days from ${fmtDate(quotation.issue_date)}.</p>

          <h4>Application Deployment Model</h4>
          <p>
            ${isCloud
              ? `${productName} is offered on SaaS (Software as a Service) model. In the absence of reliable internet connectivity, the application may be deployed as a web app on the customer's local ICT infrastructure (On-Premise Deployment).`
              : `${productName} is deployed as a web application on the customer's own local ICT infrastructure (On-Premise Deployment).`}
          </p>

          <h4>Initial Payment</h4>
          <p>Quoted value covers:</p>
          <ol>
            <li>Account set-up</li>
            <li>Training</li>
            ${isCloud ? '<li>Cloud Computing costs for the first year (For Cloud Deployment)</li>' : '<li>Annual Maintenance costs for the first year (For On-Premise Deployment)</li>'}
            <li>User and Application Support for the first year</li>
          </ol>
          <ul>
            <li>70% advance payment payable upon acceptance of this quotation.</li>
            <li>30% payable upon completion of deployment, setup, and training.</li>
            <li>Confirmation of order is by a signed acceptance of this quotation or an official Purchase Order.</li>
          </ul>

          <h4>ASF (Annual Subscription Fee)</h4>
          <p>i) Upon expiry of the first year of deployment, the client is required to subscribe for the service annually at <strong>30% of the Total Amount Payable</strong>. The ASF is renewable and payable annually.</p>
          <p>ii) The Annual Subscription Fee covers the following:</p>
          <ol>${asfCoverage.map((c) => `<li>${c}</li>`).join('')}</ol>

          <h4>Notes</h4>
          <ol>
            <li>For cloud deployment, the application requires a stable and reliable internet connection.</li>
            <li>The hardware required for the queuing system is charged separately (optional).</li>
            <li>Data migration is charged separately.</li>
            <li>Value quoted here only applies to the standard application. Any customization required by the end-user shall be charged separately.</li>
          </ol>
        </div>

        <div class="qt-col">
          <h2>Project Plan</h2>
          <h4>Training / Learning</h4>
          <p>
            The training will be delivered virtually through our online Learning Management System (LMS), which offers a
            flexible and rich learning experience. Learners can access the LMS through any internet-enabled device,
            including mobile phones, ensuring that training is convenient and adaptable to their schedules. The LMS
            features comprehensive learning paths and modules designed specifically for different roles within the
            hospital, ensuring that each learner focuses on what is relevant to their department.
          </p>
          <p>
            Upon completion of the course, the LMS will automatically assess the user's understanding before issuing a
            certification as a qualified ${productName} user.
          </p>
          <p>
            The ${productName} system will be deployed for use and go-live upon completion of the learning exercise. The
            client's representative will work closely with our Customer Success Team to coordinate onboarding of
            learners onto the LMS and ensure a seamless deployment.
          </p>
          <h4>Training / Learning Duration</h4>
          <p><strong>${quotation.training_hours} Hours</strong></p>
        </div>
      </div>

      ${company.bank_name || company.bank_account_number ? `
        <div class="qt-section-title">Payment Details</div>
        <div class="qt-info-box" style="max-width: 360px;">
          ${company.bank_name ? `<div class="qt-info-row"><span class="qt-info-label">Bank:</span> ${company.bank_name}</div>` : ''}
          ${company.bank_account_name ? `<div class="qt-info-row"><span class="qt-info-label">Account Name:</span> ${company.bank_account_name}</div>` : ''}
          ${company.bank_account_number ? `<div class="qt-info-row"><span class="qt-info-label">Account Number:</span> ${company.bank_account_number}</div>` : ''}
          ${company.bank_swift ? `<div class="qt-info-row"><span class="qt-info-label">SWIFT:</span> ${company.bank_swift}</div>` : ''}
        </div>
      ` : ''}
      <div class="qt-closing-row">
        <p class="qt-closing">This quotation is automatically generated by ${company.company_name}${company.website ? ` — ${company.website}` : ''}.</p>
        ${company.stamp ? `<img src="${company.stamp}" class="qt-stamp" alt="${company.company_name} stamp" />` : ''}
      </div>
      ${footer(2)}
    </div>
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${quotation.quote_number} — ${customer.name}</title>
  <style>${css}</style>
</head>
<body>
  ${page1}
  ${page2}
</body>
</html>`;
}

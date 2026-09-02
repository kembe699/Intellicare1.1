/**
 * IntelliCare Unified Document Template — Frontend
 *
 * Provides consistent HTML generation for all printable documents
 * opened via window.open() across the system: lab reports, receipts,
 * bills, and any other frontend-generated print templates.
 *
 * Mirrors the server-side documentTemplate.js design exactly.
 */

// ── Brand Colors (Intellicare Brand Guide) ───────────────────────
const BRAND = {
  primary: '#1A7A75',        // Logo dark teal
  primaryDark: '#155E5A',    // Teal hover/active
  primaryLight: 'rgba(26,122,117,0.06)',  // Teal tint bg
  primaryBorder: '#4ECDC4',  // Logo light teal
  navy: '#0F172A',           // Deep Navy
  dark: '#0F172A',           // Deep Navy
  gray: '#64748B',           // Slate Gray
  lightBg: '#F1F5F9',        // Light Gray
  border: '#e2e8f0',
  tableHeader: '#F1F5F9',
  white: '#ffffff',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
} as const;

// ── Inline SVG Logo ───────────────────────────────────────────────
const IC_LOGO_SVG = `<svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="icGrad" x1="0" y1="0" x2="42" y2="42" gradientUnits="userSpaceOnUse">
      <stop stop-color="#4ECDC4"/><stop offset="1" stop-color="#0F172A"/>
    </linearGradient>
  </defs>
  <circle cx="21" cy="21" r="21" fill="url(#icGrad)"/>
  <rect x="17.5" y="10" width="7" height="22" rx="2.5" fill="white" opacity="0.95"/>
  <rect x="10" y="17.5" width="22" height="7" rx="2.5" fill="white" opacity="0.95"/>
  <polyline points="10,21 14,21 16.5,15.5 19,27 21.5,17 24,21 32,21"
    stroke="#1A7A75" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

// ── Shared CSS ───────────────────────────────────────────────────
export function getDocumentCSS(extraCSS = ''): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @page { size: A4; margin: 12mm 14mm 18mm 14mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: #e8ecef;
      font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: ${BRAND.dark}; font-size: 12px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .ic-page {
      width: 210mm; min-height: 297mm; margin: 0 auto;
      background: ${BRAND.white};
      box-shadow: 0 4px 24px rgba(0,0,0,0.12);
    }
    .ic-page-inner { padding: 0 18mm 22mm 18mm; }
    @media print {
      html, body { background: #fff; }
      .ic-page { width: 100%; min-height: auto; margin: 0; box-shadow: none; }
      .ic-page-inner { padding: 0 12mm 18mm 12mm; }
    }

    /* ── Accent Bar ── */
    .ic-accent-bar {
      height: 5px;
      background: linear-gradient(90deg, ${BRAND.primary} 0%, ${BRAND.primaryBorder} 60%, ${BRAND.primaryLight} 100%);
      margin-bottom: 0;
    }

    /* ── Header ── */
    .ic-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 16px 18mm 14px 18mm;
      border-bottom: 1px solid ${BRAND.border};
      margin-bottom: 20px;
    }
    .ic-brand { display: flex; align-items: center; gap: 12px; }
    .ic-logo-text { line-height: 1.2; }
    .ic-logo-name {
      font-size: 20px; font-weight: 700; letter-spacing: -0.3px;
      color: ${BRAND.dark};
    }
    .ic-logo-name span { color: ${BRAND.primary}; }
    .ic-logo-tagline {
      font-size: 9px; color: ${BRAND.gray}; text-transform: uppercase;
      letter-spacing: 1.5px; margin-top: 1px;
    }
    .ic-facility-info { margin-top: 10px; }
    .ic-facility-name { font-size: 11px; font-weight: 600; color: ${BRAND.dark}; }
    .ic-facility-meta { font-size: 10px; color: ${BRAND.gray}; margin-top: 1px; }
    .ic-header-right { text-align: right; }
    .ic-doc-type {
      font-size: 9px; color: ${BRAND.gray}; text-transform: uppercase;
      letter-spacing: 1.5px; margin-bottom: 6px;
    }
    .ic-doc-badge {
      display: inline-block; background: ${BRAND.primary}; color: white;
      padding: 5px 14px; border-radius: 20px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
    }
    .ic-header-meta { font-size: 10px; color: ${BRAND.gray}; margin-top: 5px; }
    .ic-status-badge {
      display: inline-block; margin-top: 6px;
      padding: 2px 10px; border-radius: 20px; font-size: 10px; font-weight: 600;
      background: #ecfdf5; color: #065f46; border: 1px solid #6ee7b7;
    }

    /* ── Info Grid ── */
    .ic-info-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;
    }
    .ic-info-box {
      background: ${BRAND.lightBg}; border: 1px solid ${BRAND.border};
      border-radius: 6px; padding: 12px 14px;
    }
    .ic-info-box h3 {
      margin: 0 0 8px 0; font-size: 9px; text-transform: uppercase;
      color: ${BRAND.primary}; letter-spacing: 1.2px; font-weight: 700;
    }
    .ic-info-row { margin-bottom: 3px; font-size: 11px; line-height: 1.5; }
    .ic-info-label { color: ${BRAND.gray}; display: inline-block; min-width: 100px; }
    .ic-info-value { font-weight: 600; color: ${BRAND.dark}; }

    /* ── Section Title ── */
    .ic-section-title {
      font-size: 11px; font-weight: 700; margin: 18px 0 8px 0;
      color: ${BRAND.dark}; text-transform: uppercase; letter-spacing: 0.8px;
      padding-bottom: 5px; border-bottom: 2px solid ${BRAND.primary};
      display: flex; justify-content: space-between; align-items: center;
    }
    .ic-section-title span { color: ${BRAND.gray}; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 10px; }

    /* ── Table ── */
    .ic-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; }
    .ic-table thead tr {
      background: ${BRAND.primary}; color: white;
    }
    .ic-table th {
      padding: 7px 9px; text-align: left;
      font-size: 9px; text-transform: uppercase; color: white;
      font-weight: 700; letter-spacing: 0.5px;
    }
    .ic-table th.right { text-align: right; }
    .ic-table th.center { text-align: center; }
    .ic-table td { padding: 7px 9px; font-size: 11px; border-bottom: 1px solid #f1f5f9; }
    .ic-table td.right { text-align: right; }
    .ic-table td.center { text-align: center; }
    .ic-table td.bold { font-weight: 600; }
    .ic-table tbody tr:nth-child(even) td { background: #fafbfc; }
    .ic-table tbody tr:hover td { background: ${BRAND.primaryLight}; }
    .ic-table tr.sub-row td {
      background: #f8fafc; padding-left: 36px; font-size: 11px; color: ${BRAND.gray};
      border-bottom: 1px solid #f1f5f9;
    }
    .ic-table tfoot td {
      font-weight: 700; border-top: 2px solid ${BRAND.border};
      padding: 8px 9px; background: ${BRAND.tableHeader};
    }
    /* Remark badge styles */
    .remark-high { color: ${BRAND.danger}; font-weight: 700; }
    .remark-low { color: ${BRAND.primary}; font-weight: 700; }
    .remark-normal { color: ${BRAND.success}; font-weight: 600; }

    /* ── Summary Box ── */
    .ic-summary {
      text-align: right; margin-top: 8px; padding: 12px 16px;
      background: ${BRAND.primaryLight}; border: 1px solid ${BRAND.primaryBorder};
      border-radius: 6px;
    }
    .ic-summary-row { margin-bottom: 4px; font-size: 12px; }
    .ic-summary-label { color: ${BRAND.gray}; margin-right: 8px; }
    .ic-summary-total { font-size: 18px; font-weight: 700; color: ${BRAND.primary}; }

    /* ── Notes ── */
    .ic-notes {
      margin-top: 16px; padding: 10px 14px; background: #fffbeb;
      border: 1px solid #fde68a; border-left: 3px solid #f59e0b;
      border-radius: 6px; font-size: 11px;
    }

    /* ── Signatures ── */
    .ic-signatures {
      display: flex; justify-content: space-around;
      padding: 28px 20px 8px; margin-top: 20px;
      border-top: 1px solid ${BRAND.border};
    }
    .ic-sig-block { text-align: center; min-width: 160px; }
    .ic-sig-img { max-width: 140px; max-height: 50px; display: block; margin: 0 auto 4px; object-fit: contain; }
    .ic-sig-line { border-top: 1px dashed #94a3b8; margin-bottom: 5px; width: 100%; }
    .ic-sig-label { font-size: 10px; font-weight: 700; color: ${BRAND.dark}; text-transform: uppercase; letter-spacing: 0.5px; }
    .ic-sig-name { font-size: 10px; color: ${BRAND.gray}; margin-top: 2px; }

    /* ── Footer ── */
    .ic-footer {
      margin-top: 28px; padding: 12px 18mm;
      border-top: 1px solid ${BRAND.border};
      background: ${BRAND.lightBg};
      display: flex; justify-content: space-between; align-items: center;
    }
    .ic-footer-left { font-size: 9px; color: ${BRAND.gray}; }
    .ic-footer-left p { margin: 0 0 2px 0; }
    .ic-footer-brand {
      display: flex; align-items: center; gap: 6px;
      font-size: 9px; font-weight: 700; color: ${BRAND.dark};
    }
    .ic-footer-brand span { color: ${BRAND.primary}; }

    /* ── Utilities ── */
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .text-bold { font-weight: 700; }
    .text-primary { color: ${BRAND.primary}; }
    .text-success { color: ${BRAND.success}; }
    .text-danger { color: ${BRAND.danger}; }
    .mt-0 { margin-top: 0; }
    ${extraCSS}
  `;
}

// ── Types ────────────────────────────────────────────────────────
export interface InfoBoxRow {
  label: string;
  value: string | number;
  bold?: boolean;
}

export interface InfoBox {
  title: string;
  rows: InfoBoxRow[];
}

export interface TableColumn {
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export interface TableRow {
  cells: (string | number)[];
  bold?: boolean;
  isSubRow?: boolean;
}

export interface SummaryRow {
  label: string;
  value: string | number;
  isTotal?: boolean;
}

export interface SignerInfo {
  label: string;
  name?: string;
  signature?: string;
}

export interface DocFacilityInfo {
  name?: string;
  type?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  licenseNo?: string;
}

export interface DocBranchInfo {
  name?: string;
  address?: string;
  phone?: string;
}

export interface DocumentOptions {
  title?: string;
  docType: string;
  docNumber?: string;
  status?: string;
  date?: string | Date;
  bodyHTML: string;
  extraCSS?: string;
  autoPrint?: boolean;
  logoUrl?: string;
  facilityInfo?: DocFacilityInfo;
  branchInfo?: DocBranchInfo;
}

// ── Build full HTML document ─────────────────────────────────────
export function buildDocument(opts: DocumentOptions): string {
  const { title, docType, docNumber, status, date, bodyHTML, extraCSS, autoPrint = true, logoUrl, facilityInfo, branchInfo } = opts;

  const facilityDisplayName = facilityInfo?.name || 'IntelliCare';
  const hasFacilityMeta = facilityInfo?.address || facilityInfo?.phone || facilityInfo?.licenseNo || branchInfo?.name;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title || 'IntelliCare Document'}</title>
  <style>${getDocumentCSS(extraCSS)}</style>
</head>
<body>
<div class="ic-page">

  <!-- Teal Accent Bar -->
  <div class="ic-accent-bar"></div>

  <!-- Header -->
  <div class="ic-header">
    <div>
      <div class="ic-brand">
        ${logoUrl
          ? `<img src="${logoUrl}" alt="Intellicare" style="width:48px;height:48px;object-fit:contain;border-radius:10px;" />`
          : IC_LOGO_SVG}
        <div class="ic-logo-text">
          <div class="ic-logo-name">Intelli<span>care</span></div>
          <div class="ic-logo-tagline">Health Management System</div>
        </div>
      </div>
      ${hasFacilityMeta ? `
      <div class="ic-facility-info">
        <div class="ic-facility-name">${facilityDisplayName}${facilityInfo?.type ? ` &mdash; ${facilityInfo.type}` : ''}</div>
        ${facilityInfo?.address ? `<div class="ic-facility-meta">${facilityInfo.address}${facilityInfo.city ? ', ' + facilityInfo.city : ''}</div>` : ''}
        ${facilityInfo?.phone ? `<div class="ic-facility-meta">Tel: ${facilityInfo.phone}${facilityInfo.email ? '&nbsp;&nbsp;|&nbsp;&nbsp;' + facilityInfo.email : ''}</div>` : ''}
        ${facilityInfo?.licenseNo ? `<div class="ic-facility-meta">License: ${facilityInfo.licenseNo}</div>` : ''}
        ${branchInfo?.name ? `<div class="ic-facility-meta">Branch: <strong>${branchInfo.name}</strong>${branchInfo.address ? ' &mdash; ' + branchInfo.address : ''}${branchInfo.phone ? ' | ' + branchInfo.phone : ''}</div>` : ''}
      </div>` : `<div class="ic-facility-info"><div class="ic-facility-name">${facilityDisplayName}</div></div>`}
    </div>
    <div class="ic-header-right">
      <div class="ic-doc-type">${docType}</div>
      ${docNumber ? `<div class="ic-doc-badge">${docNumber}</div>` : ''}
      ${status ? `<div class="ic-status-badge">${status.charAt(0).toUpperCase() + status.slice(1)}</div>` : ''}
      ${date ? `<div class="ic-header-meta">Date: ${formatDate(date)}</div>` : ''}
      <div class="ic-header-meta">Printed: ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</div>
    </div>
  </div>

  <!-- Body -->
  <div class="ic-page-inner">
    ${bodyHTML}
  </div>

  <!-- Footer -->
  <div class="ic-footer">
    <div class="ic-footer-left">
      <p>${docNumber ? `Ref: ${docNumber}` : 'IntelliCare Health Management System'}</p>
      <p>For enquiries, please reference the document number above.</p>
    </div>
    <div class="ic-footer-brand">
      ${logoUrl
        ? `<img src="${logoUrl}" alt="Intellicare" style="width:22px;height:22px;object-fit:contain;border-radius:5px;" />`
        : `<svg width="20" height="20" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="21" cy="21" r="21" fill="#1A7A75"/>
        <rect x="17.5" y="10" width="7" height="22" rx="2.5" fill="white" opacity="0.95"/>
        <rect x="10" y="17.5" width="22" height="7" rx="2.5" fill="white" opacity="0.95"/>
        <polyline points="10,21 14,21 16.5,15.5 19,27 21.5,17 24,21 32,21" stroke="#0F172A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`}
      Intelli<span>care</span>&nbsp;HMIS
    </div>
  </div>

</div>
${autoPrint ? '<script>window.onload = function(){ window.print(); }</script>' : ''}
</body>
</html>`;
}

// ── Build info grid ──────────────────────────────────────────────
export function buildInfoGrid(leftBox?: InfoBox, rightBox?: InfoBox): string {
  const renderBox = (box?: InfoBox) => {
    if (!box) return '';
    const rows = box.rows.map(r =>
      `<div class="ic-info-row"><span class="ic-info-label">${r.label}:</span>${r.bold ? '<strong>' : ''}${r.value ?? '-'}${r.bold ? '</strong>' : ''}</div>`
    ).join('');
    return `<div class="ic-info-box"><h3>${box.title}</h3>${rows}</div>`;
  };
  return `<div class="ic-info-grid">${renderBox(leftBox)}${renderBox(rightBox)}</div>`;
}

// ── Build table ──────────────────────────────────────────────────
export function buildTable(columns: TableColumn[], rows: TableRow[], footerRow?: (string | number)[]): string {
  const thCells = columns.map(c => {
    const cls = c.align === 'right' ? ' class="right"' : c.align === 'center' ? ' class="center"' : '';
    const style = c.width ? ` style="width:${c.width}"` : '';
    return `<th${cls}${style}>${c.label}</th>`;
  }).join('');

  const bodyRows = rows.map(row => {
    const cls = row.isSubRow ? ' class="sub-row"' : '';
    const cells = columns.map((c, i) => {
      const val = row.cells[i] ?? '';
      const tdCls = [c.align === 'right' ? 'right' : '', c.align === 'center' ? 'center' : '', row.bold ? 'bold' : ''].filter(Boolean).join(' ');
      return `<td${tdCls ? ` class="${tdCls}"` : ''}>${val}</td>`;
    }).join('');
    return `<tr${cls}>${cells}</tr>`;
  }).join('');

  let footerHTML = '';
  if (footerRow) {
    const cells = columns.map((c, i) => {
      const val = footerRow[i] ?? '';
      const cls = c.align === 'right' ? ' class="right"' : c.align === 'center' ? ' class="center"' : '';
      return `<td${cls}>${val}</td>`;
    }).join('');
    footerHTML = `<tfoot><tr>${cells}</tr></tfoot>`;
  }

  return `<table class="ic-table"><thead><tr>${thCells}</tr></thead><tbody>${bodyRows}</tbody>${footerHTML}</table>`;
}

// ── Build summary box ────────────────────────────────────────────
export function buildSummary(rows: SummaryRow[]): string {
  const html = rows.map(r => {
    if (r.isTotal) return `<div class="ic-summary-total">${r.label}: ${r.value}</div>`;
    return `<div class="ic-summary-row"><span class="ic-summary-label">${r.label}:</span> <strong>${r.value}</strong></div>`;
  }).join('');
  return `<div class="ic-summary">${html}</div>`;
}

// ── Build notes ──────────────────────────────────────────────────
export function buildNotes(notes?: string | null): string {
  if (!notes) return '';
  return `<div class="ic-notes"><strong>Notes:</strong> ${notes}</div>`;
}

// ── Build signatures ─────────────────────────────────────────────
export function buildSignatures(signers: SignerInfo[]): string {
  if (!signers.length) return '';
  const blocks = signers.map(s =>
    `<div class="ic-sig-block">${s.signature ? `<img class="ic-sig-img" src="${s.signature}" alt="signature" />` : '<div style="height:55px"></div>'}<div class="ic-sig-line"></div><div class="ic-sig-label">${s.label}</div>${s.name ? `<div class="ic-sig-name">${s.name}</div>` : ''}</div>`
  ).join('');
  return `<div class="ic-signatures">${blocks}</div>`;
}

// ── Helpers ──────────────────────────────────────────────────────
export function formatDate(d: string | Date | undefined | null): string {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

export function formatCurrency(amount: number | string, currency = ''): string {
  const n = parseFloat(String(amount || 0)).toFixed(2);
  return currency ? `${currency} ${n}` : n;
}

// ── Download document as HTML file ───────────────────────────────
export function downloadDocument(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Open print window helper ─────────────────────────────────────
export function openPrintWindow(html: string): Window | null {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
  return win;
}

// ── Electronic signature lookup ────────────────────────────────────
// Every document that records a user taking an action (entering results,
// approving, dispensing, etc.) should stamp that user's saved signature
// (set once in their Profile page) onto the printed document, rather than
// leaving the signature block blank or hardcoding "Approved electronically".
export async function fetchUserSignature(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    // Lazy import to avoid a circular dependency with apiClient at module load time.
    const { authFetch } = await import('@/api/apiClient');
    const res = await authFetch(`/api/users/${userId}/signature`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.signature || null;
  } catch {
    return null;
  }
}

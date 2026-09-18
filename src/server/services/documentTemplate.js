/**
 * IntelliCare Unified Document Template
 * 
 * Provides consistent HTML structure, CSS styling, header, footer, and layout
 * for all printable documents across the system: invoices, bills, receipts,
 * insurance claims, lab reports, purchase orders, etc.
 */

// ── Brand Colors & Constants ─────────────────────────────────────
const BRAND = {
  primary: '#1A7A75',
  primaryLight: 'rgba(26,122,117,0.06)',
  primaryBorder: '#4ECDC4',
  dark: '#1e293b',
  gray: '#64748b',
  lightBg: '#f8fafc',
  border: '#e2e8f0',
  tableHeader: '#f1f5f9',
  white: '#ffffff',
  success: '#059669',
  danger: '#dc2626',
  warning: '#d97706',
};

// ── Shared CSS ───────────────────────────────────────────────────
function getDocumentCSS() {
  return `
    @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; background: #f0f0f0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: ${BRAND.dark}; font-size: 12px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .ic-page {
      width: 210mm; min-height: 297mm; margin: 0 auto;
      padding: 20mm 18mm 25mm 18mm; background: ${BRAND.white};
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    @media print {
      html, body { background: #fff; }
      .ic-page { width: 100%; min-height: auto; margin: 0; padding: 15mm; box-shadow: none; }
    }

    /* ── Header ── */
    .ic-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 24px; border-bottom: 3px solid ${BRAND.primary}; padding-bottom: 16px;
    }
    .ic-logo { font-size: 22px; font-weight: 700; color: ${BRAND.primary}; font-style: normal; }
    .ic-logo-sub {
      font-size: 9px; color: ${BRAND.gray}; text-transform: uppercase;
      letter-spacing: 2px; margin-top: 2px; font-style: normal;
    }
    .ic-doc-badge {
      background: ${BRAND.primary}; color: white; padding: 6px 14px;
      border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-block;
    }
    .ic-header-right { text-align: right; }
    .ic-header-meta { font-size: 11px; color: ${BRAND.gray}; margin-top: 6px; }

    /* ── Info Grid ── */
    .ic-info-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;
    }
    .ic-info-box {
      background: ${BRAND.lightBg}; border: 1px solid ${BRAND.border};
      border-radius: 6px; padding: 14px;
    }
    .ic-info-box h3 {
      margin: 0 0 8px 0; font-size: 10px; text-transform: uppercase;
      color: ${BRAND.gray}; letter-spacing: 1px; font-weight: 700;
    }
    .ic-info-row { margin-bottom: 3px; font-size: 11px; }
    .ic-info-label { color: ${BRAND.gray}; display: inline-block; min-width: 110px; }
    .ic-info-value { font-weight: 600; }

    /* ── Section Title ── */
    .ic-section-title { font-size: 14px; font-weight: 700; margin: 20px 0 12px 0; color: ${BRAND.dark}; }

    /* ── Table ── */
    .ic-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .ic-table th {
      background: ${BRAND.tableHeader}; padding: 8px 8px; text-align: left;
      font-size: 10px; text-transform: uppercase; color: #475569;
      border-bottom: 2px solid ${BRAND.border}; font-weight: 700; letter-spacing: 0.5px;
    }
    .ic-table th.right { text-align: right; }
    .ic-table th.center { text-align: center; }
    .ic-table td { padding: 7px 8px; font-size: 11px; border-bottom: 1px solid ${BRAND.border}; }
    .ic-table td.right { text-align: right; }
    .ic-table td.center { text-align: center; }
    .ic-table td.bold { font-weight: 600; }
    .ic-table tr.sub-row td {
      background: #f8fafc; padding-left: 36px; font-size: 11px; color: ${BRAND.gray};
      border-bottom: 1px solid #f1f5f9;
    }
    .ic-table tfoot td {
      font-weight: 700; border-top: 2px solid ${BRAND.border};
      padding: 8px; background: ${BRAND.tableHeader};
    }

    /* ── Summary Box ── */
    .ic-summary {
      text-align: right; margin-top: 8px; padding: 14px 18px;
      background: ${BRAND.primaryLight}; border: 1px solid ${BRAND.primaryBorder};
      border-radius: 6px;
    }
    .ic-summary-row { margin-bottom: 4px; font-size: 12px; }
    .ic-summary-label { color: ${BRAND.gray}; margin-right: 8px; }
    .ic-summary-total { font-size: 18px; font-weight: 700; color: ${BRAND.primary}; }

    /* ── Notes ── */
    .ic-notes {
      margin-top: 20px; padding: 12px; background: #fffbeb;
      border: 1px solid #fde68a; border-radius: 6px; font-size: 12px;
    }

    /* ── Signatures ── */
    .ic-signatures {
      display: flex; justify-content: space-around; padding: 30px 20px 10px; margin-top: 20px;
    }
    .ic-sig-block { text-align: center; min-width: 180px; }
    .ic-sig-img { max-width: 160px; max-height: 55px; display: block; margin: 0 auto 4px; object-fit: contain; }
    .ic-sig-line { border-top: 1px solid #333; margin-bottom: 6px; width: 100%; }
    .ic-sig-label { font-size: 11px; font-weight: 700; color: ${BRAND.dark}; }
    .ic-sig-name { font-size: 10px; color: ${BRAND.gray}; margin-top: 2px; }

    /* ── Footer ── */
    .ic-footer {
      margin-top: 30px; padding-top: 16px; border-top: 1px solid ${BRAND.border};
      font-size: 10px; color: ${BRAND.gray};
    }
    .ic-footer p { margin: 0 0 3px 0; }

    /* ── Utilities ── */
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .text-bold { font-weight: 700; }
    .text-primary { color: ${BRAND.primary}; }
    .text-success { color: ${BRAND.success}; }
    .text-danger { color: ${BRAND.danger}; }
    .text-gray { color: ${BRAND.gray}; }
    .mt-1 { margin-top: 8px; }
    .mt-2 { margin-top: 16px; }
    .mb-1 { margin-bottom: 8px; }
  `;
}

// ── Build full HTML document ─────────────────────────────────────
function buildDocument(opts) {
  const { title, docType, docNumber, status, date, bodyHTML, extraCSS, autoPrint = true, facilityInfo, branchInfo } = opts;
  const subtitle = docType || 'DOCUMENT';
  const css = getDocumentCSS() + (extraCSS || '');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title || 'IntelliCare Document'}</title>
  <style>${css}</style>
</head>
<body>
<div class="ic-page">
  <div class="ic-header">
    <div>
      <div class="ic-logo">${(facilityInfo && facilityInfo.name) || ''}</div>
      ${(facilityInfo && facilityInfo.type) ? `<div class="ic-logo-sub">${facilityInfo.type}</div>` : `<div class="ic-logo-sub">${docType}</div>`}
      ${(facilityInfo && facilityInfo.address) ? `<div style="font-size:10px;color:#64748b;margin-top:3px">${facilityInfo.address}${facilityInfo.city ? ', ' + facilityInfo.city : ''}</div>` : ''}
      ${(facilityInfo && facilityInfo.phone) ? `<div style="font-size:10px;color:#64748b">Tel: ${facilityInfo.phone}${facilityInfo.email ? '  |  ' + facilityInfo.email : ''}</div>` : ''}
      ${(facilityInfo && facilityInfo.licenseNo) ? `<div style="font-size:10px;color:#64748b">License: ${facilityInfo.licenseNo}</div>` : ''}
      ${(branchInfo && branchInfo.name) ? `<div style="font-size:10px;color:#64748b;margin-top:2px"><strong>Branch:</strong> ${branchInfo.name}${branchInfo.address ? ' — ' + branchInfo.address : ''}${branchInfo.phone ? ' | ' + branchInfo.phone : ''}</div>` : ''}
    </div>
    <div class="ic-header-right">
      <div class="ic-logo-sub" style="text-align:right;margin-bottom:6px">${docType}</div>
      ${docNumber ? `<div class="ic-doc-badge">${docNumber}</div>` : ''}
      ${status ? `<div class="ic-header-meta">Status: ${status.toUpperCase()}</div>` : ''}
      ${date ? `<div class="ic-header-meta">Date: ${formatDate(date)}</div>` : ''}
    </div>
  </div>

  ${bodyHTML}

  <div class="ic-footer">
    <p>This document was generated by IntelliCare Health Management System.</p>
    <p>${docNumber ? `Reference: ${docNumber} | ` : ''}Generated: ${new Date().toLocaleString()}</p>
    <p>For enquiries, please reference the document number above.</p>
  </div>
</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;
}

// ── Build info grid (two-column info boxes) ──────────────────────
function buildInfoGrid(leftBox, rightBox) {
  const renderBox = (box) => {
    if (!box) return '';
    const rows = (box.rows || []).map(r =>
      `<div class="ic-info-row"><span class="ic-info-label">${r.label}:</span>${r.bold ? '<strong>' : ''}${r.value || '-'}${r.bold ? '</strong>' : ''}</div>`
    ).join('');
    return `<div class="ic-info-box"><h3>${box.title || ''}</h3>${rows}</div>`;
  };
  return `<div class="ic-info-grid">${renderBox(leftBox)}${renderBox(rightBox)}</div>`;
}

// ── Build standard table ─────────────────────────────────────────
function buildTable({ columns, rows, footerRow }) {
  const thCells = columns.map(c =>
    `<th${c.align === 'right' ? ' class="right"' : c.align === 'center' ? ' class="center"' : ''}${c.width ? ` style="width:${c.width}"` : ''}>${c.label}</th>`
  ).join('');

  const bodyRows = rows.map(row => {
    if (row.isSubRow) {
      const cells = columns.map((c, i) => {
        const val = row.cells[i] || '';
        return `<td${c.align === 'right' ? ' class="right"' : c.align === 'center' ? ' class="center"' : ''}>${val}</td>`;
      }).join('');
      return `<tr class="sub-row">${cells}</tr>`;
    }
    const cells = columns.map((c, i) => {
      const val = row.cells[i] || '';
      const classes = [c.align === 'right' ? 'right' : '', c.align === 'center' ? 'center' : '', row.bold ? 'bold' : ''].filter(Boolean).join(' ');
      return `<td${classes ? ` class="${classes}"` : ''}>${val}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  let footerHTML = '';
  if (footerRow) {
    const cells = columns.map((c, i) => {
      const val = footerRow[i] || '';
      return `<td${c.align === 'right' ? ' class="right"' : c.align === 'center' ? ' class="center"' : ''}>${val}</td>`;
    }).join('');
    footerHTML = `<tfoot><tr>${cells}</tr></tfoot>`;
  }

  return `<table class="ic-table"><thead><tr>${thCells}</tr></thead><tbody>${bodyRows}</tbody>${footerHTML}</table>`;
}

// ── Build summary box ────────────────────────────────────────────
function buildSummary(rows) {
  const rowsHTML = rows.map(r => {
    if (r.isTotal) {
      return `<div class="ic-summary-total">${r.label}: ${r.value}</div>`;
    }
    return `<div class="ic-summary-row"><span class="ic-summary-label">${r.label}:</span> <strong>${r.value}</strong></div>`;
  }).join('');
  return `<div class="ic-summary">${rowsHTML}</div>`;
}

// ── Build notes section ──────────────────────────────────────────
function buildNotes(notes) {
  if (!notes) return '';
  return `<div class="ic-notes"><strong>Notes:</strong> ${notes}</div>`;
}

// ── Build signatures ─────────────────────────────────────────────
function buildSignatures(signers) {
  if (!signers || signers.length === 0) return '';
  const blocks = signers.map(s =>
    `<div class="ic-sig-block">${s.signature ? `<img class="ic-sig-img" src="${s.signature}" alt="signature" />` : '<div style="height:55px"></div>'}<div class="ic-sig-line"></div><div class="ic-sig-label">${s.label}</div>${s.name ? `<div class="ic-sig-name">${s.name}</div>` : ''}</div>`
  ).join('');
  return `<div class="ic-signatures">${blocks}</div>`;
}

// ── Helpers ──────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount, currency) {
  currency = currency || 'SSP';
  return `${currency} ${parseFloat(amount || 0).toFixed(2)}`;
}

module.exports = {
  BRAND,
  getDocumentCSS,
  buildDocument,
  buildInfoGrid,
  buildTable,
  buildSummary,
  buildNotes,
  buildSignatures,
  formatDate,
  formatCurrency,
};

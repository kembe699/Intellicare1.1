const PDFDocument = require('pdfkit');

// ── IntelliCare Brand Constants (matches documentTemplate.js) ──
const COLORS = {
  primary: '#0055CC',
  primaryLight: '#f0f9ff',
  primaryBorder: '#bae6fd',
  dark: '#1e293b',
  gray: '#64748b',
  lightBg: '#f8fafc',
  white: '#FFFFFF',
  border: '#e2e8f0',
  tableHeader: '#f1f5f9',
  success: '#059669',
  danger: '#dc2626',
};

const MARGIN = 42; // ~15mm
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

class PDFGenerator {
  constructor() {
    this.doc = null;
    this.y = 0;
  }

  // ══════════════════════════════════════════
  // PUBLIC: Generate a PDF buffer for a document type
  // ══════════════════════════════════════════
  async generate(type, data) {
    return new Promise((resolve, reject) => {
      try {
        this.doc = new PDFDocument({
          size: 'A4',
          margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          info: {
            Title: `${type.toUpperCase()} - ${data.documentNumber || ''}`,
            Author: (data.company && data.company.name) || 'IntelliCare HMIS',
            Creator: 'IntelliCare Health Management System',
          },
        });

        const chunks = [];
        this.doc.on('data', (chunk) => chunks.push(chunk));
        this.doc.on('end', () => resolve(Buffer.concat(chunks)));
        this.doc.on('error', reject);

        this.y = MARGIN;
        this._drawHeader(type, data);
        this._drawInfoGrid(type, data);
        this._drawSectionTitle(type);
        this._drawItemsTable(data);
        this._drawSummary(data);
        this._drawNotes(data);
        this._drawDoneBy(data);
        this._drawFooter(data);

        this.doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ══════════════════════════════════════════
  // HEADER — matches IC template: logo left, badge+status right, blue separator
  // ══════════════════════════════════════════
  _drawHeader(type, data) {
    const doc = this.doc;
    const subtitles = {
      invoice: 'Invoice Document',
      receipt: 'Payment Receipt',
      bill: 'Patient Bill',
      report: 'Report',
    };
    const subtitle = subtitles[type] || type.toUpperCase();

    this.y = MARGIN;

    const company = data.company || {};
    let textX = MARGIN;
    const logoBuf = company.logo ? this._decodeLogo(company.logo) : null;
    if (logoBuf) {
      try {
        doc.image(logoBuf, MARGIN, this.y, { fit: [36, 36] });
        textX = MARGIN + 46;
      } catch { /* malformed logo data — fall back to text-only header */ }
    }

    // Facility name in blue bold (was hardcoded "IntelliCare" — now the tenant's real facility)
    doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.primary);
    doc.text(company.name || 'Facility', textX, this.y, { width: 300 });

    // Subtitle — uppercase tracking
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.gray);
    doc.text(subtitle.toUpperCase(), textX, this.y + 26, { characterSpacing: 1.5 });

    // Right side — document badge
    if (data.documentNumber) {
      const badgeText = data.documentNumber;
      const badgeW = doc.widthOfString(badgeText, { fontSize: 10 }) + 24;
      const badgeX = PAGE_WIDTH - MARGIN - badgeW;
      const badgeY = this.y;
      // Blue rounded badge
      doc.roundedRect(badgeX, badgeY, badgeW, 22, 6).fill(COLORS.primary);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.white);
      doc.text(badgeText, badgeX, badgeY + 6, { width: badgeW, align: 'center' });
    }

    // Status & date below badge
    const metaX = PAGE_WIDTH - MARGIN - 160;
    let metaY = this.y + 28;
    if (data.status) {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray);
      doc.text(`Status: ${data.status.toUpperCase()}`, metaX, metaY, { width: 160, align: 'right' });
      metaY += 13;
    }
    if (data.date) {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray);
      doc.text(`Date: ${this._formatDate(data.date)}`, metaX, metaY, { width: 160, align: 'right' });
      metaY += 13;
    }

    this.y = Math.max(this.y + 45, metaY + 5);

    // Blue separator line (3pt like the HTML template)
    doc.moveTo(MARGIN, this.y).lineTo(PAGE_WIDTH - MARGIN, this.y)
      .strokeColor(COLORS.primary).lineWidth(2.5).stroke();
    this.y += 18;
  }

  // ══════════════════════════════════════════
  // INFO GRID — two-column info boxes with light bg
  // ══════════════════════════════════════════
  _drawInfoGrid(type, data) {
    const doc = this.doc;
    const company = data.company || {};
    const boxW = (CONTENT_WIDTH - 12) / 2;
    const boxH = 80;
    const leftX = MARGIN;
    const rightX = MARGIN + boxW + 12;
    const startY = this.y;

    // Left box — document details
    doc.roundedRect(leftX, startY, boxW, boxH, 4).fill(COLORS.lightBg);
    doc.roundedRect(leftX, startY, boxW, boxH, 4).strokeColor(COLORS.border).lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.gray);
    doc.text(this._getLeftBoxTitle(type), leftX + 12, startY + 10, { characterSpacing: 0.8 });

    const leftRows = this._getLeftBoxRows(type, data);
    let ly = startY + 24;
    for (const row of leftRows) {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray);
      doc.text(row.label + ':', leftX + 12, ly, { continued: false, width: 90 });
      doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(COLORS.dark);
      doc.text(row.value, leftX + 105, ly, { width: boxW - 115 });
      ly += 13;
    }

    // Right box — company/patient info
    doc.roundedRect(rightX, startY, boxW, boxH, 4).fill(COLORS.lightBg);
    doc.roundedRect(rightX, startY, boxW, boxH, 4).strokeColor(COLORS.border).lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.gray);
    doc.text(data.customerName ? 'PATIENT / CUSTOMER' : 'FACILITY DETAILS', rightX + 12, startY + 10, { characterSpacing: 0.8 });

    const rightRows = [];
    if (data.customerName) {
      rightRows.push({ label: 'Name', value: data.customerName, bold: true });
    }
    if (company.name) rightRows.push({ label: 'Facility', value: company.name });
    if (company.address) rightRows.push({ label: 'Address', value: company.address });
    if (company.phone) rightRows.push({ label: 'Phone', value: company.phone });
    if (company.email) rightRows.push({ label: 'Email', value: company.email });

    let ry = startY + 24;
    for (const row of rightRows) {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray);
      doc.text(row.label + ':', rightX + 12, ry, { width: 90 });
      doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(COLORS.dark);
      doc.text(row.value, rightX + 105, ry, { width: boxW - 115 });
      ry += 13;
    }

    this.y = startY + boxH + 16;
  }

  _getLeftBoxTitle(type) {
    const titles = { invoice: 'INVOICE DETAILS', bill: 'BILL DETAILS', receipt: 'RECEIPT DETAILS' };
    return titles[type] || 'DOCUMENT DETAILS';
  }

  _getLeftBoxRows(type, data) {
    const currency = data.currency || 'SSP';
    const rows = [];
    if (data.documentNumber) {
      const label = type === 'invoice' ? 'Invoice #' : type === 'receipt' ? 'Receipt #' : type === 'bill' ? 'Bill #' : 'Doc #';
      rows.push({ label, value: data.documentNumber, bold: true });
    }
    if (data.date) rows.push({ label: 'Date', value: this._formatDate(data.date) });
    if (data.dueDate) rows.push({ label: 'Due Date', value: this._formatDate(data.dueDate) });
    if (data.status) rows.push({ label: 'Status', value: data.status.toUpperCase() });
    if (data.total !== undefined) rows.push({ label: 'Total', value: `${currency} ${this._fmt(data.total)}`, bold: true });
    return rows;
  }

  // ══════════════════════════════════════════
  // SECTION TITLE
  // ══════════════════════════════════════════
  _drawSectionTitle(type) {
    const doc = this.doc;
    const titles = { invoice: 'Itemized Breakdown', bill: 'Services', receipt: 'Payment Details' };
    const title = titles[type] || 'Items';
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.dark);
    doc.text(title, MARGIN, this.y);
    this.y += 18;
  }

  // ══════════════════════════════════════════
  // ITEMS TABLE — clean with light header matching IC template
  // ══════════════════════════════════════════
  _drawItemsTable(data) {
    const items = data.items || [];
    if (items.length === 0) return;
    const doc = this.doc;

    const colWidths = {
      desc: CONTENT_WIDTH * 0.45,
      qty: CONTENT_WIDTH * 0.12,
      unit: CONTENT_WIDTH * 0.2,
      amount: CONTENT_WIDTH * 0.23,
    };
    const cols = [
      { x: MARGIN, w: colWidths.desc },
      { x: MARGIN + colWidths.desc, w: colWidths.qty },
      { x: MARGIN + colWidths.desc + colWidths.qty, w: colWidths.unit },
      { x: MARGIN + colWidths.desc + colWidths.qty + colWidths.unit, w: colWidths.amount },
    ];

    // Table header — light background with uppercase labels
    const headerH = 24;
    doc.rect(MARGIN, this.y, CONTENT_WIDTH, headerH).fill(COLORS.tableHeader);
    doc.moveTo(MARGIN, this.y + headerH).lineTo(PAGE_WIDTH - MARGIN, this.y + headerH)
      .strokeColor(COLORS.border).lineWidth(1.5).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569');
    const headerY = this.y + 8;
    doc.text('DESCRIPTION', cols[0].x + 8, headerY, { width: cols[0].w - 10, characterSpacing: 0.5 });
    doc.text('QTY', cols[1].x + 4, headerY, { width: cols[1].w - 8, align: 'center', characterSpacing: 0.5 });
    doc.text('UNIT PRICE', cols[2].x + 4, headerY, { width: cols[2].w - 8, align: 'right', characterSpacing: 0.5 });
    doc.text('AMOUNT', cols[3].x + 4, headerY, { width: cols[3].w - 8, align: 'right', characterSpacing: 0.5 });
    this.y += headerH;

    // Table rows
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowH = 22;

      // Check for page break
      if (this.y + rowH > PAGE_HEIGHT - 120) {
        this._drawFooter(data);
        doc.addPage();
        this.y = MARGIN;
      }

      // Bottom border for each row
      doc.moveTo(MARGIN, this.y + rowH).lineTo(PAGE_WIDTH - MARGIN, this.y + rowH)
        .strokeColor(COLORS.border).lineWidth(0.5).stroke();

      const rowY = this.y + 7;
      const currency = item.currency || data.currency || 'SSP';

      doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark);
      doc.text(item.description || item.name || 'Service', cols[0].x + 8, rowY, { width: cols[0].w - 10 });
      doc.text(String(item.quantity || 1), cols[1].x + 4, rowY, { width: cols[1].w - 8, align: 'center' });
      doc.text(`${currency} ${this._fmt(item.unitPrice || item.unit_price || item.price || 0)}`, cols[2].x + 4, rowY, { width: cols[2].w - 8, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(`${currency} ${this._fmt(item.amount || item.totalPrice || item.total_price || 0)}`, cols[3].x + 4, rowY, { width: cols[3].w - 8, align: 'right' });

      this.y += rowH;
    }

    this.y += 8;
  }

  // ══════════════════════════════════════════
  // SUMMARY — blue highlighted box matching IC template
  // ══════════════════════════════════════════
  _drawSummary(data) {
    const doc = this.doc;
    const currency = data.currency || 'SSP';

    // Summary box background
    const boxX = PAGE_WIDTH - MARGIN - 240;
    const boxW = 240;
    let boxH = 20;
    const summaryRows = [];

    if (data.subtotal !== undefined) summaryRows.push({ label: 'Subtotal', value: `${currency} ${this._fmt(data.subtotal)}` });
    if (data.discount) summaryRows.push({ label: 'Discount', value: `- ${currency} ${this._fmt(data.discount)}`, color: COLORS.danger });

    const total = data.total || data.amount || data.totalAmount || 0;
    summaryRows.push({ label: 'Total', value: `${currency} ${this._fmt(total)}`, isTotal: true });

    if (data.amountPaid !== undefined) {
      summaryRows.push({ label: 'Amount Paid', value: `${currency} ${this._fmt(data.amountPaid)}`, color: COLORS.success });
    }
    if (data.balanceDue !== undefined) {
      summaryRows.push({ label: 'Balance Due', value: `${currency} ${this._fmt(data.balanceDue)}`, bold: true, color: COLORS.danger });
    }

    boxH = summaryRows.length * 18 + 16;

    // Draw blue-tinted box
    doc.roundedRect(boxX, this.y, boxW, boxH, 5).fill(COLORS.primaryLight);
    doc.roundedRect(boxX, this.y, boxW, boxH, 5).strokeColor(COLORS.primaryBorder).lineWidth(0.5).stroke();

    let sy = this.y + 10;
    for (const row of summaryRows) {
      if (row.isTotal) {
        doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.primary);
        doc.text(row.label + ':', boxX + 14, sy, { width: 90 });
        doc.text(row.value, boxX + 104, sy, { width: boxW - 120, align: 'right' });
        sy += 22;
      } else {
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(row.color || COLORS.gray);
        doc.text(row.label + ':', boxX + 14, sy, { width: 90 });
        doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(row.color || COLORS.dark);
        doc.text(row.value, boxX + 104, sy, { width: boxW - 120, align: 'right' });
        sy += 16;
      }
    }

    this.y += boxH + 14;
  }

  // ══════════════════════════════════════════
  // NOTES
  // ══════════════════════════════════════════
  _drawNotes(data) {
    if (!data.notes) return;
    const doc = this.doc;

    // Yellow-tinted notes box matching IC template
    const noteH = doc.heightOfString(data.notes, { width: CONTENT_WIDTH - 24 }) + 28;
    doc.roundedRect(MARGIN, this.y, CONTENT_WIDTH, noteH, 5).fill('#fffbeb');
    doc.roundedRect(MARGIN, this.y, CONTENT_WIDTH, noteH, 5).strokeColor('#fde68a').lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.dark);
    doc.text('Notes:', MARGIN + 12, this.y + 10);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark);
    doc.text(data.notes, MARGIN + 12, this.y + 22, { width: CONTENT_WIDTH - 24 });
    this.y += noteH + 10;
  }

  // ══════════════════════════════════════════
  // DONE BY — who issued/created this document
  // ══════════════════════════════════════════
  _drawDoneBy(data) {
    if (!data.createdByName) return;
    const doc = this.doc;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.gray);
    doc.text(`Done By: ${data.createdByName}`, MARGIN, this.y);
    this.y += 18;
  }

  // ══════════════════════════════════════════
  // FOOTER — matches IC template footer
  // ══════════════════════════════════════════
  _drawFooter(data) {
    const doc = this.doc;
    // Must stay above PAGE_HEIGHT - MARGIN (the printable area's bottom edge) —
    // this used to sit right at that boundary, which made PDFKit silently
    // auto-paginate each footer line onto its own near-blank trailing page.
    const footerY = PAGE_HEIGHT - MARGIN - 50;

    // Separator
    doc.moveTo(MARGIN, footerY).lineTo(PAGE_WIDTH - MARGIN, footerY)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();

    const facilityLabel = (data.company && data.company.name) || 'the facility';
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.gray);
    doc.text(
      `This document was generated by ${facilityLabel} — powered by IntelliCare HMIS.`,
      MARGIN, footerY + 8, { width: CONTENT_WIDTH }
    );
    const refLine = data && data.documentNumber
      ? `Reference: ${data.documentNumber} | Generated: ${new Date().toLocaleString()}`
      : `Generated: ${new Date().toLocaleString()}`;
    doc.text(refLine, MARGIN, footerY + 20, { width: CONTENT_WIDTH });
    doc.text('For enquiries, please reference the document number above.', MARGIN, footerY + 32, { width: CONTENT_WIDTH });
  }

  // ── Helpers ──
  _decodeLogo(dataUri) {
    try {
      const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUri || '');
      if (!match) return null;
      return Buffer.from(match[2], 'base64');
    } catch { return null; }
  }

  _fmt(num) {
    return parseFloat(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  _formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
  }
}

module.exports = new PDFGenerator();

/**
 * DHIS2 monthly report — vector PDF export.
 *
 * A genuine jsPDF + jspdf-autotable table build (not the html2canvas screenshot
 * approach in documentTemplate.ts's downloadDocumentAsPdf), since a paper form
 * with many small bordered tables needs crisp vector text, not a raster image.
 * Brand colors mirror documentTemplate.ts's BRAND palette.
 */
import jsPDF, { GState } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FacilityInfo } from '@/hooks/useFacilityInfo';

const BRAND = {
  primary: [26, 122, 117] as [number, number, number],
  dark: [15, 23, 42] as [number, number, number],
  gray: [100, 116, 139] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  amber: [217, 119, 6] as [number, number, number],
};

type AgeSexRow = { u5m: number; u5f: number; ge5m: number; ge5f: number; unknown: number; total: number };

function ageSexRowToCells(row: AgeSexRow | undefined) {
  const r = row || { u5m: 0, u5f: 0, ge5m: 0, ge5f: 0, unknown: 0, total: 0 };
  return [r.u5m, r.u5f, r.ge5m, r.ge5f, r.unknown, r.total];
}

export async function buildDhis2Pdf(
  definition: any,
  saved: any,
  facilityInfo: FacilityInfo,
  header: Record<string, any>,
  period: string,
) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  const isDraft = saved.status !== 'final';
  const computed = typeof saved.computed_values === 'string' ? JSON.parse(saved.computed_values) : saved.computed_values;
  const overrides = typeof saved.overrides === 'string' ? JSON.parse(saved.overrides) : (saved.overrides || {});
  const signoff = typeof saved.signoff === 'string' ? JSON.parse(saved.signoff) : (saved.signoff || {});

  const facilityCode = header.facility_code || 'FACILITY';

  // ── Header band ──
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, pageWidth, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...BRAND.dark);
  doc.text(facilityInfo.facilityName || 'Health Facility', margin, 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.gray);
  doc.text(facilityInfo.branchName || '', margin, 47);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND.primary);
  doc.text('DHIS2 Monthly HMIS Facility Report', pageWidth - margin, 34, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.gray);
  doc.text(`Period: ${period}`, pageWidth - margin, 47, { align: 'right' });

  doc.setDrawColor(...BRAND.border);
  doc.line(margin, 56, pageWidth - margin, 56);

  let y = 70;

  // ── Report header fields ──
  const headerRows = (definition.headerFields || []).map((f: any) => {
    const val = f.source === 'branch' ? (facilityInfo.branchName || '—') : (header[f.id] ?? '—');
    return [f.label, String(val)];
  });
  headerRows.push(['Reporting Month', period]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, textColor: BRAND.dark as any, lineColor: BRAND.border as any },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [241, 245, 249] as any, cellWidth: 160 } },
    body: headerRows,
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  const ensureSpace = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 40;
    }
  };

  const sectionTitle = (title: string) => {
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.primary);
    doc.text(title, margin, y);
    y += 8;
  };

  const AGE_SEX_HEAD = ['Indicator', '<5 M', '<5 F', '≥5 M', '≥5 F', 'Unknown', 'Total'];

  // ── Section A ──
  sectionTitle(`A. ${definition.sections.A.title}`);
  const aBody = (definition.sections.A.rows || []).map((row: any) => [
    row.label, ...ageSexRowToCells(computed.sections.A[row.id]),
  ]);
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid',
    head: [AGE_SEX_HEAD],
    headStyles: { fillColor: BRAND.primary as any, textColor: 255, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 4, lineColor: BRAND.border as any },
    body: aBody,
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  // ── Section B ──
  sectionTitle(`B. ${definition.sections.B.title}`);
  const bBody = (definition.sections.B.rows || []).map((row: any) => [
    row.label, ...ageSexRowToCells(computed.sections.B[row.id]),
  ]);
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid',
    head: [AGE_SEX_HEAD],
    headStyles: { fillColor: BRAND.primary as any, textColor: 255, fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 4, lineColor: BRAND.border as any },
    body: bBody,
  });
  y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.amber);
  doc.text('Estimated from free-text diagnoses. Review before submitting.', margin, y);
  y += 14;

  // ── Section C ──
  sectionTitle(`C. ${definition.sections.C.title}`);
  const cBody = (definition.sections.C.rows || []).map((row: any) => {
    const c = computed.sections.C[row.id] || { tested: 0, positive: 0, pct_positive: 0 };
    const o = overrides.C?.[row.id] || {};
    const tested = o.tested ?? c.tested;
    const positive = o.positive ?? c.positive;
    const pct = o.pct_positive ?? c.pct_positive;
    return [row.label, tested, positive, `${Number(pct).toFixed(1)}%`];
  });
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid',
    head: [['Test', 'Tested', 'Positive', '% positive']],
    headStyles: { fillColor: BRAND.primary as any, textColor: 255, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 4, lineColor: BRAND.border as any },
    body: cBody,
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  // ── Sections D & E (manual) ──
  (['D', 'E'] as const).forEach((secId) => {
    sectionTitle(`${secId}. ${definition.sections[secId].title} (entered manually)`);
    const body = (definition.sections[secId].rows || []).map((row: any) => [row.label, overrides[secId]?.[row.id] ?? 0]);
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin }, theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, lineColor: BRAND.border as any },
      columnStyles: { 1: { halign: 'right', cellWidth: 80 } },
      body,
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  });

  // ── Section F ──
  sectionTitle(`F. ${definition.sections.F.title}`);
  const fBody = (definition.sections.F.rows || []).map((row: any) => [
    row.label, overrides.F?.[row.id] ?? computed.sections.F[row.id] ?? 0,
  ]);
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, lineColor: BRAND.border as any },
    columnStyles: { 1: { halign: 'right', cellWidth: 80 } },
    body: fBody,
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  // ── Section G ──
  sectionTitle(`G. ${definition.sections.G.title}`);
  const gBody = (definition.sections.G.defaultItems || []).map((row: any) => {
    const c = computed.sections.G[row.id] || { opening: 0, received: 0, used: 0, closing: 0, daysOutOfStock: 0 };
    const o = overrides.G?.[row.id] || {};
    return [
      row.label,
      o.opening ?? c.opening, o.received ?? c.received, o.used ?? c.used, o.closing ?? c.closing, o.daysOutOfStock ?? c.daysOutOfStock,
    ];
  });
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid',
    head: [['Item', 'Opening', 'Received', 'Used', 'Closing', 'Days out of stock']],
    headStyles: { fillColor: BRAND.primary as any, textColor: 255, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 4, lineColor: BRAND.border as any },
    body: gBody,
  });
  y = (doc as any).lastAutoTable.finalY + 20;

  // ── Section H — sign-off ──
  ensureSpace(90);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.primary);
  doc.text(`H. ${definition.sections.H.title}`, margin, y);
  y += 20;

  const fields = definition.sections.H.fields || [];
  const colWidth = (pageWidth - margin * 2) / 2;
  fields.forEach((f: any, i: number) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * colWidth;
    const lineY = y + row * 34;
    doc.setDrawColor(...BRAND.border);
    doc.line(x, lineY, x + colWidth - 16, lineY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.dark);
    doc.text(String(signoff[f.id] || ''), x, lineY - 3);
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.gray);
    doc.text(f.label, x, lineY + 10);
  });
  y += Math.ceil(fields.length / 2) * 34 + 20;

  // ── Footer ──
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const h = doc.internal.pageSize.getHeight();
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.gray);
    doc.text(`Generated by Intellicare — ${new Date().toLocaleString()}`, margin, h - 20);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, h - 20, { align: 'right' });

    if (isDraft) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(60);
      doc.setTextColor(...BRAND.amber);
      const w = doc.internal.pageSize.getWidth();
      doc.setGState(new GState({ opacity: 0.15 }));
      doc.text('DRAFT', w / 2, h / 2, { align: 'center', angle: 35 });
      doc.setGState(new GState({ opacity: 1 }));
    }
  }

  doc.save(`DHIS2_${facilityCode}_${period}.pdf`);
}

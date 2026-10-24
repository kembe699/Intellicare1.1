import React from 'react';
import { format } from 'date-fns';
import { useCurrency } from '@/contexts/CurrencyContext';

interface PaymentReceiptProps {
  bill: {
    id: string;
    billNumber: string;
    patientName: string;
    patientId: string;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    billDate: string;
    services: Array<{
      id?: string;
      serviceName?: string;
      name?: string;
      service_name?: string;
      quantity?: number;
      unitPrice?: number;
      unit_price?: number;
      totalPrice?: number;
      total_price?: number;
      price?: number;
      discountLabel?: string | null;
    }>;
  };
  payment: {
    amount: number;
    method: string;
    date: string;
    notes?: string;
    from_lease: boolean;
    lease_details?: string;
    cashierName?: string;
    cashierId?: string;
  };
  clinicName?: string;
  facilityName?: string;
  branchName?: string;
  receiptNumber?: string;
}

// Thermal-printer rules (from earlier fading complaints): solid black only —
// these heads are effectively 1-bit, so greys print as nothing — and no
// stroke lighter than weight 600. Rules are drawn with real borders (crisp
// on any printer) instead of rows of dashes, every label/value pair is a
// table row so it never wraps onto two lines, and there are only three
// type sizes: 16px name, 12px body, 11px small print.
const INK = '#000';
const BODY = 12;
const SMALL = 11;
const ruleSolid: React.CSSProperties = { borderTop: `1.5px solid ${INK}`, margin: '8px 0' };
const ruleDashed: React.CSSProperties = { borderTop: `1px dashed ${INK}`, margin: '7px 0' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const tdLabel: React.CSSProperties = { fontSize: BODY, fontWeight: 600, padding: '1.5px 0', verticalAlign: 'top', whiteSpace: 'nowrap', paddingRight: 8 };
const tdValue: React.CSSProperties = { fontSize: BODY, fontWeight: 700, padding: '1.5px 0', textAlign: 'right', verticalAlign: 'top', wordBreak: 'break-word' };
const heading: React.CSSProperties = { fontSize: SMALL, fontWeight: 800, letterSpacing: '1.5px', margin: '0 0 4px' };

const InfoRows = ({ rows }: { rows: [string, React.ReactNode][] }) => (
  <table style={table}>
    <tbody>
      {rows.map(([label, value]) => (
        <tr key={label}><td style={tdLabel}>{label}</td><td style={tdValue}>{value}</td></tr>
      ))}
    </tbody>
  </table>
);

export const PaymentReceipt: React.FC<PaymentReceiptProps> = ({
  bill,
  payment,
  clinicName,
  facilityName,
  branchName,
  receiptNumber,
}) => {
  const displayName = facilityName || clinicName || 'IntelliCare HMIS';
  const receiptId = receiptNumber || `RCP-${Date.now().toString().slice(-8)}`;
  const balanceDue = Math.max(0, (bill.totalAmount || 0) - (bill.paidAmount || 0));
  const isPaid = balanceDue === 0;
  // No new cash/card/mobile money actually changed hands here — the patient's own prepaid
  // deposit balance covered this instead, so it's clearly labeled as a settlement
  // confirmation rather than presented as an ordinary payment receipt.
  const isDepositOffset = payment.method === 'deposit';
  const method = isDepositOffset ? 'Deposit offset' : payment.method.charAt(0).toUpperCase() + payment.method.slice(1).replace(/_/g, ' ');

  const { fmt } = useCurrency();

  const thermal: React.CSSProperties = {
    width: '302px',
    margin: '0 auto',
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: BODY,
    fontWeight: 600,
    lineHeight: 1.4,
    color: INK,
    backgroundColor: '#fff',
    padding: '12px 10px 14px',
    boxSizing: 'border-box',
  };

  const infoRows: [string, React.ReactNode][] = [
    ['Receipt No', receiptId],
    ['Date', format(new Date(payment.date), 'dd MMM yyyy, HH:mm')],
    ...(bill.billNumber && bill.billNumber !== receiptId ? [['Bill No', bill.billNumber] as [string, React.ReactNode]] : []),
    ['Patient', bill.patientName || '—'],
  ];

  return (
    <div className="thermal-receipt" style={thermal}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.25 }}>{displayName}</div>
        {branchName && branchName !== displayName && <div style={{ fontSize: SMALL, fontWeight: 600, marginTop: 2 }}>{branchName}</div>}
        <div style={{ display: 'inline-block', marginTop: 8, padding: '3px 10px', border: `1.5px solid ${INK}`, fontSize: SMALL, fontWeight: 800, letterSpacing: '2px' }}>
          {isDepositOffset ? 'DEPOSIT SETTLEMENT' : 'PAYMENT RECEIPT'}
        </div>
      </div>

      {isDepositOffset && (
        <div style={{ textAlign: 'center', fontSize: SMALL, fontWeight: 700, marginTop: 6 }}>
          No cash collected — settled from the patient's deposit
        </div>
      )}

      <div style={ruleSolid} />

      {/* ── Receipt / patient ── */}
      <InfoRows rows={infoRows} />

      <div style={ruleDashed} />

      {/* ── Items ── */}
      {bill.services && bill.services.length > 0 ? (
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...heading, textAlign: 'left', paddingBottom: 3 }}>ITEM</th>
              <th style={{ ...heading, textAlign: 'center', width: 32, paddingBottom: 3 }}>QTY</th>
              <th style={{ ...heading, textAlign: 'right', paddingBottom: 3 }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {bill.services.map((svc, i) => {
              const name = svc.serviceName || svc.name || svc.service_name || (svc as any).test_name || 'Service';
              const qty = svc.quantity || 1;
              const unitPrice = svc.unitPrice || svc.unit_price || svc.price || 0;
              const total = svc.totalPrice || svc.total_price || (unitPrice * qty);
              return (
                <tr key={(svc as any).id || i}>
                  <td style={{ fontSize: BODY, fontWeight: 600, padding: '3px 4px 3px 0', verticalAlign: 'top' }}>
                    {name}
                    {qty > 1 && <div style={{ fontSize: SMALL, fontWeight: 600 }}>@ {fmt(unitPrice)}</div>}
                    {svc.discountLabel && <div style={{ fontSize: SMALL, fontWeight: 600 }}>Discount: {svc.discountLabel}</div>}
                  </td>
                  <td style={{ fontSize: BODY, fontWeight: 700, padding: '3px 0', textAlign: 'center', verticalAlign: 'top' }}>{qty}</td>
                  <td style={{ fontSize: BODY, fontWeight: 700, padding: '3px 0', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{fmt(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: SMALL, fontWeight: 600, fontStyle: 'italic' }}>No item details available</div>
      )}

      <div style={ruleSolid} />

      {/* ── Totals ── */}
      <InfoRows rows={[
        ['Bill total', fmt(bill.totalAmount || 0)],
        ['Paid to date', fmt(bill.paidAmount || 0)],
        ['This payment', fmt(payment.amount)],
      ]} />

      {/* Inverted band: prints as solid black on any thermal head. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, padding: '5px 8px', background: INK, color: '#fff', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.5px' }}>BALANCE DUE</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{fmt(balanceDue)}</span>
      </div>

      {isPaid && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <span style={{ display: 'inline-block', border: `2px solid ${INK}`, padding: '2px 12px', fontSize: BODY, fontWeight: 800, letterSpacing: '3px' }}>PAID IN FULL</span>
        </div>
      )}

      <div style={ruleDashed} />

      {/* ── Payment info ── */}
      <InfoRows rows={[
        ['Method', method],
        ...(payment.cashierName ? [['Received by', payment.cashierName] as [string, React.ReactNode]] : []),
        ...(payment.from_lease ? [['Type', 'Lease payment'] as [string, React.ReactNode]] : []),
      ]} />

      {(payment.notes || payment.lease_details) && (
        <div style={{ fontSize: SMALL, fontWeight: 600, marginTop: 4 }}>
          {payment.notes && <div>Note: {payment.notes}</div>}
          {payment.lease_details && <div>{payment.lease_details}</div>}
        </div>
      )}

      <div style={ruleSolid} />

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: BODY, fontWeight: 800 }}>Thank you for your visit</div>
        <div style={{ fontSize: SMALL, fontWeight: 600, marginTop: 2 }}>Please keep this receipt for your records.</div>
      </div>

    </div>
  );
};

// ── Thermal Print ────────────────────────────────────────────────
export const printThermalReceipt = (receiptElement: HTMLElement) => {
  // Matches the on-screen styles above — a bold sans-serif, solid black, and
  // a 600-weight floor instead of 400 — so what actually reaches the thermal
  // printer isn't thinner than what the cashier previewed. print-color-adjust
  // is kept forced to exact so the browser never lightens "black" for ink
  // economy on what's already a 1-bit thermal head.
  const css = `
    @page { size: 80mm auto; margin: 3mm 2mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      margin: 0; padding: 0; background: #fff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px; font-weight: 600; color: #000;
    }
    .thermal-receipt {
      width: 76mm; margin: 0 auto;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px; font-weight: 600; line-height: 1.4; color: #000;
    }
    table { width: 100%; border-collapse: collapse; }
    @media print {
      html, body { background: #fff; }
      .thermal-receipt { width: 100%; padding: 0; }
    }
  `;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt</title>
  <style>${css}</style>
</head>
<body>
  ${receiptElement.innerHTML}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=400,height=600');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
};

/**
 * Print the off-screen receipt once it has actually rendered.
 *
 * The receipt is mounted off-screen and its innerHTML is snapshotted at print
 * time, so printing before React has painted it produces a receipt with the
 * patient's name and details missing — which is what reached patients. The old
 * code waited a flat 150ms and hoped, which held until the app was busy or the
 * device slow, and then silently failed.
 *
 * This waits for the node to actually carry content instead of guessing, and
 * gives up rather than printing a blank slip: an unprinted receipt can be
 * reprinted from the Receipts page, a blank one handed over cannot be undone.
 */
export const printReceiptWhenPainted = (
  getElement: () => HTMLElement | null,
  onSettled: (printed: boolean) => void,
  timeoutMs = 5000
) => {
  let cancelled = false;
  const startedAt = Date.now();

  const attempt = () => {
    if (cancelled) return;
    const el = getElement();
    if (el && (el.textContent || '').trim().length > 0) {
      printThermalReceipt(el);
      onSettled(true);
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      onSettled(false);
      return;
    }
    requestAnimationFrame(attempt);
  };

  requestAnimationFrame(attempt);
  return () => { cancelled = true; };
};

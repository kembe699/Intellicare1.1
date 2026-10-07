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

const DIVIDER = '--------------------------------';
const THICK_DIVIDER = '================================';

// A client complaint that thermal receipts print faded led to two changes
// here and in the matching print-window CSS below: light gray (#555/#666)
// text barely registers on a thermal head — these printers are effectively
// 1-bit (burn a dot dark or don't), so a mid-gray often prints as nearly
// nothing rather than an actual visible gray — and regular (400) weight
// strokes are thin enough to fade as the printhead wears. Every color here
// is now solid black, and the default row weight is 600 instead of 400 —
// still visually lighter than the explicit bold rows, but with strokes
// thick enough to hold up on worn thermal hardware.
const row = (label: string, value: string, bold = false): React.ReactNode => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
    <span style={{ fontSize: '12px', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: '12px', fontWeight: bold ? 700 : 600, textAlign: 'right', maxWidth: '55%', wordBreak: 'break-word' }}>{value}</span>
  </div>
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

  const { fmt } = useCurrency();

  const thermal: React.CSSProperties = {
    width: '302px',
    margin: '0 auto',
    // Courier New's thin, serif-ish strokes are part of what was fading on
    // thermal paper — a plain bold sans-serif lays down a thicker, more
    // uniform dot pattern per character, which holds up far better on a
    // worn or lower-quality thermal head. Nothing on this receipt depends
    // on monospace column alignment (it's all flex rows), so there's no
    // layout cost to dropping it.
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: '12px',
    lineHeight: '1.5',
    color: '#000',
    backgroundColor: '#fff',
    padding: '12px 10px 16px',
    boxSizing: 'border-box',
  };

  const center: React.CSSProperties = { textAlign: 'center' };
  const divStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#000', textAlign: 'center', margin: '4px 0', letterSpacing: '0.5px' };

  return (
    <div className="thermal-receipt" style={thermal}>

      {/* ── Header ── */}
      <div style={center}>
        <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '1px' }}>{displayName}</div>
        {branchName && <div style={{ fontSize: '10px', fontWeight: 600, marginTop: '1px' }}>{branchName}</div>}
        <div style={{ fontSize: '10px', marginTop: '6px', fontWeight: 700, letterSpacing: '2px' }}>
          {isDepositOffset ? 'DEPOSIT SETTLEMENT CONFIRMATION' : 'PAYMENT RECEIPT'}
        </div>
      </div>

      {isDepositOffset && (
        <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, border: '1px solid #000', padding: '3px 4px', margin: '6px 0 2px', letterSpacing: '0.5px' }}>
          NO CASH COLLECTED — SETTLED FROM PATIENT DEPOSIT
        </div>
      )}

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Receipt / Date ── */}
      {row('Receipt #:', receiptId, true)}
      {row('Date:', format(new Date(payment.date), 'dd/MM/yyyy HH:mm'))}
      {row('Bill #:', bill.billNumber || '-')}

      <div style={divStyle}>{DIVIDER}</div>

      {/* ── Patient ── */}
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '3px' }}>PATIENT</div>
      {row('Name:', bill.patientName)}
      {row('ID:', bill.patientId)}

      <div style={divStyle}>{DIVIDER}</div>

      {/* ── Services ── */}
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '4px' }}>SERVICES</div>
      {bill.services && bill.services.length > 0 ? bill.services.map((svc, i) => {
        const name = svc.serviceName || svc.name || svc.service_name || (svc as any).test_name || 'Service';
        const qty = svc.quantity || 1;
        const unitPrice = svc.unitPrice || svc.unit_price || svc.price || 0;
        const total = svc.totalPrice || svc.total_price || (unitPrice * qty);
        return (
          <div key={(svc as any).id || i} style={{ marginBottom: '5px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600 }}>{name}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#000' }}>{qty} x {fmt(unitPrice)}</span>
              <span style={{ fontSize: '11px', fontWeight: 700 }}>{fmt(total)}</span>
            </div>
            {svc.discountLabel && (
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#000' }}>Discount applied: {svc.discountLabel}</div>
            )}
          </div>
        );
      }) : (
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#000', fontStyle: 'italic' }}>No service details available</div>
      )}

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Totals ── */}
      {row('Bill Total:', fmt(bill.totalAmount || 0))}
      {row('Total Paid:', fmt(bill.paidAmount || 0))}
      {row('This Payment:', fmt(payment.amount), true)}

      <div style={divStyle}>{DIVIDER}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0 4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>BALANCE DUE:</span>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>{fmt(balanceDue)}</span>
      </div>

      {isPaid && (
        <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, border: '1px solid #000', padding: '2px 0', margin: '4px 0', letterSpacing: '2px' }}>
          *** PAID IN FULL ***
        </div>
      )}

      <div style={divStyle}>{DIVIDER}</div>

      {/* ── Payment Info ── */}
      {row('Method:', isDepositOffset ? 'Deposit Offset' : payment.method.charAt(0).toUpperCase() + payment.method.slice(1))}
      {payment.cashierName && row('Received by:', payment.cashierName)}
      {payment.from_lease && row('Type:', 'LEASE PAYMENT')}

      {/* ── Notes ── */}
      {(payment.notes || payment.lease_details) && (
        <>
          <div style={divStyle}>{DIVIDER}</div>
          <div style={{ fontSize: '10px', fontWeight: 600, fontStyle: 'italic', marginTop: '2px' }}>
            {payment.notes && <div>Note: {payment.notes}</div>}
            {payment.lease_details && <div>{payment.lease_details}</div>}
          </div>
        </>
      )}

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', marginTop: '4px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700 }}>Thank you for your visit!</div>
        <div style={{ fontSize: '10px', fontWeight: 600, marginTop: '2px' }}>Please keep this receipt for your records.</div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#000', marginTop: '6px' }}>
          Ref: {receiptId} · {new Date().toLocaleDateString('en-GB')}
        </div>
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
      font-size: 12px; font-weight: 600; line-height: 1.5; color: #000;
    }
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

import React from 'react';
import { format } from 'date-fns';
import Barcode from 'react-barcode';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';

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
    /** The real receipt number from the payment response — printed and barcoded. */
    receiptNumber?: string;
  };
  clinicName?: string;
  facilityName?: string;
  branchName?: string;
  receiptNumber?: string;
}

// Layout follows the house thermal-receipt template: centred logo and
// facility block, dashed rules, a barcode of the receipt number, an item
// table, totals in the base and secondary currency (no rate printed), a tax
// block, and the served-by / thank-you footer. Solid black only and weights
// of 600+ — thermal heads are effectively 1-bit, so greys print as nothing.
const INK = '#000';
const BODY = 12;
const SMALL = 11;
const dashed: React.CSSProperties = { borderTop: `1px dashed ${INK}`, margin: '6px 0' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: BODY, fontWeight: 700, lineHeight: 1.45 };
const cell: React.CSSProperties = { fontSize: BODY, fontWeight: 700, padding: '2px 0', verticalAlign: 'top' };
const head: React.CSSProperties = { fontSize: SMALL, fontWeight: 800, padding: '2px 0', verticalAlign: 'bottom' };

const num = (v: number) => (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const PaymentReceipt: React.FC<PaymentReceiptProps> = ({
  bill,
  payment,
  clinicName,
  facilityName,
  branchName,
  receiptNumber,
}) => {
  const facility = useFacilityInfo();
  const { currency, secondaryCurrency, secondaryRate } = useCurrency();
  const displayName = facilityName || facility.facilityName || clinicName || 'IntelliCare HMIS';
  const receiptId = receiptNumber || payment.receiptNumber || '';
  const balanceDue = Math.max(0, (bill.totalAmount || 0) - (bill.paidAmount || 0));
  // No new cash/card/mobile money actually changed hands here — the patient's own prepaid
  // deposit balance covered this instead, so it's labelled as a settlement, not a sale.
  const isDepositOffset = payment.method === 'deposit';
  const method = isDepositOffset ? 'Deposit offset' : payment.method.charAt(0).toUpperCase() + payment.method.slice(1).replace(/_/g, ' ');
  const base = currency?.symbol || currency?.code || '';
  const baseCode = currency?.code || '';
  const money = (v: number) => `${base} ${num(v)}`.trim();
  const hasSecondary = !!secondaryCurrency && secondaryRate != null && secondaryCurrency.code !== baseCode;
  const secondary = (v: number) => hasSecondary
    ? `${secondaryCurrency!.symbol || secondaryCurrency!.code} ${(v * (secondaryRate as number)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: secondaryCurrency!.decimal_places ?? 2 })}`
    : '';
  const address = [facility.branchAddress || facility.facilityAddress, facility.facilityCity].filter(Boolean).join(', ');
  const phone = facility.branchPhone || facility.facilityPhone;
  const items = bill.services || [];
  const totalItems = items.reduce((t, svc) => t + (Number(svc.quantity) || 1), 0);
  const paidAt = new Date(payment.date);

  const thermal: React.CSSProperties = {
    width: '302px',
    margin: '0 auto',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: BODY,
    fontWeight: 700,
    lineHeight: 1.35,
    color: INK,
    backgroundColor: '#fff',
    padding: '10px 10px 12px',
    boxSizing: 'border-box',
  };

  return (
    <div className="thermal-receipt" style={thermal}>

      {/* ── Facility ── */}
      <div style={{ textAlign: 'center' }}>
        {facility.facilityLogo && (
          <img src={facility.facilityLogo} alt="" style={{ maxHeight: 44, maxWidth: 120, objectFit: 'contain', display: 'block', margin: '0 auto 6px' }} />
        )}
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', lineHeight: 1.25 }}>{displayName}</div>
        {branchName && branchName !== displayName && <div style={{ fontSize: SMALL, fontWeight: 700 }}>{branchName}</div>}
        {address && <div style={{ fontSize: SMALL, fontWeight: 700 }}>{address}</div>}
        {phone && <div style={{ fontSize: SMALL, fontWeight: 700 }}>{phone}</div>}
        {facility.facilityEmail && <div style={{ fontSize: SMALL, fontWeight: 700 }}>{facility.facilityEmail}</div>}
      </div>

      <div style={dashed} />

      {/* ── Title, receipt number, barcode ── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.5px' }}>{isDepositOffset ? 'DEPOSIT SETTLEMENT' : 'PAYMENT RECEIPT'}</div>
        {receiptId && <div style={{ fontSize: BODY, fontWeight: 800, marginTop: 2 }}>{receiptId}</div>}
        {receiptId && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <Barcode value={receiptId} format="CODE128" width={1.3} height={38} fontSize={10} margin={0} background="#fff" lineColor={INK} />
          </div>
        )}
        {isDepositOffset && <div style={{ fontSize: SMALL, fontWeight: 700, marginTop: 4 }}>No cash collected — settled from the patient's deposit</div>}
      </div>

      <div style={dashed} />

      {/* ── When / who ── */}
      <div style={{ fontSize: BODY, fontWeight: 700, lineHeight: 1.5 }}>
        <div>Date : {format(paidAt, 'M/d/yyyy, h:mm:ss a')}</div>
        <div>Run Date : {format(new Date(), 'M/d/yyyy')}</div>
        <div style={{ marginTop: 4 }}>Patient Name : {bill.patientName || '—'}</div>
      </div>

      <div style={dashed} />

      {/* ── Items ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>Item</th>
            <th style={{ ...head, textAlign: 'right', width: 44 }}>Qty</th>
            <th style={{ ...head, textAlign: 'right', width: 70 }}>Price<br />({base})</th>
            <th style={{ ...head, textAlign: 'right', width: 74 }}>Amount<br />({base})</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={4} style={{ padding: 0 }}><div style={dashed} /></td></tr>
          {items.length > 0 ? items.map((svc, i) => {
            const name = svc.serviceName || svc.name || svc.service_name || (svc as any).test_name || 'Service';
            const qty = Number(svc.quantity) || 1;
            const unitPrice = svc.unitPrice || svc.unit_price || svc.price || 0;
            const total = svc.totalPrice || svc.total_price || (unitPrice * qty);
            return (
              <tr key={(svc as any).id || i}>
                <td style={{ ...cell, paddingRight: 4, wordBreak: 'break-word' }}>
                  {name}
                  {svc.discountLabel && <div style={{ fontSize: SMALL }}>Discount: {svc.discountLabel}</div>}
                </td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{qty.toFixed(2)}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{num(unitPrice)}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{num(total)}</td>
              </tr>
            );
          }) : (
            <tr><td colSpan={4} style={{ ...cell, fontStyle: 'italic' }}>No item details available</td></tr>
          )}
        </tbody>
      </table>

      <div style={dashed} />

      {/* ── Totals (base + secondary currency, no rate) ── */}
      <div style={{ ...row, fontSize: 15, fontWeight: 800 }}><span>Total :</span><span>{money(bill.totalAmount || 0)}</span></div>
      {hasSecondary && (
        <div style={{ ...row, fontSize: SMALL, fontStyle: 'italic' }}><span>Total ({secondaryCurrency!.code}) :</span><span>{secondary(bill.totalAmount || 0)}</span></div>
      )}
      <div style={row}><span>{method}</span><span>{money(payment.amount)}</span></div>
      {hasSecondary && (
        <div style={{ ...row, fontSize: SMALL, fontStyle: 'italic' }}><span>{method} ({secondaryCurrency!.code})</span><span>{secondary(payment.amount)}</span></div>
      )}
      <div style={row}><span>Balance Due :</span><span>{money(balanceDue)}</span></div>
      <div style={row}><span>Total Items :</span><span>{num(totalItems)}</span></div>

      <div style={dashed} />

      {/* ── Tax block ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>VAT</th>
            <th style={{ ...head, textAlign: 'right' }}>Amt W/o VAT</th>
            <th style={{ ...head, textAlign: 'right' }}>VAT Amt</th>
            <th style={{ ...head, textAlign: 'right' }}>Net Amt</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>Exempt</td>
            <td style={{ ...cell, textAlign: 'right' }}>{num(bill.totalAmount || 0)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>0</td>
            <td style={{ ...cell, textAlign: 'right' }}>{num(bill.totalAmount || 0)}</td>
          </tr>
        </tbody>
      </table>

      <div style={dashed} />

      <div style={{ fontSize: BODY, fontWeight: 700, lineHeight: 1.5 }}>
        {receiptId && <div>Receipt No : {receiptId}</div>}
        {bill.billNumber && <div>Bill No : {bill.billNumber}</div>}
        {payment.from_lease && <div>Type : Lease payment</div>}
        {payment.notes && <div>Note : {payment.notes}</div>}
        {payment.lease_details && <div>{payment.lease_details}</div>}
      </div>

      <div style={dashed} />

      {/* ── Footer ── */}
      <div style={{ fontSize: BODY, fontWeight: 700, lineHeight: 1.6 }}>
        <div style={{ display: 'flex', gap: 4 }}><span>Received By :</span><span style={{ flex: 1, borderBottom: `1px solid ${INK}`, marginBottom: 4 }} /></div>
        <div>You Were Served By : {(payment.cashierName || '—').toUpperCase()}</div>
        <div>Thank You !!! Please Come Again....</div>
        <div>Powered by IntelliCare HMIS</div>
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

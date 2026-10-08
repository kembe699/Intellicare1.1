import React from 'react';
import { format } from 'date-fns';
import { useCurrency } from '@/contexts/CurrencyContext';

interface DepositReceiptProps {
  kind: 'deposit' | 'refund';
  patientName: string;
  patientId: string;
  amount: number;
  newBalance: number;
  currency?: string;
  method: string;
  date: string;
  notes?: string;
  cashierName?: string;
  facilityName?: string;
  branchName?: string;
  receiptNumber?: string;
}

const DIVIDER = '--------------------------------';
const THICK_DIVIDER = '================================';

// Font/color choices mirror PaymentReceipt.tsx's own fix for the same
// "fading on thermal paper" complaint — see the comment there.
const row = (label: string, value: string, bold = false): React.ReactNode => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
    <span style={{ fontSize: '13px', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: '13px', fontWeight: bold ? 700 : 600, textAlign: 'right', maxWidth: '55%', wordBreak: 'break-word' }}>{value}</span>
  </div>
);

// Mirrors PaymentReceipt.tsx's thermal layout — a deposit/refund has no bill or service
// list, just a single line item (the deposit itself) plus the patient's resulting balance,
// so this is a lighter sibling rather than PaymentReceipt with a conditional branch bolted on.
export const DepositReceipt: React.FC<DepositReceiptProps> = ({
  kind, patientName, patientId, amount, newBalance, currency, method, date, notes,
  cashierName, facilityName, branchName, receiptNumber,
}) => {
  const displayName = facilityName || 'IntelliCare HMIS';
  const receiptId = receiptNumber || `DEP-${Date.now().toString().slice(-8)}`;
  const { fmt } = useCurrency();
  const label = kind === 'refund' ? 'Deposit Refund' : 'Patient Deposit';

  const thermal: React.CSSProperties = {
    width: '302px', margin: '0 auto', fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: '13px', lineHeight: '1.55', color: '#000', backgroundColor: '#fff',
    padding: '12px 10px 16px', boxSizing: 'border-box',
  };
  const center: React.CSSProperties = { textAlign: 'center' };
  const divStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#000', textAlign: 'center', margin: '4px 0', letterSpacing: '0.5px' };

  return (
    <div className="thermal-receipt" style={thermal}>
      <div style={center}>
        <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '1px' }}>{displayName}</div>
        {branchName && <div style={{ fontSize: '10px', fontWeight: 600, marginTop: '1px' }}>{branchName}</div>}
        <div style={{ fontSize: '10px', marginTop: '6px', fontWeight: 700, letterSpacing: '2px' }}>
          {kind === 'refund' ? 'DEPOSIT REFUND RECEIPT' : 'DEPOSIT RECEIPT'}
        </div>
      </div>

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {row('Receipt #:', receiptId, true)}
      {row('Date:', format(new Date(date), 'dd/MM/yyyy HH:mm'))}

      <div style={divStyle}>{DIVIDER}</div>

      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '3px' }}>PATIENT</div>
      {row('Name:', patientName)}
      {row('ID:', patientId)}

      <div style={divStyle}>{DIVIDER}</div>

      <div style={{ marginBottom: '5px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600 }}>{label}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#000' }}>{currency || ''}</span>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{fmt(amount)}</span>
        </div>
      </div>

      <div style={divStyle}>{THICK_DIVIDER}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0 4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>DEPOSIT BALANCE:</span>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>{fmt(newBalance)}</span>
      </div>

      <div style={divStyle}>{DIVIDER}</div>

      {row('Method:', method.charAt(0).toUpperCase() + method.slice(1))}
      {cashierName && row('Received by:', cashierName)}

      {notes && (
        <>
          <div style={divStyle}>{DIVIDER}</div>
          <div style={{ fontSize: '10px', fontWeight: 600, fontStyle: 'italic', marginTop: '2px' }}>Note: {notes}</div>
        </>
      )}

      <div style={divStyle}>{THICK_DIVIDER}</div>

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

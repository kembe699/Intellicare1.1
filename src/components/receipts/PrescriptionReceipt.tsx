import React from 'react';
import { format } from 'date-fns';

interface PrescriptionLine {
  drugName: string;
  doseStrength?: string;
  frequency?: string;
  quantity?: number | string;
  unit?: string;
}

interface PrescriptionReceiptProps {
  prescriptionNumber: string;
  patientName: string;
  patientNumber?: string;
  doctorName?: string;
  date: string;
  notes?: string;
  lines: PrescriptionLine[];
  facilityName?: string;
  branchName?: string;
}

const DIVIDER = '--------------------------------';
const THICK_DIVIDER = '================================';

// Same thermal conventions as PaymentReceipt.tsx / QueueReceipt.tsx — solid
// black, a 600-weight floor instead of 400, bold sans-serif instead of
// monospace — a mid-gray or a thin stroke fades to near-nothing on a worn
// 1-bit thermal head.
const row = (label: string, value: string, bold = false): React.ReactNode => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
    <span style={{ fontSize: '13px', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: '13px', fontWeight: bold ? 700 : 600, textAlign: 'right', maxWidth: '55%', wordBreak: 'break-word' }}>{value}</span>
  </div>
);

export const PrescriptionReceipt: React.FC<PrescriptionReceiptProps> = ({
  prescriptionNumber, patientName, patientNumber, doctorName, date, notes, lines, facilityName, branchName,
}) => {
  const displayName = facilityName || 'IntelliCare HMIS';

  const thermal: React.CSSProperties = {
    width: '302px',
    margin: '0 auto',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '13px',
    lineHeight: '1.55',
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
        <div style={{ fontSize: '10px', marginTop: '6px', fontWeight: 700, letterSpacing: '2px' }}>PRESCRIPTION</div>
      </div>

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Rx / Patient ── */}
      {row('Rx No.:', prescriptionNumber || '-', true)}
      {row('Date:', format(new Date(date), 'dd/MM/yyyy HH:mm'))}

      <div style={divStyle}>{DIVIDER}</div>

      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '3px' }}>PATIENT</div>
      {row('Name:', patientName || '-')}
      {patientNumber && row('Patient No.:', patientNumber)}
      {doctorName && row('Prescriber:', `Dr. ${doctorName}`)}

      <div style={divStyle}>{DIVIDER}</div>

      {/* ── Medications ── */}
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '4px' }}>MEDICATIONS</div>
      {lines.length > 0 ? lines.map((l, i) => (
        <div key={i} style={{ marginBottom: '5px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600 }}>{i + 1}. {l.drugName || 'Medicine'}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#000' }}>
              {[l.doseStrength, l.frequency].filter(Boolean).join(' · ') || '-'}
            </span>
            {l.quantity != null && <span style={{ fontSize: '11px', fontWeight: 700 }}>Qty {l.quantity}{l.unit ? ` ${l.unit}` : ''}</span>}
          </div>
        </div>
      )) : (
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#000', fontStyle: 'italic' }}>No medications on this prescription</div>
      )}

      {notes && (
        <>
          <div style={divStyle}>{DIVIDER}</div>
          <div style={{ fontSize: '10px', fontWeight: 600, fontStyle: 'italic' }}>Note: {notes}</div>
        </>
      )}

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', marginTop: '4px' }}>
        <div style={{ fontSize: '10px', fontWeight: 600 }}>Please confirm all medications with the pharmacist before leaving.</div>
      </div>

    </div>
  );
};

import React from 'react';
import { format } from 'date-fns';

interface QueueReceiptProps {
  patientName: string;
  participantNumber?: string;
  queueNumber: number | null;
  clinicName?: string;
  doctorName?: string;
  roomNumber?: string;
  date: string;
  facilityName?: string;
  branchName?: string;
}

const DIVIDER = '--------------------------------';
const THICK_DIVIDER = '================================';

// Same thermal conventions as PaymentReceipt.tsx — solid black, a 600-weight
// floor instead of 400, bold sans-serif instead of monospace — a mid-gray or
// a thin stroke fades to near-nothing on a worn 1-bit thermal head.
const row = (label: string, value: string, bold = false): React.ReactNode => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
    <span style={{ fontSize: '13px', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: '13px', fontWeight: bold ? 700 : 600, textAlign: 'right', maxWidth: '55%', wordBreak: 'break-word' }}>{value}</span>
  </div>
);

export const QueueReceipt: React.FC<QueueReceiptProps> = ({
  patientName, participantNumber, queueNumber, clinicName, doctorName, roomNumber, date, facilityName, branchName,
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
        <div style={{ fontSize: '10px', marginTop: '6px', fontWeight: 700, letterSpacing: '2px' }}>QUEUE RECEIPT</div>
      </div>

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Queue number — large and central, read from across the room ── */}
      <div style={{ textAlign: 'center', margin: '6px 0 8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px' }}>YOUR QUEUE NUMBER</div>
        <div style={{ fontSize: '56px', fontWeight: 700, lineHeight: 1.1, margin: '2px 0' }}>
          {queueNumber ?? '—'}
        </div>
      </div>

      <div style={divStyle}>{DIVIDER}</div>

      {/* ── Patient ── */}
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '3px' }}>PATIENT</div>
      {row('Name:', patientName || '-')}
      {row('Patient No.:', participantNumber || '-')}

      <div style={divStyle}>{DIVIDER}</div>

      {/* ── Queued to ── */}
      <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', marginBottom: '3px' }}>QUEUED TO</div>
      {row('Clinic:', clinicName || '-')}
      {doctorName && row('Doctor:', doctorName)}
      {roomNumber && row('Room:', roomNumber)}
      {row('Date:', format(new Date(date), 'dd/MM/yyyy HH:mm'))}

      <div style={divStyle}>{THICK_DIVIDER}</div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', marginTop: '4px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700 }}>Please wait to be called by queue number.</div>
        <div style={{ fontSize: '10px', fontWeight: 600, marginTop: '2px' }}>Keep this slip until you are seen.</div>
      </div>

    </div>
  );
};

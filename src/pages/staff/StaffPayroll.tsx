import React, { useEffect, useState } from 'react';
import { staffFetch } from '@/api/apiClient';
import { formatCurrency } from '@/utils/documentTemplate';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/notify';
import { Loader2, QrCode, CheckCircle2 } from 'lucide-react';
import QrScanner from './QrScanner';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The same signing_token the HR payroll-run page's QR already encodes
 * (/payroll-sign/{tenantCode}/{token}) — scanning it here instead of on the
 * public kiosk page skips re-typing the employee number, since the portal
 * session already proves who's scanning. See routes/employeePortal.js's
 * POST /payroll/confirm-receipt.
 */
export default function StaffPayroll() {
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningFor, setScanningFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await staffFetch('/api/employee-portal/payroll/lines');
      if (res.ok) setLines(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleScan = async (text: string) => {
    if (confirming) return;
    setConfirming(true);
    try {
      const res = await staffFetch('/api/employee-portal/payroll/confirm-receipt', {
        method: 'POST',
        body: JSON.stringify({ token: text }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Confirmed — ${data.currency} ${parseFloat(data.net_pay).toFixed(2)} received.`);
        setScanningFor(null);
        load();
      } else {
        toast.error(data.error || 'Could not confirm receipt.');
        setScanningFor(null);
      }
    } catch (e) {
      toast.error('Network error confirming receipt.');
      setScanningFor(null);
    } finally {
      setConfirming(false);
    }
  };

  if (scanningFor) {
    return (
      <QrScanner
        title="Scan the QR code HR showed you"
        onScan={handleScan}
        onClose={() => setScanningFor(null)}
      />
    );
  }

  return (
    <div className="px-4 py-5 space-y-5">
      <h1 className="text-lg font-semibold" style={{ color: '#14363C' }}>Payroll</h1>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No payroll records yet.</p>
      ) : (
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{MONTHS[l.period_month - 1] || l.period_month} {l.period_year}</p>
                <p className="font-mono font-semibold text-sm">{formatCurrency(l.net_pay, l.currency)}</p>
              </div>
              {l.received ? (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#16A34A' }}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Received on {formatDate(l.received_at)}
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full h-10 rounded-md text-sm font-medium text-white flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#077A84' }}
                  onClick={() => setScanningFor(l.id)}
                >
                  <QrCode className="w-4 h-4" /> Scan to Confirm Receipt
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

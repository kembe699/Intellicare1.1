import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authFetch } from '@/api/apiClient';
import { Loader2 } from 'lucide-react';

/**
 * Full-screen rotating QR display for a tablet/monitor at the attendance
 * site itself — HR-only (reached via ProtectedRoute in App.tsx, same
 * attendance.manage_sites privilege as the sites screen), refreshes every
 * 30s so a photo of the screen expires quickly. No AppLayout: this is
 * meant to fill the whole device screen, not sit inside the HMIS shell.
 */
export default function AttendanceDisplay() {
  const { siteId } = useParams<{ siteId: string }>();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [siteName, setSiteName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await authFetch(`/api/attendance/sites/${siteId}/rotating-token?origin=${encodeURIComponent(window.location.origin)}`);
      if (res.ok) {
        const data = await res.json();
        setQrDataUrl(data.qr_data_url);
        setSiteName(data.site_name);
        setError(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Could not load the display code.');
      }
    } catch (e) {
      setError('Could not reach the server.');
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [siteId]);

  return (
    <div className="min-h-screen bg-[#14363C] flex flex-col items-center justify-center text-white p-8">
      <h1 className="text-3xl font-semibold mb-2">{siteName || 'Attendance'}</h1>
      <p className="text-white/70 mb-8">Scan with your phone camera to clock in or out</p>
      {error ? (
        <p className="text-red-300">{error}</p>
      ) : qrDataUrl ? (
        <img src={qrDataUrl} alt="Attendance QR code" className="w-80 h-80 bg-white rounded-xl p-4" />
      ) : (
        <Loader2 className="h-10 w-10 animate-spin" />
      )}
      <p className="text-white/50 text-sm mt-8">This code refreshes every 30 seconds</p>
    </div>
  );
}

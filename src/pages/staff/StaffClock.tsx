import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { staffFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import QrScanner from './QrScanner';
import { CheckCircle2, XCircle, Loader2, QrCode } from 'lucide-react';

type Step = 'scan' | 'locating' | 'submitting' | 'success' | 'error';

function parseTokenSig(input: string): { token: string; sig: string } | null {
  try {
    // Accepts either a bare "/staff/clock?token=...&sig=..." URL (from an
    // external camera app opening the printed/display QR) or a full URL
    // with a different origin (e.g. scanned from a phone that resolves it
    // differently) — only the query params matter.
    const url = input.includes('://') ? new URL(input) : new URL(input, window.location.origin);
    const token = url.searchParams.get('token');
    const sig = url.searchParams.get('sig');
    if (token && sig) return { token, sig };
  } catch (e) { /* not a URL at all */ }
  return null;
}

export default function StaffClock() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('scan');
  const [message, setMessage] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'in' | 'out'>((location.state as any)?.type || 'in');
  const [showScanner, setShowScanner] = useState(false);

  // Re-derive "clock in or out" from the server, independent of any
  // navigation state — a direct scan (external camera app) arrives here
  // with no state at all, so this must never be the only source of truth.
  useEffect(() => {
    staffFetch('/api/employee-portal/attendance/summary')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.today?.first_in && !data?.today?.last_out) setActionType('out');
        else setActionType('in');
      })
      .catch(() => {});
  }, []);

  const submitClock = useCallback((token: string, sig: string) => {
    setStep('locating');
    if (!navigator.geolocation) {
      setMessage('Location is not available on this device/browser. Enable location services and try again.');
      setStep('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setStep('submitting');
        try {
          const res = await staffFetch('/api/employee-portal/attendance/clock', {
            method: 'POST',
            body: JSON.stringify({
              token, sig, type: actionType,
              latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy,
            }),
          });
          const data = await res.json();
          if (res.ok) {
            setSiteName(data.site_name);
            setMessage(data.message);
            setStep('success');
          } else {
            setMessage(data.error || 'Could not record attendance.');
            setStep('error');
          }
        } catch (e) {
          setMessage('Could not reach the server. Check your connection and try again.');
          setStep('error');
        }
      },
      (geoErr) => {
        const reason = geoErr.code === geoErr.PERMISSION_DENIED
          ? 'Location access was denied. Enable location services for this site to clock in/out.'
          : geoErr.code === geoErr.TIMEOUT
            ? 'Could not get your location in time. Move to an open area and try again.'
            : 'Could not determine your location. Try again.';
        setMessage(reason);
        setStep('error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [actionType]);

  useEffect(() => {
    const token = searchParams.get('token');
    const sig = searchParams.get('sig');
    if (token && sig) {
      submitClock(token, sig);
    } else {
      setShowScanner(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = (text: string) => {
    setShowScanner(false);
    const parsed = parseTokenSig(text);
    if (!parsed) {
      setMessage("That QR code doesn't look like an attendance code. Try again.");
      setStep('error');
      return;
    }
    submitClock(parsed.token, parsed.sig);
  };

  if (showScanner) {
    return <QrScanner onScan={handleScan} onClose={() => navigate('/staff')} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      {step === 'locating' && (
        <>
          <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: '#077A84' }} />
          <p className="font-medium">Getting your location…</p>
          <p className="text-sm text-muted-foreground mt-1">No background tracking — your location is only used at the moment you clock in or out.</p>
        </>
      )}
      {step === 'submitting' && (
        <>
          <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: '#077A84' }} />
          <p className="font-medium">Recording attendance…</p>
        </>
      )}
      {step === 'success' && (
        <>
          <CheckCircle2 className="w-16 h-16 mb-4" style={{ color: '#16A34A' }} />
          <p className="text-lg font-semibold" style={{ color: '#14363C' }}>{message}</p>
          <Button className="mt-6 h-12 px-8 text-base" style={{ backgroundColor: '#077A84' }} onClick={() => navigate('/staff', { replace: true })}>
            Done
          </Button>
        </>
      )}
      {step === 'error' && (
        <>
          <XCircle className="w-16 h-16 mb-4 text-destructive" />
          <p className="font-medium" style={{ color: '#14363C' }}>{message}</p>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" className="h-12 px-6 text-base" onClick={() => navigate('/staff', { replace: true })}>Back</Button>
            <Button className="h-12 px-6 text-base" style={{ backgroundColor: '#077A84' }} onClick={() => { setStep('scan'); setShowScanner(true); }}>
              <QrCode className="w-4 h-4 mr-2" /> Scan again
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

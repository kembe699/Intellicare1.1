import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { staffFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import QrScanner from './QrScanner';
import { CheckCircle2, XCircle, Loader2, QrCode } from 'lucide-react';

type Step = 'scan' | 'locating' | 'submitting' | 'success' | 'error';

// Matches the backend's default ATTENDANCE_MAX_ACCURACY_M (geofence.js) —
// used only to decide when to stop waiting early; the backend still does
// the real, authoritative accuracy check on whatever reading is actually
// submitted, so a mismatch here is never a security gap, just a slightly
// different "how long do we keep trying" heuristic.
const TARGET_ACCURACY_M = 100;
const LOCATE_TIMEOUT_MS = 20000;

/**
 * A single getCurrentPosition() call often returns the GPS chip's very
 * first, roughest fix — before it's had time to lock onto more
 * satellites — which is exactly the kind of "weak signal" rejection this
 * was built to avoid when a good fix was reachable within a few more
 * seconds. watchPosition() instead keeps reading for up to
 * LOCATE_TIMEOUT_MS, resolving early the moment a reading meets
 * TARGET_ACCURACY_M, and otherwise returns the best (lowest-accuracy-
 * number) reading seen in that window — never worse than what a single
 * getCurrentPosition() call would have produced, often meaningfully
 * better, standard practice for location-sensitive web apps.
 */
function acquireBestPosition(
  onAccuracyUpdate: (accuracyM: number) => void,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let settled = false;

    const finish = (goodPos: GeolocationPosition | null, err: GeolocationPositionError | null) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timeoutId);
      if (goodPos) {
        resolve(goodPos);
        return;
      }
      // Ran out of time (or a non-fatal error) — use the best reading seen
      // so far if we have one, rather than failing outright.
      if (best) {
        resolve(best);
        return;
      }
      reject(err || new Error('No location reading was received.'));
    };

    const timeoutId = setTimeout(() => finish(null, null), LOCATE_TIMEOUT_MS);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onAccuracyUpdate(pos.coords.accuracy);
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= TARGET_ACCURACY_M) finish(pos, null);
      },
      (err) => {
        // A transient error (e.g. a momentary signal drop) shouldn't abort
        // the whole wait if we might still get a good reading before the
        // timeout — only give up immediately on PERMISSION_DENIED, which
        // can never resolve itself.
        if (err.code === err.PERMISSION_DENIED) finish(null, err);
      },
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

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
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);

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

  const submitClock = useCallback(async (token: string, sig: string) => {
    setStep('locating');
    setLiveAccuracy(null);
    if (!navigator.geolocation) {
      setMessage('Location is not available on this device/browser. Enable location services and try again.');
      setStep('error');
      return;
    }
    let pos: GeolocationPosition;
    try {
      pos = await acquireBestPosition((accuracyM) => setLiveAccuracy(accuracyM));
    } catch (geoErr: any) {
      const reason = geoErr?.code === geoErr?.PERMISSION_DENIED
        ? 'Location access was denied. Enable location services for this site to clock in/out.'
        : 'Could not determine your location. Try again.';
      setMessage(reason);
      setStep('error');
      return;
    }
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
  }, [actionType]);

  // Guards against this effect firing twice for the same mount — React
  // StrictMode deliberately double-invokes effects in development to
  // surface exactly this class of bug, and it did: without this guard, a
  // direct QR-scan URL submitted two back-to-back clock requests. The
  // first succeeded; the second hit the backend's own duplicate-tap
  // rejection and overwrote the UI with a confusing "please wait" error
  // even though the clock-in had already gone through — confirmed live by
  // checking the actual stored record. The backend's guard prevented any
  // bad data, but the user would have seen a false failure.
  const autoSubmitStarted = useRef(false);
  useEffect(() => {
    const token = searchParams.get('token');
    const sig = searchParams.get('sig');
    if (token && sig) {
      if (autoSubmitStarted.current) return;
      autoSubmitStarted.current = true;
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
          {liveAccuracy != null && (
            <p className="text-sm mt-2" style={{ color: liveAccuracy <= TARGET_ACCURACY_M ? '#16A34A' : '#B45309' }}>
              Signal accuracy: ±{Math.round(liveAccuracy)}m {liveAccuracy > TARGET_ACCURACY_M ? '— improving…' : '✓'}
            </p>
          )}
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

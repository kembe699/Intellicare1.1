import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from '@/contexts/StaffAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

export default function StaffSetPin() {
  const { setPin, employee, mustSetPin, loading } = useStaffAuth();
  const navigate = useNavigate();
  const [pin, setPinValue] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !employee) navigate('/staff/login', { replace: true });
    else if (!loading && employee && !mustSetPin) navigate('/staff', { replace: true });
  }, [loading, employee, mustSetPin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) { setError('PIN must be 4 to 6 digits.'); return; }
    if (pin !== confirmPin) { setError('PINs do not match.'); return; }
    setSubmitting(true);
    try {
      const result = await setPin(pin);
      if (result.ok) navigate('/staff', { replace: true });
      else setError(result.error || 'Could not set PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/hjd-icon.png" alt="IntelliCare" className="w-16 h-16 rounded-2xl mb-3" />
          <h1 className="text-xl font-semibold text-center" style={{ color: '#14363C' }}>Set your PIN</h1>
          <p className="text-sm text-muted-foreground mt-2 text-center">
            Choose a 4-6 digit PIN you'll remember. You'll use it instead of the one-time code from now on.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="new-pin">New PIN</Label>
            <Input id="new-pin" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))} className="h-12 text-mobile-base tracking-widest" />
          </div>
          <div>
            <Label htmlFor="confirm-pin">Confirm PIN</Label>
            <Input id="confirm-pin" type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} className="h-12 text-mobile-base tracking-widest" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-12 text-base" style={{ backgroundColor: '#077A84' }} disabled={submitting}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Set PIN and continue
          </Button>
        </form>
      </div>
    </div>
  );
}

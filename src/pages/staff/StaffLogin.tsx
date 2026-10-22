import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from '@/contexts/StaffAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

export default function StaffLogin() {
  const { login, employee, mustSetPin, loading: authLoading } = useStaffAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [credential, setCredential] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedCode = localStorage.getItem('staff_portal_code');
    if (savedCode) setCode(savedCode);
  }, []);

  useEffect(() => {
    if (!authLoading && employee) {
      navigate(mustSetPin ? '/staff/set-pin' : '/staff', { replace: true });
    }
  }, [authLoading, employee, mustSetPin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !employeeNumber.trim() || !credential.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await login(code.trim(), employeeNumber.trim(), credential.trim());
      if (!result.ok) setError(result.error || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/hjd-icon.png" alt="IntelliCare" className="w-16 h-16 rounded-2xl mb-3" />
          <h1 className="text-xl font-semibold" style={{ color: '#14363C' }}>Staff Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">Clock in/out, leave &amp; salary advances</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="staff-code">Hospital code</Label>
            <Input id="staff-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. nationmc" className="h-12 text-mobile-base" autoCapitalize="none" />
          </div>
          <div>
            <Label htmlFor="staff-empno">Employee number</Label>
            <Input id="staff-empno" value={employeeNumber} onChange={(e) => setEmployeeNumber(e.target.value)} placeholder="e.g. EMP-0012" className="h-12 text-mobile-base" autoCapitalize="characters" />
          </div>
          <div>
            <Label htmlFor="staff-credential">Access code / PIN</Label>
            <Input id="staff-credential" type="password" inputMode="numeric" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Enter your code or PIN" className="h-12 text-mobile-base" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-12 text-base" style={{ backgroundColor: '#077A84' }} disabled={submitting}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
            Log in
          </Button>
        </form>
        <p className="text-xs text-center text-muted-foreground mt-6">
          First time logging in? Use the one-time access code HR gave you — you'll be asked to set your own PIN next.
        </p>
      </div>
    </div>
  );
}

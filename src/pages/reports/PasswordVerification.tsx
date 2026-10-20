import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/api/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Lock, Eye, EyeOff, BarChart3, ArrowLeft } from 'lucide-react';
import { toast } from '@/lib/notify';

export default function PasswordVerification() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  // This is a full-route security gate, not a floating modal over other
  // content (there's nothing underneath to scroll-lock or trap focus
  // against) — so Escape-to-close is the one missing-modal-behavior that
  // actually applies, matching the existing click-outside-to-leave gesture.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/dashboard');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  // If already verified, redirect
  React.useEffect(() => {
    const isVerified = sessionStorage.getItem('reports_verified');
    const verifiedAt = sessionStorage.getItem('reports_verified_at');
    if (isVerified && verifiedAt) {
      const elapsed = Date.now() - new Date(verifiedAt).getTime();
      if (elapsed < 30 * 60 * 1000) {
        navigate('/reports/dashboard/overview');
      }
    }
  }, [navigate]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (isLocked) {
      toast.error('Too many failed attempts. Please try again later.');
      return;
    }
    if (!password.trim()) {
      toast.error('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const response = await authFetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 3) {
          setIsLocked(true);
          toast.error('Account locked. Too many failed attempts.');
          setTimeout(() => navigate('/dashboard'), 5000);
        } else {
          toast.error(`Incorrect password. ${3 - newAttempts} attempt${3 - newAttempts === 1 ? '' : 's'} remaining.`);
        }
        return;
      }

      // A server-signed step-up token, not just a client-set flag — closes
      // the previous devtools bypass (sessionStorage.setItem('reports_verified',
      // 'true') used to be sufficient on its own, no server round-trip at all).
      const data = await response.json();
      toast.success('Password verified. Accessing reports...');
      sessionStorage.setItem('reports_verified', 'true');
      sessionStorage.setItem('reports_verified_at', new Date().toISOString());
      sessionStorage.setItem('reports_step_up_token', data.stepUpToken || '');
      navigate('/reports/dashboard/overview');
    } catch {
      toast.error('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div 
        className="fixed inset-0 z-[100] flex justify-center p-4 bg-background/60 backdrop-blur-md animate-in fade-in duration-300"
        onClick={() => navigate('/dashboard')}
      >
        <div 
          className="relative z-10 w-full max-w-md mt-[20vh] animate-in slide-in-from-top-[20vh] fade-in duration-500 ease-out"
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="border border-border/50 shadow-2xl bg-white/95 backdrop-blur overflow-hidden">
            <CardContent className="p-6">
              {isLocked && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-600">
                    <p className="font-semibold">Account Locked</p>
                    <p>Too many failed attempts.</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleVerify}>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-2">
                    <Lock className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                    Your Password
                  </label>
                  <div className="flex gap-3 items-start">
                    <div className="relative flex-1">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLocked || loading}
                        className="pr-10 h-11 transition-all duration-300"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 transition-colors"
                        disabled={isLocked || loading}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      {attempts > 0 && attempts < 3 && (
                        <p className="text-xs text-orange-600 mt-2 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                          <AlertCircle className="h-3 w-3" />
                          {3 - attempts} attempt{3 - attempts === 1 ? '' : 's'} remaining
                        </p>
                      )}
                    </div>
                    <Button
                      type="submit"
                      disabled={isLocked || loading || !password}
                      className="h-11 px-6 bg-primary hover:bg-primary/90 text-white transition-all duration-300 shadow-sm"
                    >
                      {loading ? (
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        'Verify'
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

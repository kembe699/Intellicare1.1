import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatformAuth } from '@/contexts/PlatformAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const PlatformLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn } = usePlatformAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/platform-admin', { replace: true });
    } catch (err: any) {
      const message = err.message || 'Login failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img src="/hjd.png" alt="IntelliCare Logo" className="h-16 w-auto object-contain mb-2" />
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Shield className="w-4 h-4 text-primary" />
            <span>Platform Admin</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8">
          {error && (
            <div className="mb-5 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold text-slate-700">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 text-base border-slate-300 rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-semibold text-slate-700">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 text-base border-slate-300 rounded-lg"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 bg-primary"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PlatformLogin;

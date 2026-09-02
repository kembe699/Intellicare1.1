import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Key, 
  Eye, 
  EyeOff,
  Check,
  Loader2,
  Shield,
  Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getAuthApiUrl } from '@/utils/apiConfig';

interface SetupPasswordProps {
  email: string;
  onComplete: () => void;
}

const SetupPassword: React.FC<SetupPasswordProps> = ({ email, onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }
    
    setLoading(true);
    
    try {
      // Setup password via API
      const response = await fetch(`${getAuthApiUrl()}/setup-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email: email.toLowerCase(), password }),
      });

      if (!response.ok) {
        const error = await response.json();
        
        // Check if user already has a password (403 status)
        if (response.status === 403) {
          toast.error('User already setup. Please login with your existing password.');
          setTimeout(() => {
            onComplete(); // Redirect to login
          }, 2000);
          return;
        }
        
        throw new Error(error.error || error.message || 'Failed to setup password');
      }

      toast.success('Password set successfully! Welcome to IntelliCare.');
      onComplete();
    } catch (error: any) {
      console.error('Error setting up password:', error);
      toast.error(error.message || 'Failed to set up password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-xl border border-border p-8 shadow-lg">
          {/* Header */}
          <div className="text-center mb-8">
            <Activity className="w-8 h-8 text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold">Welcome to IntelliCare</h1>
            <p className="text-muted-foreground mt-2">
              Set up your password to complete your account
            </p>
          </div>

          {/* User Info */}
          <div className="bg-muted/50 p-4 rounded-lg mb-6">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-primary" />
              <div>
                <p className="font-medium">Account Setup</p>
                <p className="text-sm text-muted-foreground">{email}</p>
              </div>
            </div>
          </div>

          {/* Password Setup Form */}
          <form onSubmit={handleSetupPassword} className="space-y-4">
            <div className="form-field">
              <Label htmlFor="password" className="form-label">
                Create Password *
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  minLength={6}
                  autoFocus
                  className="h-12 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="form-field">
              <Label htmlFor="confirmPassword" className="form-label">
                Confirm Password *
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                  minLength={6}
                  className="h-12 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Password Requirements */}
            <div className="bg-primary/10 p-3 rounded-lg border border-primary/30">
              <p className="text-sm font-medium text-primary mb-1">Password Requirements:</p>
              <ul className="text-xs text-primary space-y-1">
                <li>• At least 6 characters long</li>
                <li>• Use a combination of letters and numbers</li>
                <li>• Keep it secure and don't share with others</li>
              </ul>
            </div>

            <Button
              type="submit"
              className="w-full h-12"
              disabled={loading || !password || !confirmPassword}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Check className="w-5 h-5 mr-2" />
              )}
              {loading ? 'Setting up...' : 'Complete Setup'}
            </Button>
          </form>

          {/* Footer */}
          <div className="text-center mt-6">
            <p className="text-xs text-muted-foreground">
              By setting up your password, you agree to keep your account secure
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupPassword;

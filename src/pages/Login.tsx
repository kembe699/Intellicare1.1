import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Eye, EyeOff, Shield, Lock, CheckCircle2, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/notify';

const Login: React.FC = () => {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordCode, setForgotPasswordCode] = useState('');
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [sendingResetEmail, setSendingResetEmail] = useState(false);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const { signIn, user } = useAuth();
  const navigate = useNavigate();

  // A short beat before the form appears, so the logo registers first and the
  // reveal reads as deliberate rather than as the page still loading. Two
  // seconds was long enough to feel like something had gone wrong.
  useEffect(() => {
    const timer = setTimeout(() => setIsFormExpanded(true), 450);
    return () => clearTimeout(timer);
  }, []);

  const handleForgotPassword = async () => {
    if (sendingResetEmail) return;
    if (!forgotPasswordCode.trim()) {
      toast.error('Please enter your instance code');
      return;
    }
    if (!forgotPasswordEmail) {
      toast.error('Please enter your email address');
      return;
    }

    setSendingResetEmail(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: forgotPasswordCode.trim().toLowerCase(), email: forgotPasswordEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Password reset link sent! Check your email.');
        setShowForgotPassword(false);
        setForgotPasswordCode('');
        setForgotPasswordEmail('');
      } else {
        toast.error(data.error || 'Failed to send reset email');
      }
    } catch (error) {
      toast.error('Network error. Please try again.');
    } finally {
      setSendingResetEmail(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!code.trim()) {
      setError('Please enter your instance code');
      toast.error('Please enter your instance code');
      return;
    }

    setLoading(true);

    try {
      // Branch resolution now happens server-side (see loadUserBranchContext
      // in auth.js) as part of login itself — no separate pre-check needed.
      await signIn(code.trim().toLowerCase(), email, password);
      toast.success('Welcome back!');
      await new Promise(resolve => setTimeout(resolve, 500));
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to sign in. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-primary/5 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header Card - Logo */}
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 mb-4">
          <div className="flex items-center justify-center">
            <img
              src="/hjd.png"
              alt="IntelliCare"
              className="h-16 w-auto object-contain"
            />
          </div>
        </div>

        {/*
          Reveal by animating grid rows from 0fr to 1fr rather than max-height.
          max-height had to guess a ceiling (2000px), so the transition spent
          most of its time crossing empty space and the card appeared to snap
          into place near the end. 0fr -> 1fr animates to the content's real
          height, so the motion matches what you actually see. The card's
          padding and border live on the inner element too, because toggling
          them on the animated one made the layout jump as it opened.
        */}
        <div
          className="grid transition-[grid-template-rows,opacity] duration-700 ease-out motion-reduce:transition-none"
          style={{
            gridTemplateRows: isFormExpanded ? '1fr' : '0fr',
            opacity: isFormExpanded ? 1 : 0,
          }}
          aria-hidden={!isFormExpanded}
        >
          <div className="overflow-hidden">
        <div
          className={`bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 transition-transform duration-700 ease-out motion-reduce:transition-none ${
            isFormExpanded ? 'translate-y-0' : '-translate-y-2'
          }`}
        >
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-red-600 text-xs font-bold">!</span>
                </div>
                <p className="text-sm text-red-800 font-medium">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSignIn} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-semibold text-slate-700">
                  Instance Code
                </Label>
                <Input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. nationmc"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="h-12 pl-4 pr-4 text-base border-slate-300 rounded-lg transition-all"
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#3D8A97';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(61, 138, 151, 0.2)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.boxShadow = '';
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-slate-700">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@hospital.com"
                  required
                  className="h-12 pl-4 pr-4 text-base border-slate-300 rounded-lg transition-all"
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#3D8A97';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(61, 138, 151, 0.2)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.boxShadow = '';
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-semibold text-slate-700">
                    Password
                  </Label>
                  <button
                    type="button"
                    className="text-xs font-medium hover:underline text-primary"
                    onClick={() => { setForgotPasswordCode(code); setShowForgotPassword(true); }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="h-12 pl-4 pr-12 text-base rounded-lg transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 mt-6 bg-primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Lock className="w-5 h-5 mr-2" />
                    Sign In Securely
                  </>
                )}
              </Button>
            </form>

          <div className="mt-8 space-y-4">
            <div className="pt-6 border-t border-border">
              <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-success" />
                  <span className="font-medium">Encrypted connection</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                  <span className="font-medium">Daily backups</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center mt-8">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} IntelliCare. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Need help? Contact support at{' '}
            <a 
              href="mailto:support@nilehc.tech" 
              className="hover:underline text-primary"
            >
              support@nilehc.tech
            </a>
          </p>
        </div>
      </div>

      {/* Forgot Password Modal */}
      <Dialog
        open={showForgotPassword}
        onOpenChange={(open) => {
          if (!open) {
            setShowForgotPassword(false);
            setForgotPasswordCode('');
            setForgotPasswordEmail('');
          }
        }}
      >
        <DialogContent className="rounded-2xl p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-heading mb-2">Forgot Password?</h2>
            <p className="text-muted-foreground mb-6">Enter your instance code and email address and we'll send you a link to reset your password.</p>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgotCode" className="text-sm font-semibold text-label">
                  Instance Code
                </Label>
                <Input
                  id="forgotCode"
                  type="text"
                  value={forgotPasswordCode}
                  onChange={(e) => setForgotPasswordCode(e.target.value)}
                  placeholder="e.g. nationmc"
                  autoFocus
                  className="pl-4 pr-4 text-base rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="forgotEmail" className="text-sm font-semibold text-label">
                  Email Address
                </Label>
                <Input
                  id="forgotEmail"
                  type="email"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  placeholder="you@hospital.com"
                  className="pl-4 pr-4 text-base rounded-lg"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleForgotPassword();
                    }
                  }}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 font-medium rounded-lg"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setForgotPasswordCode('');
                    setForgotPasswordEmail('');
                  }}
                  disabled={sendingResetEmail}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1 h-12 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 bg-primary"
                  onClick={handleForgotPassword}
                  disabled={sendingResetEmail}
                >
                  {sendingResetEmail ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>
              </div>
            </div>
        </DialogContent>
      </Dialog>
    </div>
          </div>
        </div>
  );
};

export default Login;

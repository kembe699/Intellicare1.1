import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { publicFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertTriangle, Eraser, Wallet } from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Stage = 'loading' | 'invalid' | 'already_signed' | 'verify' | 'review' | 'done';

// A touch/mouse/pen signature pad via the Pointer Events API — unlike the
// mouse-only canvas in Profile.tsx, this page's whole point is to be signed
// on a phone that was just used to scan a QR code, so touch has to work.
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);

  const getPos = (canvas: HTMLCanvasElement, e: React.PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const { x, y } = getPos(canvas, e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const { x, y } = getPos(canvas, e);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#111827';
      ctx.lineTo(x, y);
      ctx.stroke();
      hasStrokeRef.current = true;
    }
  };

  const finishStroke = () => {
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasStrokeRef.current) onChange(canvas.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={500}
        height={180}
        className="w-full border-2 border-dashed rounded-lg bg-white touch-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser className="w-3.5 h-3.5 mr-1.5" /> Clear
        </Button>
      </div>
    </div>
  );
}

export default function PayrollSign() {
  const { code, token } = useParams<{ code: string; token: string }>();
  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [linkInfo, setLinkInfo] = useState<any>(null);
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [payData, setPayData] = useState<any>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await publicFetch(`/api/public/payroll-sign/${code}/${token}`);
        const data = await res.json();
        if (!res.ok) { setErrorMsg(data.error || 'This link is invalid.'); setStage('invalid'); return; }
        setLinkInfo(data);
        setStage(data.already_signed ? 'already_signed' : 'verify');
      } catch (e) {
        setErrorMsg('Could not load this link. Check your connection and try again.');
        setStage('invalid');
      }
    })();
  }, [code, token]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying || !employeeNumber.trim()) return;
    setVerifying(true);
    try {
      const res = await publicFetch(`/api/public/payroll-sign/${code}/${token}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_number: employeeNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Verification failed'); return; }
      setPayData(data);
      setStage('review');
    } catch (e) {
      toast.error('Network error — please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting || !signature) { if (!signature) toast.error('Please sign above first'); return; }
    setSubmitting(true);
    try {
      const res = await publicFetch(`/api/public/payroll-sign/${code}/${token}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_number: employeeNumber.trim(), signature }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to submit'); return; }
      setResult(data);
      setStage('done');
    } catch (e) {
      toast.error('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n: any, cur: string) => `${cur} ${parseFloat(n || 0).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-slate-50 flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border p-6 space-y-5">
        <div className="flex items-center gap-2 text-primary">
          <Wallet className="w-5 h-5" />
          <span className="font-semibold">Payroll Confirmation</span>
        </div>

        {stage === 'loading' && (
          <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Loading…</p>
          </div>
        )}

        {stage === 'invalid' && (
          <div className="flex flex-col items-center py-10 gap-3 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
        )}

        {stage === 'already_signed' && (
          <div className="flex flex-col items-center py-10 gap-3 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            <p className="font-medium">Already Confirmed</p>
            <p className="text-sm text-muted-foreground">This payment has already been signed for and paid.</p>
          </div>
        )}

        {stage === 'verify' && linkInfo && (
          <>
            <p className="text-sm text-muted-foreground">
              Payroll {linkInfo.run_number} — {MONTHS[linkInfo.period_month - 1]} {linkInfo.period_year}
            </p>
            <p className="text-sm">Enter your Employee Number to view and sign for your payment.</p>
            <form onSubmit={handleVerify} className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Employee Number</Label>
                <Input
                  className="mt-1 text-center text-lg tracking-wide"
                  placeholder="EMP-0001"
                  value={employeeNumber}
                  onChange={e => setEmployeeNumber(e.target.value)}
                  autoFocus
                  autoCapitalize="characters"
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifying}>
                {verifying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Continue
              </Button>
            </form>
          </>
        )}

        {stage === 'review' && payData && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="font-semibold text-lg">{payData.employee_name}</p>
              <p className="text-xs text-muted-foreground">{payData.employee_number} {payData.job_title ? `· ${payData.job_title}` : ''}</p>
              <p className="text-xs text-muted-foreground mt-1">{payData.run_number} — {MONTHS[payData.period_month - 1]} {payData.period_year}</p>
            </div>

            <div className="rounded-lg border bg-slate-50 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Basic Salary</span><span className="font-mono">{fmt(payData.basic_salary, payData.currency)}</span></div>
              {(payData.components || []).filter((c: any) => c.component_type === 'allowance').map((c: any, i: number) => (
                <div key={i} className="flex justify-between"><span className="text-muted-foreground">{c.name}</span><span className="font-mono">{fmt(c.amount, payData.currency)}</span></div>
              ))}
              <div className="flex justify-between font-medium pt-1.5 border-t"><span>Gross Pay</span><span className="font-mono">{fmt(payData.gross_pay, payData.currency)}</span></div>
              {(payData.components || []).filter((c: any) => c.component_type === 'deduction').map((c: any, i: number) => (
                <div key={i} className="flex justify-between text-amber-700"><span>{c.name}</span><span className="font-mono">-{fmt(c.amount, payData.currency)}</span></div>
              ))}
              <div className="flex justify-between font-bold text-base pt-1.5 border-t"><span>Net Pay</span><span className="font-mono text-emerald-700">{fmt(payData.net_pay, payData.currency)}</span></div>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Sign below to confirm you received this payment
              </Label>
              <SignaturePad onChange={setSignature} />
            </div>

            <Button className="w-full" onClick={handleSubmit} disabled={submitting || !signature}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Sign &amp; Confirm Payment
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              By signing you confirm you personally received this amount. This cannot be undone.
            </p>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            <p className="font-semibold text-lg">Payment Confirmed</p>
            <p className="text-sm text-muted-foreground">
              {result.employee_name}, your payment of <span className="font-mono font-medium text-foreground">{fmt(result.net_pay, result.currency)}</span> for {result.run_number} has been recorded.
            </p>
            <p className="text-xs text-muted-foreground">You may now close this page.</p>
          </div>
        )}
      </div>
    </div>
  );
}

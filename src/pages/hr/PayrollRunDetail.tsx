import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, LoadingState, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import * as docTemplate from '@/utils/documentTemplate';
import { Wallet, ArrowLeft, Loader2, ShieldCheck, Ban, Banknote, Printer, Download, Check, FileSpreadsheet, QrCode, Copy, Clock } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  draft: 'neutral',
  approved: 'info',
  paid: 'success',
  cancelled: 'danger',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PayrollRunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();
  const clinicId = user?.clinic || 1;

  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [payingLineId, setPayingLineId] = useState<string | null>(null);
  const [qrLine, setQrLine] = useState<any>(null);
  const [qrData, setQrData] = useState<{ token: string; path: string; qr_data_url: string } | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);

  const fetchRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${id}`);
      if (!res.ok) { setError('Payroll run not found'); return; }
      setRun(await res.json());
    } catch (e) {
      setError('Failed to load payroll run');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await authFetch(`/api/accounting/chart-of-accounts?clinic_id=${clinicId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) { setAccounts(data); return; }
      }
      const r2 = await authFetch('/api/ledger-accounts');
      if (r2.ok) setAccounts(await r2.json());
    } catch (e) { /* non-blocking */ }
  };

  useEffect(() => { fetchRun(); fetchAccounts(); }, [id]);

  const totalsByCurrency = useMemo(() => {
    if (!run?.lines) return [];
    const byCurrency: Record<string, { currency: string; gross: number; deductions: number; net: number }> = {};
    for (const l of run.lines) {
      const cur = l.currency;
      if (!byCurrency[cur]) byCurrency[cur] = { currency: cur, gross: 0, deductions: 0, net: 0 };
      byCurrency[cur].gross += parseFloat(l.gross_pay) || 0;
      byCurrency[cur].deductions += parseFloat(l.deductions_total) || 0;
      byCurrency[cur].net += parseFloat(l.net_pay) || 0;
    }
    return Object.values(byCurrency).sort((a, b) => b.gross - a.gross);
  }, [run]);

  const unpaidCount = useMemo(() => (run?.lines || []).filter((l: any) => l.status !== 'paid').length, [run]);
  const paidCount = useMemo(() => (run?.lines || []).filter((l: any) => l.status === 'paid').length, [run]);

  const handleApprove = async () => {
    if (busy || !run) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/approve`, { method: 'POST' });
      if (res.ok) { toast.success('Payroll run approved'); fetchRun(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to approve'); }
    } catch (e) { toast.error('Network error'); } finally { setBusy(false); }
  };

  const handlePayAll = async () => {
    if (busy || !run) return;
    if (!confirm(`Pay all ${unpaidCount} remaining employee(s) on ${run.run_number}? Each gets their own General Ledger entry and this cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/pay`, { method: 'POST' });
      if (res.ok) {
        const result = await res.json();
        toast.success(`${result.paid_count} employee(s) paid`);
        fetchRun();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to pay payroll run');
      }
    } catch (e) { toast.error('Network error'); } finally { setBusy(false); }
  };

  // The admin's own fallback for when handing someone a QR code isn't
  // practical (no phone on hand, etc.) — still available from inside the
  // QR dialog. This is the same immediate pay-and-post action as before.
  const handleManualPayLine = async (line: any) => {
    if (payingLineId || !run) return;
    if (!confirm(`Pay ${line.first_name} ${line.last_name} — ${line.currency} ${parseFloat(line.net_pay).toFixed(2)} from ${run.payment_account_name}?`)) return;
    setPayingLineId(line.id);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/lines/${line.id}/pay`, { method: 'POST' });
      if (res.ok) {
        toast.success(`${line.first_name} ${line.last_name} paid`);
        setQrLine(null); setQrData(null);
        fetchRun();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to pay this employee');
      }
    } catch (e) { toast.error('Network error'); } finally { setPayingLineId(null); }
  };

  // Clicking "Pay" on an employee generates a one-time QR code instead of
  // paying immediately — the employee scans it on their own phone, confirms
  // their employee number, reviews their pay, and signs on-screen. That
  // submission (routes/publicPayroll.js) is what actually pays the line.
  const handleOpenQrPay = async (line: any) => {
    if (!run || generatingQr) return;
    setQrLine(line);
    setQrData(null);
    setGeneratingQr(true);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/lines/${line.id}/signing-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Failed to generate signing link'); setQrLine(null); return; }
      setQrData(data);
    } catch (e) {
      toast.error('Network error');
      setQrLine(null);
    } finally {
      setGeneratingQr(false);
    }
  };

  const copySigningLink = () => {
    if (!qrData) return;
    navigator.clipboard.writeText(`${window.location.origin}${qrData.path}`)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Could not copy link'));
  };

  // While the dialog is open, poll for the employee having signed — this
  // page's own state doesn't otherwise change until an explicit refresh.
  // A plain setInterval alone can feel like it "hangs" for a long time: once
  // this tab is backgrounded (admin switches away while waiting on the
  // employee), Chrome throttles background timers hard — after ~5 minutes
  // hidden, a 4s interval only actually fires about once a minute — so the
  // update can sit unnoticed well past when it actually happened. Firing an
  // immediate check on visibilitychange (tab regains focus) closes that gap,
  // and checkingNow/manual "Check now" lets the admin force an immediate
  // check on demand instead of waiting on the timer at all.
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);

  const checkSigningStatus = async (line: any, runId: string) => {
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${runId}`);
      if (!res.ok) return;
      const data = await res.json();
      setLastChecked(Date.now());
      const updatedLine = (data.lines || []).find((l: any) => l.id === line.id);
      if (updatedLine?.status === 'paid') {
        toast.success(`${line.first_name} ${line.last_name} signed and was paid`);
        setQrLine(null); setQrData(null);
        setRun(data);
      }
    } catch (e) {
      console.error('Payroll signing status check failed:', e);
    }
  };

  const handleCheckNow = async () => {
    if (!qrLine || !run || checkingNow) return;
    setCheckingNow(true);
    try { await checkSigningStatus(qrLine, run.id); } finally { setCheckingNow(false); }
  };

  useEffect(() => {
    if (!qrLine || !run) return;
    checkSigningStatus(qrLine, run.id);
    const interval = setInterval(() => checkSigningStatus(qrLine, run.id), 2000);
    const onVisible = () => { if (document.visibilityState === 'visible') checkSigningStatus(qrLine, run.id); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [qrLine, run?.id]);

  const [downloadingSheet, setDownloadingSheet] = useState(false);
  const handleDownloadSheet = async () => {
    if (!run || downloadingSheet) return;
    setDownloadingSheet(true);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/sheet`);
      if (!res.ok) { toast.error('Failed to generate payroll sheet'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Payroll-${run.run_number}-Sheet.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Payroll sheet downloaded');
    } catch (e) {
      toast.error('Failed to generate payroll sheet');
    } finally {
      setDownloadingSheet(false);
    }
  };

  const handleCancel = async () => {
    if (busy || !run) return;
    if (!confirm(`Cancel draft ${run.run_number}?`)) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/cancel`, { method: 'POST' });
      if (res.ok) { toast.success('Draft cancelled'); navigate('/hr/payroll'); }
      else toast.error('Failed to cancel');
    } catch (e) { toast.error('Network error'); } finally { setBusy(false); }
  };

  const handleSetAccount = async (accountId: string) => {
    // Reuses the update-run PUT for the one draft-editable field this page exposes.
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_account_id: accountId }),
      });
      if (res.ok) { toast.success('Payment account set'); fetchRun(); }
      else toast.error('Failed to set payment account');
    } catch (e) { toast.error('Network error'); }
  };

  const fi = () => ({ name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo });
  const bi = () => ({ name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone });

  const buildPayslip = (line: any) => {
    const cur = line.currency;
    const fmtC = (n: number) => docTemplate.formatCurrency(n, cur);
    const earnings = [
      { cells: ['Basic Salary', fmtC(parseFloat(line.basic_salary))] },
      ...(line.components || []).filter((c: any) => c.component_type === 'allowance').map((c: any) => ({ cells: [c.name, fmtC(parseFloat(c.amount))] })),
    ];
    const deductions = (line.components || []).filter((c: any) => c.component_type === 'deduction').map((c: any) => ({ cells: [c.name, fmtC(parseFloat(c.amount))] }));

    const body = docTemplate.buildInfoGrid(
      { title: 'Pay Period', rows: [
        { label: 'Period', value: `${MONTHS[run.period_month - 1]} ${run.period_year}`, bold: true },
        { label: 'Payroll Run', value: run.run_number },
        { label: 'Status', value: line.status === 'paid' ? 'PAID' : run.status.toUpperCase() },
      ]},
      { title: 'Employee', rows: [
        { label: 'Name', value: `${line.first_name} ${line.last_name}`, bold: true },
        { label: 'Employee No.', value: line.employee_number },
        { label: 'Job Title', value: line.job_title || '—' },
      ]}
    )
    + `<div class="ic-section-title">Earnings</div>`
    + docTemplate.buildTable([{ label: 'Description' }, { label: 'Amount', align: 'right' as const }], earnings, ['Gross Pay', fmtC(parseFloat(line.gross_pay))])
    + (deductions.length > 0
      ? `<div class="ic-section-title">Deductions</div>` + docTemplate.buildTable([{ label: 'Description' }, { label: 'Amount', align: 'right' as const }], deductions, ['Total Deductions', fmtC(parseFloat(line.deductions_total))])
      : '')
    + docTemplate.buildSummary([
      { label: 'Gross Pay', value: fmtC(parseFloat(line.gross_pay)) },
      { label: 'Total Deductions', value: fmtC(parseFloat(line.deductions_total)) },
      { label: 'Net Pay', value: fmtC(parseFloat(line.net_pay)), isTotal: true },
    ])
    + docTemplate.buildSignatures([
      { label: 'Prepared By', name: '' },
      { label: 'Employee', name: `${line.first_name} ${line.last_name}`, signature: line.signature_data || undefined },
    ]);

    return docTemplate.buildDocument({
      docType: 'PAYSLIP', docNumber: `${run.run_number}-${line.employee_number}`, date: run.run_date,
      status: line.status === 'paid' ? 'PAID' : run.status.toUpperCase(),
      bodyHTML: body, facilityInfo: fi(), branchInfo: bi(),
    });
  };

  const downloadPayslip = (line: any) => {
    docTemplate.downloadDocument(buildPayslip(line), `Payslip-${run.run_number}-${line.employee_number}`);
    toast.success('Payslip downloaded');
  };

  const printPayslip = (line: any) => {
    const html = buildPayslip(line);
    const pw = docTemplate.openPrintWindow(html);
    if (pw) toast.success('PDF generated');
    else toast.error('Please allow popups');
  };

  if (loading) return (<AppLayout><div className="p-6"><LoadingState /></div></AppLayout>);
  if (error || !run) {
    return (
      <AppLayout>
        <div className="p-6 space-y-4">
          <Button variant="outline" onClick={() => navigate('/hr/payroll')}><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
          <div className="text-center text-muted-foreground py-12">{error || 'Payroll run not found'}</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-[1700px] mx-auto space-y-4">
          <PageHeader
            icon={<Wallet />}
            title={`Payroll Run ${run.run_number}`}
            subtitle={`${MONTHS[run.period_month - 1]} ${run.period_year}`}
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => navigate('/hr/payroll')}><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
                {(run.lines || []).length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleDownloadSheet} disabled={downloadingSheet}>
                    {downloadingSheet ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />} Download Payroll Sheet
                  </Button>
                )}
                {run.status === 'draft' && (
                  <>
                    <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={handleCancel} disabled={busy}>
                      <Ban className="w-4 h-4 mr-2" /> Cancel Draft
                    </Button>
                    <Button size="sm" onClick={handleApprove} disabled={busy || !run.payment_account_id}>
                      {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />} Approve
                    </Button>
                  </>
                )}
                {run.status === 'approved' && unpaidCount > 0 && (
                  <Button size="sm" onClick={handlePayAll} disabled={busy || !!payingLineId}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Banknote className="w-4 h-4 mr-2" />} Pay All Remaining ({unpaidCount})
                  </Button>
                )}
              </div>
            }
          />

          <div className="bg-card rounded-lg border shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <StatusBadge status={run.status} label={run.status} map={STATUS_TONE} />
                {(run.status === 'approved' || run.status === 'paid') && (
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{paidCount}</span> of <span className="font-medium text-foreground">{run.lines?.length || 0}</span> employees paid
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Payment Account:</span>
                {run.status === 'draft' ? (
                  <Combobox
                    options={accounts.map((a: any) => ({ value: String(a.id), label: a.account_name }))}
                    value={run.payment_account_id || ''} onChange={handleSetAccount}
                    placeholder="Select account..." searchPlaceholder="Search..." className="w-56 h-8 text-sm"
                  />
                ) : (
                  <span className="text-sm font-medium">{run.payment_account_name || '—'}</span>
                )}
              </div>
            </div>
            {!run.payment_account_id && run.status === 'draft' && (
              <p className="text-xs text-amber-700">A payment account must be set before this run can be approved.</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {totalsByCurrency.map(t => (
                <div key={t.currency} className="border rounded-lg p-3 bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">{t.currency}</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div><p className="text-[11px] text-muted-foreground">Gross</p><p className="font-mono font-bold">{docTemplate.formatCurrency(t.gross, t.currency)}</p></div>
                    <div><p className="text-[11px] text-muted-foreground">Deductions</p><p className="font-mono font-bold text-amber-700">{docTemplate.formatCurrency(t.deductions, t.currency)}</p></div>
                    <div><p className="text-[11px] text-muted-foreground">Net</p><p className="font-mono font-bold text-emerald-700">{docTemplate.formatCurrency(t.net, t.currency)}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-lg border shadow-sm p-4">
            <AdvancedDataTable<any>
              data={(run.lines || []).map((l: any) => ({ ...l, employee_name: `${l.first_name} ${l.last_name}` }))}
              keyExtractor={(l) => l.id}
              loading={false}
              emptyMessage="No employees in this run"
              searchable
              searchPlaceholder="Search by employee name or ID..."
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'employee_number', header: 'ID', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v}</span> },
                { key: 'employee_name', header: 'Employee', render: (v) => v },
                { key: 'job_title', header: 'Job Title', render: (v) => v || '—' },
                { key: 'gross_pay', header: 'Gross', align: 'right', render: (v, l) => <span className="font-mono">{docTemplate.formatCurrency(v, l.currency)}</span> },
                { key: 'deductions_total', header: 'Deductions', align: 'right', render: (v, l) => <span className="font-mono text-amber-700">{docTemplate.formatCurrency(v, l.currency)}</span> },
                { key: 'net_pay', header: 'Net Pay', align: 'right', render: (v, l) => <span className="font-mono font-bold text-emerald-700">{docTemplate.formatCurrency(v, l.currency)}</span> },
                {
                  key: 'status', header: 'Paid', align: 'center',
                  render: (v) => <StatusBadge status={v || 'unpaid'} label={v === 'paid' ? 'Paid' : 'Unpaid'} map={{ paid: 'success', unpaid: 'warning' }} />,
                },
                {
                  key: '__actions', header: 'Actions', align: 'center',
                  render: (_v, l) => (
                    <div className="flex items-center justify-center gap-1">
                      {run.status === 'approved' && l.status !== 'paid' && (
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleOpenQrPay(l)} disabled={payingLineId === l.id || busy || (!!qrLine && qrLine.id !== l.id)}>
                          <QrCode className="w-3.5 h-3.5 mr-1" /> Pay
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadPayslip(l)} title="Download Payslip"><Download className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => printPayslip(l)} title="Print Payslip"><Printer className="w-3.5 h-3.5" /></Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <Dialog open={!!qrLine} onOpenChange={(o) => { if (!o) { setQrLine(null); setQrData(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="w-4 h-4" /> Scan to Sign &amp; Pay</DialogTitle>
            <DialogDescription>
              {qrLine && `${qrLine.first_name} ${qrLine.last_name} — ${qrLine.currency} ${parseFloat(qrLine.net_pay).toFixed(2)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 pt-2 space-y-4">
            {generatingQr ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : qrData ? (
              <>
                <div className="flex justify-center">
                  <img src={qrData.qr_data_url} alt="Scan to sign" className="w-56 h-56 border rounded-lg" />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Have {qrLine?.first_name} scan this with their phone. They'll enter their employee number, review their pay, and sign on-screen — this line is marked paid automatically once they submit.
                </p>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Waiting for signature{lastChecked ? ` — checked ${Math.max(0, Math.round((Date.now() - lastChecked) / 1000))}s ago` : '…'}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={handleCheckNow} disabled={checkingNow}>
                    {checkingNow ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check now'}
                  </Button>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={copySigningLink}>
                  <Copy className="w-3.5 h-3.5 mr-2" /> Copy Link
                </Button>
                <div className="pt-2 border-t">
                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => qrLine && handleManualPayLine(qrLine)} disabled={payingLineId === qrLine?.id}>
                    {payingLineId === qrLine?.id ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Clock className="w-3.5 h-3.5 mr-2" />}
                    Or mark as paid manually (no QR)
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Could not generate a signing link.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

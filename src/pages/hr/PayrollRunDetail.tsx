import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, LoadingState, type StatusBadgeTone } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import * as docTemplate from '@/utils/documentTemplate';
import { Wallet, ArrowLeft, Loader2, ShieldCheck, Ban, Banknote, Printer, Download, Check, FileSpreadsheet } from 'lucide-react';
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

  const handlePayLine = async (line: any) => {
    if (payingLineId || !run) return;
    if (!confirm(`Pay ${line.first_name} ${line.last_name} — ${line.currency} ${parseFloat(line.net_pay).toFixed(2)} from ${run.payment_account_name}?`)) return;
    setPayingLineId(line.id);
    try {
      const res = await authFetch(`/api/hr/payroll/runs/${run.id}/lines/${line.id}/pay`, { method: 'POST' });
      if (res.ok) {
        toast.success(`${line.first_name} ${line.last_name} paid`);
        fetchRun();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to pay this employee');
      }
    } catch (e) { toast.error('Network error'); } finally { setPayingLineId(null); }
  };

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
      { label: 'Employee', name: `${line.first_name} ${line.last_name}` },
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
              data={run.lines || []}
              keyExtractor={(l) => l.id}
              loading={false}
              emptyMessage="No employees in this run"
              pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
              columns={[
                { key: 'employee_number', header: 'ID', render: (v) => <span className="font-mono text-xs text-muted-foreground">{v}</span> },
                { key: 'first_name', header: 'Employee', render: (_v, l) => `${l.first_name} ${l.last_name}` },
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
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handlePayLine(l)} disabled={payingLineId === l.id || busy}>
                          {payingLineId === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5 mr-1" /> Pay</>}
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
    </AppLayout>
  );
}

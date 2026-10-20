import React, { useEffect, useState } from 'react';
import { ReportSubPageShell } from './ReportSubPageShell';
import { LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Download, Save, Lock, Unlock,
  AlertTriangle, Loader2, Settings,
} from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { fetchUserSignature } from '@/utils/documentTemplate';

// ── Types ─────────────────────────────────────────────────────────────────

interface AgeBand { id: string; label: string; maxYears?: number; minYears?: number; }
interface Column { id: string; label: string; }
interface RowDef {
  id: string; label: string;
  isTotal?: boolean; isMeta?: boolean; isCatchAll?: boolean; isMalariaClinicalFallback?: boolean; isNotifiable?: boolean;
  icd10?: string[]; keywords?: string[];
  testNameKeywords?: string[]; positiveValues?: string[];
  itemNameKeywords?: string[];
}
interface SectionDef {
  id: string; title: string; type: string;
  columns?: Column[]; rows?: RowDef[]; defaultItems?: RowDef[]; fields?: { id: string; label: string; type: string }[];
  warningText?: string; note?: string; attendanceRule?: { description: string };
}
interface Definition {
  ageBands: AgeBand[];
  sections: Record<string, SectionDef>;
  headerFields: { id: string; label: string; source?: string; editable: boolean; type?: string }[];
  validationRules: { id: string; description: string }[];
}

type AgeSexRow = { u5m: number; u5f: number; ge5m: number; ge5f: number; unknown: number; total: number };
type LabRow = { tested: number; positive: number; pct_positive: number };
type TracerRow = { opening: number; received: number; used: number; closing: number; daysOutOfStock: number; itemId: string | null; unmapped?: boolean; estimated?: boolean };

interface ComputedReport {
  period: string;
  sections: {
    A: { new: AgeSexRow; reattendance: AgeSexRow; total: AgeSexRow };
    B: Record<string, AgeSexRow>;
    C: Record<string, LabRow>;
    D: { anc1: number; anc4: number }; // the only two rows of D backed by real data — see Antenatal records
    F: Record<string, number>;
    G: Record<string, TracerRow>;
  };
  diagnosisReview: { noDiagnosisCount: number; visitsWithDiagnosis: number; totalAttendance: number; warningText: string };
  warnings: string[];
}

type Overrides = {
  A?: Record<string, Partial<AgeSexRow>>;
  B?: Record<string, Partial<AgeSexRow>>;
  C?: Record<string, Partial<LabRow>>;
  D?: Record<string, number>;
  E?: Record<string, number>;
  F?: Record<string, number>;
  G?: Record<string, Partial<TracerRow>>;
};

interface SavedReport {
  id: string; branch_id: number; period: string; status: 'draft' | 'final';
  computed_values: ComputedReport; overrides: Overrides; header: Record<string, any>; signoff: Record<string, any>;
  finalized_by?: string | null; finalized_at?: string | null;
}

const AGE_SEX_COLS = ['u5m', 'u5f', 'ge5m', 'ge5f', 'unknown', 'total'] as const;

function defaultPeriod(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Small building blocks ────────────────────────────────────────────────

function EditableCell({ computedValue, overrideValue, onChange, readOnly, align = 'right' }: {
  computedValue: number; overrideValue?: number; onChange: (v: number) => void; readOnly: boolean; align?: 'left' | 'right' | 'center';
}) {
  const isOverridden = overrideValue != null;
  const displayValue = isOverridden ? overrideValue : computedValue;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(displayValue));

  const commit = () => {
    setEditing(false);
    const n = parseFloat(draft);
    if (!isNaN(n) && n !== computedValue) onChange(n);
    else if (!isNaN(n) && n === computedValue && isOverridden) onChange(n); // explicit reset-to-computed still recorded as an intentional value
  };

  if (readOnly) {
    return <span className={cn('tabular-nums', isOverridden && 'font-semibold text-amber-700')}>{displayValue}</span>;
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className={cn('w-16 h-7 text-sm border rounded px-1 tabular-nums', align === 'right' && 'text-right')}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(String(displayValue)); setEditing(true); }}
      title={isOverridden ? `Computed: ${computedValue} (click to edit)` : 'Click to override'}
      className={cn(
        'tabular-nums px-1.5 py-0.5 rounded hover:bg-muted min-w-[28px]',
        isOverridden && 'bg-amber-50 text-amber-800 font-semibold border border-amber-200',
      )}
    >
      {displayValue}
    </button>
  );
}

function AgeSexSectionTable({ section, computedRows, overrideRows, onOverride, readOnly }: {
  section: SectionDef;
  computedRows: Record<string, AgeSexRow>;
  overrideRows: Record<string, Partial<AgeSexRow>>;
  onOverride: (rowId: string, col: string, v: number) => void;
  readOnly: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse dhis2-section">
        <thead>
          <tr className="border-b-2 border-foreground/20">
            <th className="text-left py-2 pr-3">Indicator</th>
            {(section.columns || []).map((c) => <th key={c.id} className="text-right py-2 px-2 whitespace-nowrap">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {(section.rows || []).map((row) => {
            const computed = computedRows[row.id] || { u5m: 0, u5f: 0, ge5m: 0, ge5f: 0, unknown: 0, total: 0 };
            const overrides = overrideRows[row.id] || {};
            return (
              <tr key={row.id} className={cn('border-b border-border', row.isTotal && 'font-semibold border-t-2 border-foreground/20')}>
                <td className="py-1.5 pr-3">{row.label}{row.isNotifiable ? <span className="ml-1.5 text-xs text-destructive uppercase">Notifiable</span> : null}</td>
                {AGE_SEX_COLS.map((col) => (
                  <td key={col} className="text-right py-1.5 px-2">
                    <EditableCell
                      computedValue={(computed as any)[col] ?? 0}
                      overrideValue={(overrides as any)[col]}
                      onChange={(v) => onOverride(row.id, col, v)}
                      readOnly={readOnly || !!row.isTotal}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Dhis2Report() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user, hasPrivilege } = useAuth();
  const facilityInfo = useFacilityInfo();
  const isAdmin = !!user?.isAdmin;

  const [period, setPeriod] = useState(defaultPeriod());
  const [branchId, setBranchId] = useState<number | null>(isAdmin ? null : (user?.primaryBranchId || user?.branchId || null));
  const [allBranches, setAllBranches] = useState<{ id: number; name: string }[] | null>(null);

  const [definition, setDefinition] = useState<Definition | null>(null);
  const [computed, setComputed] = useState<ComputedReport | null>(null);
  const [savedReport, setSavedReport] = useState<SavedReport | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [header, setHeader] = useState<Record<string, any>>({});
  const [signoff, setSignoff] = useState<Record<string, any>>({});
  const [preparedBySignature, setPreparedBySignature] = useState<string | null>(null);

  // "Prepared by" is always the current account, not a typed name — pulled
  // from the same saved-signature feature Profile.tsx and GRNs already use.
  useEffect(() => {
    if (!user?.uid) return;
    fetchUserSignature(user.uid).then(setPreparedBySignature);
  }, [user?.uid]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canWrite = hasPrivilege('reports.dhis2.view');
  const canFinalize = hasPrivilege('reports.dhis2.finalize');
  const isFinal = savedReport?.status === 'final';
  const isAllBranches = isAdmin && branchId == null;

  useEffect(() => {
    if (!isAdmin) { setAllBranches(null); return; }
    authFetch('/api/facilities/branches/all', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const rows = Array.isArray(data) ? data : (data.data || []);
        setAllBranches(rows.filter((b: any) => b.is_active !== false).map((b: any) => ({ id: Number(b.id), name: b.name })));
      })
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    authFetch('/api/reports-v2/dhis2/definition', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setDefinition)
      .catch(() => toast.error('Failed to load the report definition'));
  }, []);

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (branchId != null) params.set('branch_id', String(branchId));
      const [computeRes, listRes] = await Promise.all([
        authFetch(`/api/reports-v2/dhis2/compute?${params.toString()}`, { credentials: 'include' }),
        branchId != null ? authFetch(`/api/reports-v2/dhis2?branch_id=${branchId}`, { credentials: 'include' }) : Promise.resolve(null),
      ]);
      if (computeRes.ok) setComputed(await computeRes.json());
      else toast.error('Failed to compute the report');

      if (listRes && listRes.ok) {
        const list = await listRes.json();
        const existing = list.find((r: any) => r.period === period);
        if (existing) {
          const detailRes = await authFetch(`/api/reports-v2/dhis2/${existing.id}`, { credentials: 'include' });
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const parsed: SavedReport = {
              ...detail,
              computed_values: typeof detail.computed_values === 'string' ? JSON.parse(detail.computed_values) : detail.computed_values,
              overrides: typeof detail.overrides === 'string' ? JSON.parse(detail.overrides) : (detail.overrides || {}),
              header: typeof detail.header === 'string' ? JSON.parse(detail.header) : (detail.header || {}),
              signoff: typeof detail.signoff === 'string' ? JSON.parse(detail.signoff) : (detail.signoff || {}),
            };
            setSavedReport(parsed);
            setOverrides(parsed.overrides || {});
            setHeader(parsed.header || {});
            setSignoff(parsed.signoff || {});
            setLoading(false);
            return;
          }
        }
      }
      setSavedReport(null);
      setOverrides({});
      setSignoff({});
      // No saved report yet for this branch/period — prefill the header from
      // the branch's own settings (Report Settings dialog) instead of
      // leaving it blank every month.
      if (branchId != null) {
        const settingsRes = await authFetch(`/api/reports-v2/dhis2/settings/mappings?branch_id=${branchId}`, { credentials: 'include' });
        if (settingsRes.ok) {
          const { branchSettings } = await settingsRes.json();
          setHeader(branchSettings || {});
        } else {
          setHeader({});
        }
      } else {
        setHeader({});
      }
    } catch (e) {
      toast.error('Failed to load the DHIS2 report');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadReport(); }, [period, branchId]);

  const setOverride = (section: keyof Overrides, rowId: string, col: string, value: number) => {
    if (isFinal) return;
    setOverrides((prev) => {
      const sectionOverrides = { ...(prev[section] as any) };
      sectionOverrides[rowId] = { ...(sectionOverrides[rowId] || {}), [col]: value };
      return { ...prev, [section]: sectionOverrides };
    });
  };

  const setFlatOverride = (section: 'D' | 'E' | 'F', rowId: string, value: number) => {
    if (isFinal) return;
    setOverrides((prev) => ({ ...prev, [section]: { ...(prev[section] || {}), [rowId]: value } }));
  };

  const save = async (): Promise<SavedReport | null> => {
    if (isAllBranches) { toast.error('Pick a specific branch before saving — "All Branches" is view/export only.'); return null; }
    setSaving(true);
    try {
      // "Prepared by" is stamped from whoever is actually doing the saving,
      // not a free-text name someone could type in on anyone's behalf.
      const signoffToSave = { ...signoff, prepared_by: user?.displayName || signoff.prepared_by || '' };
      const res = await authFetch('/api/reports-v2/dhis2', {
        method: 'POST',
        body: JSON.stringify({ period, branch_id: branchId, overrides, header, signoff: signoffToSave }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to save report'); return null; }
      const saved = await res.json();
      const parsed: SavedReport = {
        ...saved,
        computed_values: typeof saved.computed_values === 'string' ? JSON.parse(saved.computed_values) : saved.computed_values,
        overrides: typeof saved.overrides === 'string' ? JSON.parse(saved.overrides) : (saved.overrides || {}),
        header: typeof saved.header === 'string' ? JSON.parse(saved.header) : (saved.header || {}),
        signoff: typeof saved.signoff === 'string' ? JSON.parse(saved.signoff) : (saved.signoff || {}),
      };
      setSavedReport(parsed);
      setSignoff(parsed.signoff || {});
      return parsed;
    } catch {
      toast.error('Network error saving report');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => { const r = await save(); if (r) toast.success('Draft saved'); };

  const handleFinalize = async () => {
    if (!savedReport) { toast.error('Save the report before finalizing it'); return; }
    if (!(await confirm({ description: 'Finalize this report? It will be locked — only an admin can reopen it.' }))) return;
    const res = await authFetch(`/api/reports-v2/dhis2/${savedReport.id}/finalize`, { method: 'POST' });
    if (res.ok) { toast.success('Report finalized'); loadReport(); }
    else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to finalize'); }
  };

  const handleReopen = async () => {
    if (!savedReport) return;
    if (!(await confirm({ description: 'Reopen this finalized report for editing?' }))) return;
    const res = await authFetch(`/api/reports-v2/dhis2/${savedReport.id}/reopen`, { method: 'POST' });
    if (res.ok) { toast.success('Report reopened'); loadReport(); }
    else { const e = await res.json().catch(() => ({})); toast.error(e.error || 'Failed to reopen'); }
  };

  const handleDownloadExcel = async () => {
    const saved = await save();
    if (!saved) return;
    const facilityCode = header.facility_code || 'FACILITY';
    const res = await authFetch(`/api/reports-v2/dhis2/${saved.id}/export.xlsx`, { credentials: 'include' });
    if (!res.ok) { toast.error('Failed to export Excel'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `DHIS2_${facilityCode}_${period}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async () => {
    const saved = await save();
    if (!saved || !definition) return;
    const { buildDhis2Pdf } = await import('./dhis2Pdf');
    await buildDhis2Pdf(definition, saved, facilityInfo, header, period);
  };

  if (loading && !definition) return <LoadingState variant="page" message="Loading DHIS2 report..." />;
  if (!definition) return <div className="p-12 text-center text-muted-foreground">Failed to load the report definition.</div>;

  const branchOptions = [
    ...(isAdmin ? [{ value: '__all__', label: 'All Branches' }] : []),
    ...((isAdmin ? allBranches : user?.accessibleBranches) || []).map((b: any) => ({ value: String(b.id), label: b.name })),
  ];

  return (
    <div className={cn('dhis2-report', savedReport?.status !== 'final' && 'dhis2-draft')}>
      {confirmDialog}
      <ReportSubPageShell
        title="DHIS2 Monthly Report"
        description="Monthly HMIS facility report, generated from Intellicare data"
        dateFrom={period} dateTo={period}
        onDateFromChange={() => {}} onDateToChange={() => {}}
        hideDateRange
        onRefresh={loadReport}
        loading={loading}
      >
        <div className="space-y-5">
          {/* Filters */}
          <Card className="print:hidden overflow-hidden">
            <CardContent className="p-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Reporting Month</label>
                <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />
              </div>
              <div className="min-w-[220px]">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Branch</label>
                {isAdmin ? (
                  <Combobox
                    options={branchOptions}
                    value={branchId == null ? '__all__' : String(branchId)}
                    onChange={(v) => setBranchId(v === '__all__' ? null : parseInt(v, 10))}
                    searchPlaceholder="Search branches..."
                    className="h-9"
                  />
                ) : (
                  <div className="h-9 flex items-center px-3 text-sm border rounded-md bg-muted/30 text-muted-foreground">
                    {user?.primaryBranchName || 'Your branch'}
                  </div>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {savedReport && (
                  <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full uppercase', isFinal ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')}>
                    {isFinal ? 'Final' : 'Draft'}
                  </span>
                )}
                {isAllBranches && <span className="text-xs text-muted-foreground italic">View/export only — pick a branch to save</span>}
                {isAdmin && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
                    <Settings className="h-3.5 w-3.5" /> Settings
                  </Button>
                )}
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadExcel}><Download className="h-3.5 w-3.5" /> Excel</Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPdf}><Download className="h-3.5 w-3.5" /> PDF</Button>
                {canWrite && !isAllBranches && !isFinal && (
                  <Button size="sm" className="gap-1.5" disabled={saving} onClick={handleSave}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Draft
                  </Button>
                )}
                {canFinalize && savedReport && !isFinal && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-300" onClick={handleFinalize}>
                    <Lock className="h-3.5 w-3.5" /> Finalize
                  </Button>
                )}
                {isAdmin && isFinal && (
                  <Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30" onClick={handleReopen}>
                    <Unlock className="h-3.5 w-3.5" /> Reopen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {loading ? <LoadingState message="Computing report..." /> : computed && (
            <>
              {/* Warnings */}
              {(computed.warnings.length > 0) && (
                <div className="border border-border bg-primary/5 rounded-lg p-3 space-y-1">
                  {computed.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-foreground flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" /> {w}</p>
                  ))}
                </div>
              )}

              {/* Header block */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">Report Header</h4></div>
                <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {definition.headerFields.map((f) => (
                    <div key={f.id}>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                      {f.source === 'branch' ? (
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {user?.isAdmin ? (allBranches?.find((b) => b.id === branchId)?.name || '—') : (user?.primaryBranchName || '—')}
                        </p>
                      ) : (
                        <input
                          disabled={isFinal || !canWrite}
                          type={f.type === 'number' ? 'number' : 'text'}
                          value={header[f.id] ?? ''}
                          onChange={(e) => setHeader((h) => ({ ...h, [f.id]: e.target.value }))}
                          className="w-full h-8 mt-0.5 text-sm border rounded px-2 disabled:bg-muted/30"
                        />
                      )}
                    </div>
                  ))}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Reporting Month</p>
                    <p className="text-sm font-medium text-foreground mt-0.5">{period}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Section A */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">A. {definition.sections.A.title}</h4></div>
                <CardContent className="p-5">
                  <AgeSexSectionTable
                    section={definition.sections.A}
                    computedRows={computed.sections.A as any}
                    overrideRows={(overrides.A as any) || {}}
                    onOverride={(rowId, col, v) => setOverride('A', rowId, col, v)}
                    readOnly={isFinal || !canWrite}
                  />
                </CardContent>
              </Card>

              {/* Section B */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30">
                  <h4 className="font-semibold text-sm text-foreground">B. {definition.sections.B.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{definition.sections.B.warningText}</p>
                </div>
                <CardContent className="p-5">
                  <AgeSexSectionTable
                    section={definition.sections.B}
                    computedRows={computed.sections.B}
                    overrideRows={(overrides.B as any) || {}}
                    onOverride={(rowId, col, v) => setOverride('B', rowId, col, v)}
                    readOnly={isFinal || !canWrite}
                  />
                </CardContent>
              </Card>

              {/* Section C */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">C. {definition.sections.C.title}</h4></div>
                <CardContent className="p-5 overflow-x-auto">
                  <table className="w-full text-sm border-collapse dhis2-section">
                    <thead><tr className="border-b-2 border-foreground/20"><th className="text-left py-2">Test</th><th className="text-right py-2">Tested</th><th className="text-right py-2">Positive</th><th className="text-right py-2">% positive</th></tr></thead>
                    <tbody>
                      {(definition.sections.C.rows || []).map((row) => {
                        const c = computed.sections.C[row.id] || { tested: 0, positive: 0, pct_positive: 0 };
                        const o = (overrides.C as any)?.[row.id] || {};
                        return (
                          <tr key={row.id} className="border-b border-border">
                            <td className="py-1.5">{row.label}</td>
                            <td className="text-right py-1.5"><EditableCell computedValue={c.tested} overrideValue={o.tested} onChange={(v) => setOverride('C', row.id, 'tested', v)} readOnly={isFinal || !canWrite} /></td>
                            <td className="text-right py-1.5"><EditableCell computedValue={c.positive} overrideValue={o.positive} onChange={(v) => setOverride('C', row.id, 'positive', v)} readOnly={isFinal || !canWrite} /></td>
                            <td className="text-right py-1.5">{(o.pct_positive ?? c.pct_positive).toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Section D & E — D's ANC 1st/4th visit rows are computed from
                  Antenatal records; everything else here is still manual
                  entry, since this HMIS has no delivery/postnatal/EPI module
                  to source it from yet. */}
              {(['D', 'E'] as const).map((secId) => (
                <Card key={secId} className="overflow-hidden dhis2-section">
                  <div className="px-5 py-3.5 border-b border-border bg-muted/30">
                    <h4 className="font-semibold text-sm text-foreground">{secId}. {definition.sections[secId].title}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{definition.sections[secId].note}</p>
                  </div>
                  <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {(definition.sections[secId].rows || []).map((row) => {
                      const isComputedRow = secId === 'D' && (row.id === 'anc1' || row.id === 'anc4');
                      return (
                        <div key={row.id}>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</p>
                          {isComputedRow ? (
                            <div className="h-8 mt-0.5 flex items-center">
                              <EditableCell
                                computedValue={(computed.sections.D as any)[row.id] ?? 0}
                                overrideValue={(overrides as any)[secId]?.[row.id]}
                                onChange={(v) => setFlatOverride(secId, row.id, v)}
                                readOnly={isFinal || !canWrite}
                                align="left"
                              />
                            </div>
                          ) : (
                            <input
                              type="number" disabled={isFinal || !canWrite}
                              value={(overrides as any)[secId]?.[row.id] ?? ''}
                              onChange={(e) => setFlatOverride(secId, row.id, parseFloat(e.target.value) || 0)}
                              className="w-full h-8 mt-0.5 text-sm border rounded px-2 disabled:bg-muted/30"
                            />
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}

              {/* Section F */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">F. {definition.sections.F.title}</h4></div>
                <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {(definition.sections.F.rows || []).map((row) => (
                    <div key={row.id}>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</p>
                      <EditableCell
                        computedValue={computed.sections.F[row.id] ?? 0}
                        overrideValue={(overrides.F as any)?.[row.id]}
                        onChange={(v) => setFlatOverride('F', row.id, v)}
                        readOnly={isFinal || !canWrite}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Section G */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">G. {definition.sections.G.title}</h4></div>
                <CardContent className="p-5 overflow-x-auto">
                  <table className="w-full text-sm border-collapse dhis2-section">
                    <thead><tr className="border-b-2 border-foreground/20"><th className="text-left py-2">Item</th>{(definition.sections.G.columns || []).map((c) => <th key={c.id} className="text-right py-2">{c.label}</th>)}</tr></thead>
                    <tbody>
                      {(definition.sections.G.defaultItems || []).map((row) => {
                        const c = computed.sections.G[row.id] || { opening: 0, received: 0, used: 0, closing: 0, daysOutOfStock: 0, itemId: null };
                        const o = (overrides.G as any)?.[row.id] || {};
                        return (
                          <tr key={row.id} className="border-b border-border">
                            <td className="py-1.5">
                              {row.label}
                              {c.unmapped && <span className="ml-1.5 text-xs text-muted-foreground italic">(not mapped — see Settings)</span>}
                              {c.estimated && !c.unmapped && <span className="ml-1.5 text-xs text-amber-700 italic" title="No prior month's closing balance on file — opening estimated from current stock.">(opening estimated)</span>}
                            </td>
                            {['opening', 'received', 'used', 'closing', 'daysOutOfStock'].map((col) => (
                              <td key={col} className="text-right py-1.5">
                                <EditableCell computedValue={(c as any)[col] ?? 0} overrideValue={(o as any)[col]} onChange={(v) => setOverride('G', row.id, col, v)} readOnly={isFinal || !canWrite} />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Section H — sign-off */}
              <Card className="overflow-hidden dhis2-section">
                <div className="px-5 py-3.5 border-b border-border bg-muted/30"><h4 className="font-semibold text-sm text-foreground">H. {definition.sections.H.title}</h4></div>
                <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {(definition.sections.H.fields || []).map((f) => (
                    f.id === 'prepared_by' ? (
                      <div key={f.id}>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                        <p className="text-sm font-medium text-foreground mt-0.5">{signoff.prepared_by || user?.displayName || '—'}</p>
                        {preparedBySignature ? (
                          <img src={preparedBySignature} alt="Signature" className="h-8 mt-1 object-contain" />
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">No signature on file — add one in Profile</p>
                        )}
                      </div>
                    ) : (
                      <div key={f.id}>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
                        <input
                          type={f.type === 'date' ? 'date' : 'text'} disabled={isFinal || !canWrite}
                          value={signoff[f.id] ?? ''}
                          onChange={(e) => setSignoff((s) => ({ ...s, [f.id]: e.target.value }))}
                          className="w-full h-8 mt-0.5 text-sm border rounded px-2 disabled:bg-muted/30"
                        />
                      </div>
                    )
                  ))}
                </CardContent>
              </Card>

              <div className="text-center text-xs text-muted-foreground py-3 print:mt-6">
                Generated by Intellicare — {new Date().toLocaleString()}
              </div>
            </>
          )}
        </div>
      </ReportSubPageShell>

      {settingsOpen && definition && (
        <Dhis2SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          definition={definition}
          branchId={branchId}
          allBranches={allBranches}
        />
      )}
    </div>
  );
}

// ── Settings dialog (admin-only: lab/inventory mappings + branch header) ──

function Dhis2SettingsDialog({ open, onClose, definition, branchId, allBranches }: {
  open: boolean; onClose: () => void; definition: Definition; branchId: number | null; allBranches: { id: number; name: string }[] | null;
}) {
  const [targetBranchId, setTargetBranchId] = useState<number | null>(branchId);
  const [tracerMapping, setTracerMapping] = useState<Record<string, string>>({});
  const [branchSettings, setBranchSettings] = useState<Record<string, any>>({});
  const [inventoryItems, setInventoryItems] = useState<{ id: string; item_name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (targetBranchId == null) return;
    authFetch(`/api/reports-v2/dhis2/settings/mappings?branch_id=${targetBranchId}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const tracer = data.mappings.find((m: any) => m.mapping_type === 'tracer_drugs');
        setTracerMapping(tracer ? (typeof tracer.payload === 'string' ? JSON.parse(tracer.payload) : tracer.payload) : {});
        setBranchSettings(data.branchSettings || {});
      })
      .catch(() => {});
    authFetch('/api/inventory/items?is_active=true', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setInventoryItems((Array.isArray(data) ? data : data?.items || []).map((it: any) => ({ id: it.id, item_name: it.item_name }))))
      .catch(() => {});
  }, [targetBranchId]);

  const handleSave = async () => {
    if (!targetBranchId) { toast.error('Pick a branch first'); return; }
    setSaving(true);
    try {
      await authFetch('/api/reports-v2/dhis2/settings/mappings', {
        method: 'PUT',
        body: JSON.stringify({ branch_id: targetBranchId, mapping_type: 'tracer_drugs', payload: tracerMapping, branch_settings: branchSettings }),
      });
      toast.success('DHIS2 settings saved');
      onClose();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>DHIS2 Report Settings</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Branch</label>
            <Combobox
              options={(allBranches || []).map((b) => ({ value: String(b.id), label: b.name }))}
              value={targetBranchId != null ? String(targetBranchId) : ''}
              onChange={(v) => setTargetBranchId(parseInt(v, 10))}
              searchPlaceholder="Search branches..."
            />
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Facility Header</h4>
            <div className="grid grid-cols-2 gap-3">
              {definition.headerFields.filter((f) => f.editable).map((f) => (
                <div key={f.id}>
                  <label className="text-xs text-muted-foreground">{f.label}</label>
                  <Input value={branchSettings[f.id] ?? ''} onChange={(e) => setBranchSettings((s) => ({ ...s, [f.id]: e.target.value }))} className="h-8 text-sm" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Tracer Drug Mapping (Section G)</h4>
            <div className="space-y-2">
              {definition.sections.G.defaultItems?.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <span className="text-sm w-48 shrink-0">{row.label}</span>
                  <Combobox
                    options={inventoryItems.map((it) => ({ value: it.id, label: it.item_name }))}
                    value={tracerMapping[row.id] || ''}
                    onChange={(v) => setTracerMapping((m) => ({ ...m, [row.id]: v }))}
                    placeholder="Auto-detect from item name"
                    searchPlaceholder="Search inventory items..."
                    className="flex-1"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

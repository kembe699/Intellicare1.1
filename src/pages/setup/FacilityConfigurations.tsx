import React, { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Settings, ShieldCheck, UserPlus, Users, Undo2, Save } from 'lucide-react';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface FacilitySettings {
  queue_receipt_enabled: boolean;
  billing_redirect_after_queue_enabled: boolean;
  patient_number_prefix: string;
  patient_number_suffix: string;
  approvals_allow_same_person: boolean;
  expense_approvals_required: number;
  supplier_bill_approvals_required: number;
  receipt_void_requires_approval: boolean;
  credit_note_separate_approver: boolean;
}
interface HrSettings {
  leave_require_hod: boolean;
  advance_require_hod: boolean;
  advance_require_finance: boolean;
  advance_max_percent_of_salary: number;
  advance_max_open_advances: number;
  advance_max_repayment_months: number;
  advance_min_months_of_service: number;
}

const FACILITY_DEFAULTS: FacilitySettings = {
  queue_receipt_enabled: true,
  billing_redirect_after_queue_enabled: true,
  patient_number_prefix: 'PTN',
  patient_number_suffix: '',
  approvals_allow_same_person: false,
  expense_approvals_required: 2,
  supplier_bill_approvals_required: 3,
  receipt_void_requires_approval: true,
  credit_note_separate_approver: false,
};

const SECTIONS = [
  { id: 'approvals', label: 'Approvals & controls', icon: ShieldCheck },
  { id: 'registration', label: 'Registration & queue', icon: UserPlus },
  { id: 'hr', label: 'HR & attendance', icon: Users },
];

/** One setting as a compact tile: short name, a few words, its control. */
function Row({ title, description, children, warn, wide }: { title: string; description?: React.ReactNode; children: React.ReactNode; warn?: string | false; wide?: boolean }) {
  return (
    <div className={cn('bg-card border rounded-lg shadow-sm p-4 flex flex-col gap-3', wide && 'sm:col-span-2', warn && 'border-warning-border')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {!wide && <div className="shrink-0">{children}</div>}
      </div>
      {wide && <div>{children}</div>}
      {warn && <p className="text-xs text-warning">{warn}</p>}
    </div>
  );
}

/** Small segmented picker for "how many approvals". */
function Choice({ value, options, onChange, disabled }: { value: number; options: { value: number; label: string }[]; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn('h-9 px-3.5 text-sm border-l first:border-l-0 border-border transition-colors disabled:opacity-60',
            value === o.value ? 'bg-primary text-primary-foreground font-semibold' : 'bg-card hover:bg-muted')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: React.ElementType; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground"><Icon className="w-4 h-4 text-primary" />{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div>
    </section>
  );
}

export default function FacilityConfigurations() {
  const { user, hasPrivilege } = useAuth();
  const canFacility = hasPrivilege('setup.facility_settings.manage');
  const canHr = hasPrivilege('leave.manage_settings');
  const canRoster = hasPrivilege('roster.approve');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ f: FacilitySettings; hr: HrSettings | null; roster: boolean | null }>({ f: FACILITY_DEFAULTS, hr: null, roster: null });
  const [f, setF] = useState<FacilitySettings>(FACILITY_DEFAULTS);
  const [hr, setHr] = useState<HrSettings | null>(null);
  const [roster, setRoster] = useState<boolean | null>(null);
  const [active, setActive] = useState('approvals');

  const load = async () => {
    setLoading(true);
    try {
      const [fr, hrr, rr] = await Promise.all([
        authFetch('/api/facility-settings'),
        authFetch('/api/hr/workflow-settings').catch(() => null),
        authFetch('/api/rosters/meta').catch(() => null),
      ]);
      if (!fr.ok) throw new Error('Failed to load configurations');
      const d = await fr.json();
      const nf: FacilitySettings = {
        ...FACILITY_DEFAULTS,
        ...Object.fromEntries(Object.keys(FACILITY_DEFAULTS).map((k) => [k, d[k] ?? (FACILITY_DEFAULTS as any)[k]])),
      };
      const nhr: HrSettings | null = hrr && hrr.ok ? await hrr.json() : null;
      const nroster: boolean | null = rr && rr.ok ? !!(await rr.json()).enforce_clock_in : null;
      setF(nf); setHr(nhr); setRoster(nroster);
      setSaved({ f: nf, hr: nhr, roster: nroster });
    } catch (e: any) {
      toast.error(e.message || 'Network error loading configurations');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const fDirty = JSON.stringify(f) !== JSON.stringify(saved.f);
  const hrDirty = !!hr && JSON.stringify(hr) !== JSON.stringify(saved.hr);
  const rosterDirty = roster !== saved.roster;
  const dirty = fDirty || hrDirty || rosterDirty;

  const save = async () => {
    setSaving(true);
    try {
      const put = async (url: string, body: any) => {
        const res = await authFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      };
      if (fDirty && canFacility) await put('/api/facility-settings', { clinic_id: user?.clinic, ...f });
      if (hrDirty && canHr) await put('/api/hr/workflow-settings', hr);
      if (rosterDirty && canRoster) await put('/api/rosters/settings', { enforce_clock_in: roster });
      toast.success('Configurations saved');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const previewNumber = `${f.patient_number_prefix || 'PTN'}-000182${f.patient_number_suffix ? `-${f.patient_number_suffix}` : ''}`;
  const sections = useMemo(() => SECTIONS.filter((s) => s.id !== 'hr' || hr || roster !== null), [hr, roster]);
  const setFacility = <K extends keyof FacilitySettings>(k: K, v: FacilitySettings[K]) => setF((s) => ({ ...s, [k]: v }));
  const setHrField = <K extends keyof HrSettings>(k: K, v: HrSettings[K]) => setHr((s) => (s ? { ...s, [k]: v } : s));
  const go = (id: string) => { setActive(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <PageHeader icon={<Settings />} title="Configurations" />

        {loading ? (
          <LoadingState message="Loading configurations..." />
        ) : (
          <div className="space-y-6 pb-24">
              <Section id="approvals" title="Approvals & controls" icon={ShieldCheck}>
                <Row title="Expense approvals" description="Needed before payment">
                  <Choice value={f.expense_approvals_required} disabled={!canFacility}
                    options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]}
                    onChange={(v) => setFacility('expense_approvals_required', v)} />
                </Row>
                <Row title="Supplier bill approvals" description="Needed before payment">
                  <Choice value={f.supplier_bill_approvals_required} disabled={!canFacility}
                    options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]}
                    onChange={(v) => setFacility('supplier_bill_approvals_required', v)} />
                </Row>
                <Row title="Same person can approve every level" description="Expenses & supplier bills"
                  warn={f.approvals_allow_same_person && 'One person can approve and pay alone.'}>
                  <Switch checked={f.approvals_allow_same_person} disabled={!canFacility} onCheckedChange={(v) => setFacility('approvals_allow_same_person', v)} aria-label="Let one person give every approval" />
                </Row>
                <Row title="Voids & refunds need approval" description="Cashier requests"
                  warn={!f.receipt_void_requires_approval && 'Cashiers can void/refund without a check.'}>
                  <Switch checked={f.receipt_void_requires_approval} disabled={!canFacility} onCheckedChange={(v) => setFacility('receipt_void_requires_approval', v)} aria-label="Cashier voids and refunds need a second person" />
                </Row>
                <Row title="Credit notes: different approver" description="Creator can’t approve">
                  <Switch checked={f.credit_note_separate_approver} disabled={!canFacility} onCheckedChange={(v) => setFacility('credit_note_separate_approver', v)} aria-label="Credit notes need a different approver" />
                </Row>
              </Section>

              <Section id="registration" title="Registration & queue" icon={UserPlus}>
                <Row title="Print queue receipt" description="At registration">
                  <Switch checked={f.queue_receipt_enabled} disabled={!canFacility} onCheckedChange={(v) => setFacility('queue_receipt_enabled', v)} aria-label="Print queue receipt" />
                </Row>
                <Row title="Open bill after queuing" description="Go straight to billing">
                  <Switch checked={f.billing_redirect_after_queue_enabled} disabled={!canFacility} onCheckedChange={(v) => setFacility('billing_redirect_after_queue_enabled', v)} aria-label="Go straight to billing after queuing" />
                </Row>
                <Row title="Patient number format" description={<span className="font-mono">{previewNumber}</span>} wide>
                  <div className="flex items-center gap-2">
                    <Input aria-label="Prefix" className="w-28" value={f.patient_number_prefix} maxLength={20} placeholder="PTN" disabled={!canFacility}
                      onChange={(e) => setFacility('patient_number_prefix', e.target.value.toUpperCase())} />
                    <span className="text-muted-foreground text-sm">-000182-</span>
                    <Input aria-label="Suffix" className="w-28" value={f.patient_number_suffix} maxLength={20} placeholder="Suffix" disabled={!canFacility}
                      onChange={(e) => setFacility('patient_number_suffix', e.target.value.toUpperCase())} />
                  </div>
                </Row>
              </Section>

              {(hr || roster !== null) && (
                <Section id="hr" title="HR & attendance" icon={Users}>
                  {hr && (
                    <>
                      <Row title="Leave: head of dept first" description="Before HR">
                        <Switch checked={!!hr.leave_require_hod} disabled={!canHr} onCheckedChange={(v) => setHrField('leave_require_hod', v)} aria-label="Leave needs the head of department first" />
                      </Row>
                      <Row title="Advances: head of dept" description="Before HR">
                        <Switch checked={!!hr.advance_require_hod} disabled={!canHr} onCheckedChange={(v) => setHrField('advance_require_hod', v)} aria-label="Salary advances need the head of department" />
                      </Row>
                      <Row title="Advances: finance approval" description="Before payout">
                        <Switch checked={!!hr.advance_require_finance} disabled={!canHr} onCheckedChange={(v) => setHrField('advance_require_finance', v)} aria-label="Salary advances need finance approval" />
                      </Row>
                      <Row title="Salary advance limits" wide>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          {([
                            ['advance_max_percent_of_salary', '% of salary', 1, 100],
                            ['advance_max_open_advances', 'open at once', 1, 10],
                            ['advance_max_repayment_months', 'months to repay', 1, 36],
                            ['advance_min_months_of_service', 'months worked', 0, 60],
                          ] as [keyof HrSettings, string, number, number][]).map(([k, label, min, max]) => (
                            <label key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Input type="number" min={min} max={max} className="w-16" disabled={!canHr} value={Number(hr[k]) as any}
                                onChange={(e) => setHrField(k, Number(e.target.value) as any)} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </Row>
                    </>
                  )}
                  {roster !== null && (
                    <Row title="Clock-in only when rostered" description="Approved rosters only">
                      <Switch checked={roster} disabled={!canRoster} onCheckedChange={(v) => setRoster(v)} aria-label="Only allow clock-in for rostered staff" />
                    </Row>
                  )}
                </Section>
              )}

              {!canFacility && <p className="text-xs text-muted-foreground">Only an administrator can change these settings.</p>}
          </div>
        )}

        {/* Save bar — only when something changed */}
        {dirty && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-card border border-border shadow-lg rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-sm text-foreground">You have unsaved changes</span>
            <Button variant="ghost" size="sm" onClick={() => { setF(saved.f); setHr(saved.hr); setRoster(saved.roster); }} disabled={saving}>
              <Undo2 className="w-4 h-4 mr-1.5" />Discard
            </Button>
            <Button size="sm" onClick={save} loading={saving}><Save className="w-4 h-4 mr-1.5" />Save changes</Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

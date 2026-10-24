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

/** One setting: what it does on the left, its control on the right. */
function Row({ title, description, children, warn }: { title: string; description: React.ReactNode; children: React.ReactNode; warn?: string | false }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 sm:max-w-xl">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        {warn && <p className="text-xs text-warning mt-1.5">{warn}</p>}
      </div>
      <div className="shrink-0">{children}</div>
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

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-card border rounded-lg shadow-sm scroll-mt-4">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="px-5 py-4 divide-y divide-border">{children}</div>
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
        <PageHeader icon={<Settings />} title="Configurations" subtitle="How this facility works — approvals, registration and HR rules. Changes apply as soon as you save." />

        {loading ? (
          <LoadingState message="Loading configurations..." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[13rem_1fr] gap-6 items-start pb-24">
            {/* Section menu */}
            <nav className="lg:sticky lg:top-4 bg-card border rounded-lg shadow-sm p-2 flex lg:flex-col gap-1 overflow-x-auto" aria-label="Configuration sections">
              {sections.map((s) => (
                <button key={s.id} type="button" onClick={() => go(s.id)}
                  className={cn('flex items-center gap-2 rounded-md px-3 h-10 text-sm whitespace-nowrap text-left transition-colors',
                    active === s.id ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-muted')}>
                  <s.icon className="w-4 h-4 shrink-0" />{s.label}
                </button>
              ))}
            </nav>

            <div className="space-y-5 min-w-0 max-w-4xl">
              <Section id="approvals" title="Approvals & controls" description="Who has to sign off on money going out or being given back.">
                <Row title="Approvals needed for an expense" description="Each expense request must get this many approvals before it can be paid.">
                  <Choice value={f.expense_approvals_required} disabled={!canFacility}
                    options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]}
                    onChange={(v) => setFacility('expense_approvals_required', v)} />
                </Row>
                <Row title="Approvals needed for a supplier bill" description="Checked by → Reviewed by → Approved by. A supplier bill can be paid once it has this many.">
                  <Choice value={f.supplier_bill_approvals_required} disabled={!canFacility}
                    options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]}
                    onChange={(v) => setFacility('supplier_bill_approvals_required', v)} />
                </Row>
                <Row title="Let one person give every approval"
                  description={<>When on, the same person can approve an expense or supplier bill more than once, so you no longer see “You have already approved this expense — a second, different approver is required”. When off, each approval must come from a different person (individual exceptions can still be set under Setup › Approvals).</>}
                  warn={f.approvals_allow_same_person && 'One person can now approve and release payments alone.'}>
                  <Switch checked={f.approvals_allow_same_person} disabled={!canFacility} onCheckedChange={(v) => setFacility('approvals_allow_same_person', v)} aria-label="Let one person give every approval" />
                </Row>
                <Row title="Cashier voids and refunds need a second person"
                  description="When on, a receipt void or refund asked for by a cashier waits under Accounting › Refunds until someone with approval rights signs it off. When off, it takes effect immediately."
                  warn={!f.receipt_void_requires_approval && 'Cashiers can now void or refund their own receipts without anyone checking.'}>
                  <Switch checked={f.receipt_void_requires_approval} disabled={!canFacility} onCheckedChange={(v) => setFacility('receipt_void_requires_approval', v)} aria-label="Cashier voids and refunds need a second person" />
                </Row>
                <Row title="Credit notes need a different approver" description="When on, the person who created a credit note cannot approve it themselves.">
                  <Switch checked={f.credit_note_separate_approver} disabled={!canFacility} onCheckedChange={(v) => setFacility('credit_note_separate_approver', v)} aria-label="Credit notes need a different approver" />
                </Row>
              </Section>

              <Section id="registration" title="Registration & queue" description="What happens at the front desk when a patient is registered and queued.">
                <Row title="Print queue receipt" description="Print a thermal slip with the queue number and patient number whenever a patient is queued at LIS Registration.">
                  <Switch checked={f.queue_receipt_enabled} disabled={!canFacility} onCheckedChange={(v) => setFacility('queue_receipt_enabled', v)} aria-label="Print queue receipt" />
                </Row>
                <Row title="Go straight to billing after queuing" description="After a patient is queued, open their bill. Turn this off if your front desk bills separately — the bill is still created either way.">
                  <Switch checked={f.billing_redirect_after_queue_enabled} disabled={!canFacility} onCheckedChange={(v) => setFacility('billing_redirect_after_queue_enabled', v)} aria-label="Go straight to billing after queuing" />
                </Row>
                <Row title="Patient number format" description={<>Prefix and optional suffix around the 6-digit number. Example: <span className="font-mono font-medium text-foreground">{previewNumber}</span></>}>
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
                <Section id="hr" title="HR & attendance" description="Leave, salary advances and clock-in rules.">
                  {hr && (
                    <>
                      <Row title="Leave needs the head of department first" description="Leave requests go to the employee's head of department before HR.">
                        <Switch checked={!!hr.leave_require_hod} disabled={!canHr} onCheckedChange={(v) => setHrField('leave_require_hod', v)} aria-label="Leave needs the head of department first" />
                      </Row>
                      <Row title="Salary advances need the head of department" description="Advance requests go to the head of department before HR.">
                        <Switch checked={!!hr.advance_require_hod} disabled={!canHr} onCheckedChange={(v) => setHrField('advance_require_hod', v)} aria-label="Salary advances need the head of department" />
                      </Row>
                      <Row title="Salary advances need finance approval" description="An extra Finance/Accounts sign-off before an advance can be paid out.">
                        <Switch checked={!!hr.advance_require_finance} disabled={!canHr} onCheckedChange={(v) => setHrField('advance_require_finance', v)} aria-label="Salary advances need finance approval" />
                      </Row>
                      <Row title="Salary advance limits" description="Largest advance as a share of basic salary, how many can be open at once, the longest repayment, and how long someone must have worked first.">
                        <div className="grid grid-cols-2 gap-2 w-72">
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
                    <Row title="Only allow clock-in for rostered staff" description="For departments whose duty roster for the month is approved, staff can clock in only around their rostered shift (HR › Duty Rosters).">
                      <Switch checked={roster} disabled={!canRoster} onCheckedChange={(v) => setRoster(v)} aria-label="Only allow clock-in for rostered staff" />
                    </Row>
                  )}
                </Section>
              )}

              {!canFacility && <p className="text-xs text-muted-foreground">You can view these settings; only an administrator can change them.</p>}
            </div>
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

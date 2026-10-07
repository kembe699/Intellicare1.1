import React, { useState, useEffect } from 'react';
import { Activity, Clock, Check, Loader2, X } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import GynaeFields, { EMPTY_GYNAE_INFO, GynaeInfo } from '@/components/clinical/GynaeFields';

const EMPTY_VITALS = {
  blood_pressure: '', pulse: '', temperature: '', respiratory_rate: '',
  weight: '', height: '', spo2: '', fasting_status: 'No', allergies: '',
  gynae: EMPTY_GYNAE_INFO as GynaeInfo,
};

// Same field set/names as the doctor's "New Order" vitals form (LISTestOrders.tsx) so a
// triage saved here merges in cleanly there — deliberately vitals only, no chief
// complaints/history, which stay the doctor's job.
type Vitals = typeof EMPTY_VITALS;

const formatWaitTime = (createdAt: string) => {
  const diff = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const hasVitals = (v: any) => !!v && Object.entries(v).some(([k, val]) => k !== 'fasting_status' && k !== 'gynae' && val !== '' && val != null);

export default function Triage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [vitals, setVitals] = useState<Vitals>(EMPTY_VITALS);
  const [saving, setSaving] = useState(false);

  const fetchQueue = async () => {
    try {
      const res = await authFetch('/api/lis/queue', { credentials: 'include' });
      if (res.ok) setQueue(await res.json());
    } catch (e) {
      console.error('Failed to fetch queue', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  // Backend returns oldest-first; re-sort latest-first to match this app's convention.
  const sortedQueue = [...queue].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const selectPatient = (p: any) => {
    setSelected(p);
    setVitals(hasVitals(p.vitals) ? { ...EMPTY_VITALS, ...p.vitals } : EMPTY_VITALS);
  };

  const handleSave = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/lis/orders/${selected.order_id}/triage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vitals }),
      });
      if (res.ok) {
        toast.success(`Vitals saved for ${selected.first_name} ${selected.last_name}`);
        setSelected(null);
        setVitals(EMPTY_VITALS);
        fetchQueue();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to save vitals');
      }
    } catch {
      toast.error('Network error saving vitals');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<any>[] = [
    {
      key: 'first_name', header: 'Patient',
      render: (_v, p) => (
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{p.first_name} {p.last_name}</p>
          <p className="text-xs text-muted-foreground font-mono">{p.participant_number}</p>
        </div>
      ),
    },
    { key: 'gender', header: 'Sex', render: (v) => v || '-' },
    {
      key: 'created_at', header: 'Waiting',
      render: (v) => <span className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap"><Clock className="w-3 h-3" /> {formatWaitTime(v)}</span>,
    },
    { key: 'doctor_name', header: 'Doctor', render: (v) => v ? `Dr. ${v}` : <span className="text-muted-foreground">-</span> },
    {
      key: 'vitals', header: 'Status',
      render: (v) => {
        const triaged = hasVitals(v);
        return (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${triaged ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {triaged ? 'Triaged' : 'Not Triaged'}
          </span>
        );
      },
    },
  ];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col gap-6">
      <PageHeader title="Triage" icon={<Activity />} className="mb-0" />

      {/* Waiting area */}
      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h4 className="font-semibold text-sm text-foreground">Waiting Area ({sortedQueue.length})</h4>
        </div>
        <AdvancedDataTable<any>
          data={sortedQueue}
          keyExtractor={(p) => p.order_id}
          loading={loading}
          emptyMessage="No patients waiting"
          searchable
          pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
          onRowClick={(p) => selectPatient(p)}
          columns={columns}
        />
      </div>

      {/* Vitals form — only once a patient is picked from the table above */}
      {selected && (
        <div className="bg-card rounded-lg border shadow-sm p-6 space-y-5">
          <div className="flex justify-between items-start border-b pb-3">
            <div>
              <h3 className="font-semibold text-lg">{selected.first_name} {selected.last_name}</h3>
              <p className="text-xs text-muted-foreground font-mono">{selected.participant_number}</p>
            </div>
            <div className="flex items-center gap-3">
              {selected.triaged_by_name && (
                <span className="text-[11px] text-muted-foreground text-right">
                  Previously triaged by {selected.triaged_by_name}
                  {selected.triaged_at && <><br />{new Date(selected.triaged_at).toLocaleString()}</>}
                </span>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelected(null); setVitals(EMPTY_VITALS); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Blood Pressure (mmHg)</label>
              <Input placeholder="e.g. 120/80" value={vitals.blood_pressure} onChange={e => setVitals({ ...vitals, blood_pressure: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Pulse (bpm)</label>
              <Input placeholder="e.g. 75" type="number" value={vitals.pulse} onChange={e => setVitals({ ...vitals, pulse: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Temperature (°C)</label>
              <Input placeholder="e.g. 37.2" type="number" step="0.1" value={vitals.temperature} onChange={e => setVitals({ ...vitals, temperature: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Resp. Rate (bpm)</label>
              <Input placeholder="e.g. 16" type="number" value={vitals.respiratory_rate} onChange={e => setVitals({ ...vitals, respiratory_rate: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Weight (kg)</label>
              <Input placeholder="e.g. 70.5" type="number" step="0.1" value={vitals.weight} onChange={e => setVitals({ ...vitals, weight: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Height (cm)</label>
              <Input placeholder="e.g. 175" type="number" step="0.1" value={vitals.height} onChange={e => setVitals({ ...vitals, height: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">SpO2 (%)</label>
              <Input placeholder="e.g. 98" type="number" value={vitals.spo2} onChange={e => setVitals({ ...vitals, spo2: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Fasting Status</label>
              <Combobox
                options={[{ value: 'No', label: 'No (Non-Fasting)' }, { value: 'Yes', label: 'Yes (Fasting)' }]}
                value={vitals.fasting_status}
                onChange={v => setVitals({ ...vitals, fasting_status: v })}
                searchPlaceholder="Search..."
                className="mt-1 h-9"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground">Allergies</label>
            <Textarea
              placeholder="Enter allergy"
              className="resize-none mt-1"
              rows={2}
              value={vitals.allergies}
              onChange={e => setVitals({ ...vitals, allergies: e.target.value })}
            />
          </div>

          {selected?.gender?.toLowerCase() === 'female' && (
            <GynaeFields value={vitals.gynae} onChange={(gynae) => setVitals({ ...vitals, gynae })} />
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setSelected(null); setVitals(EMPTY_VITALS); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Save Vitals
            </Button>
          </div>
        </div>
      )}
      </div>
    </AppLayout>
  );
}

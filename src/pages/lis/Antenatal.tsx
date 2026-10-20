import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartPulse, Check, Loader2, UserPlus } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { fetchPatientDirectory, DirectoryPerson } from '@/lib/patientDirectory';
import { formatDate } from '@/lib/format';

// Registration + visit log for ANC (antenatal) care. A registration also
// arrives automatically the moment a female patient's "Antenatal Care" box
// is ticked and saved on Triage or the doctor's clinical notes (GynaeFields'
// antenatal_enabled) — this page is where it's then managed on: list, open
// a profile, add visits, print the WHO-style card.
interface AntenatalRow {
  id: string;
  participant_id: string;
  registration_number: string;
  lmp: string | null;
  edd: string | null;
  gravida: string | null;
  para: string | null;
  status: 'active' | 'delivered' | 'closed';
  source: 'manual' | 'auto';
  visit_count: string | number;
  last_visit_date: string | null;
  first_name: string;
  last_name: string;
  participant_number: string;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    delivered: 'bg-blue-100 text-blue-700',
    closed: 'bg-slate-100 text-slate-600',
  };
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${map[status] || map.closed}`}>{status}</span>;
}

export default function Antenatal() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AntenatalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);

  const [open, setOpen] = useState(false);
  const [participantId, setParticipantId] = useState('');
  const [lmp, setLmp] = useState('');
  const [edd, setEdd] = useState('');
  const [gravida, setGravida] = useState('');
  const [para, setPara] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [riskNotes, setRiskNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPatientDirectory().then(({ people, failed }) => {
      setPeople(people.filter(p => p.source === 'lis'));
      if (failed.length > 0) toast.error(`Could not load the patient list from: ${failed.join(', ')}`);
    });
  }, []);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/antenatal', { credentials: 'include' });
      if (res.ok) setRows(await res.json());
    } catch (e) {
      console.error('Failed to fetch antenatal registrations', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); }, []);

  const resetForm = () => {
    setParticipantId(''); setLmp(''); setEdd(''); setGravida(''); setPara(''); setBloodGroup(''); setRiskNotes('');
  };

  const handleRegister = async () => {
    if (!participantId) { toast.error('Select a patient'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/antenatal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participant_id: participantId, lmp: lmp || undefined, edd: edd || undefined,
          gravida: gravida || undefined, para: para || undefined, blood_group: bloodGroup || undefined, risk_notes: riskNotes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('Patient registered for antenatal care');
        setOpen(false);
        resetForm();
        fetchRows();
        navigate(`/nursing/antenatal/${data.id}`);
      } else if (res.status === 409 && data.id) {
        toast.info('Already registered — opening their profile');
        setOpen(false);
        navigate(`/nursing/antenatal/${data.id}`);
      } else {
        toast.error(data.error || 'Failed to register patient');
      }
    } catch {
      toast.error('Network error registering patient');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<AntenatalRow>[] = [
    { key: 'registration_number', header: 'Reg. No.', render: (v) => <span className="font-mono text-xs">{v}</span> },
    { key: 'first_name', header: 'Patient', render: (_v, row) => <div><p className="font-medium text-sm">{row.first_name} {row.last_name}</p><p className="text-xs text-muted-foreground font-mono">{row.participant_number}</p></div> },
    { key: 'edd', header: 'EDD', render: (v) => v ? formatDate(v) : <span className="text-muted-foreground">-</span> },
    { key: 'gravida', header: 'G/P', render: (_v, row) => (row.gravida || row.para) ? `G${row.gravida || '-'} P${row.para || '-'}` : <span className="text-muted-foreground">-</span> },
    { key: 'visit_count', header: 'Visits', render: (v) => <Badge variant="outline">{v}</Badge> },
    { key: 'last_visit_date', header: 'Last Visit', render: (v) => v ? formatDate(v) : <span className="text-muted-foreground">-</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'source', header: 'Source', render: (v) => <span className="text-xs text-muted-foreground capitalize">{v === 'auto' ? 'Auto (LIS)' : 'Manual'}</span> },
  ];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <PageHeader title="Antenatal Care" icon={<HeartPulse />} className="mb-3" actions={
          <Button className="gap-1.5" onClick={() => setOpen(true)}><UserPlus className="w-4 h-4" /> Register Patient</Button>
        } />

        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <AdvancedDataTable<AntenatalRow>
            data={rows}
            keyExtractor={(r) => r.id}
            loading={loading}
            emptyMessage="No antenatal registrations yet"
            searchable
            exportable
            pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
            onRowClick={(row) => navigate(`/nursing/antenatal/${row.id}`)}
            columns={columns}
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><HeartPulse className="w-5 h-5" /> Register for Antenatal Care</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Patient *</label>
              <Combobox
                options={people.map(p => ({ value: p.id, label: `${p.label}${p.code ? ` (${p.code})` : ''}` }))}
                value={participantId}
                onChange={setParticipantId}
                placeholder="Search patient..."
                searchPlaceholder="Search patient..."
                className="mt-1 h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">LMP (last menstrual period)</label>
                <Input type="date" value={lmp} onChange={e => setLmp(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">EDD</label>
                <Input type="date" value={edd} onChange={e => setEdd(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Gravida</label>
                <Input placeholder="e.g. 3" value={gravida} onChange={e => setGravida(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Para</label>
                <Input placeholder="e.g. 2" value={para} onChange={e => setPara(e.target.value)} className="mt-1" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-muted-foreground">Blood Group</label>
                <Input placeholder="e.g. O+" value={bloodGroup} onChange={e => setBloodGroup(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Risk Notes</label>
              <Textarea placeholder="Optional" value={riskNotes} onChange={e => setRiskNotes(e.target.value)} rows={2} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="gap-1.5" disabled={saving} onClick={handleRegister}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Register
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

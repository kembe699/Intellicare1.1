import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, HeartPulse, Check, Loader2, Printer, Plus } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useFacilityInfo } from '@/hooks/useFacilityInfo';
import * as docTemplate from '@/utils/documentTemplate';

interface AntenatalVisit {
  id: string;
  visit_date: string;
  gestational_age_weeks: string | null;
  blood_pressure: string | null;
  weight: string | null;
  fundal_height: string | null;
  fetal_heart_rate: string | null;
  fetal_presentation: string | null;
  urine_protein: string | null;
  urine_glucose: string | null;
  hb_level: string | null;
  next_appointment: string | null;
  notes: string | null;
  recorded_by_name: string | null;
}

interface AntenatalProfileData {
  id: string;
  participant_id: string;
  registration_number: string;
  lmp: string | null;
  edd: string | null;
  gravida: string | null;
  para: string | null;
  blood_group: string | null;
  risk_notes: string | null;
  status: string;
  first_name: string;
  last_name: string;
  participant_number: string;
  date_of_birth: string | null;
  phone: string | null;
  registered_by_name: string | null;
  created_at: string;
  visits: AntenatalVisit[];
}

const EMPTY_VISIT = {
  gestational_age_weeks: '', blood_pressure: '', weight: '', fundal_height: '',
  fetal_heart_rate: '', fetal_presentation: '', urine_protein: '', urine_glucose: '', hb_level: '',
  next_appointment: '', notes: '',
};

export default function AntenatalProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const facilityInfo = useFacilityInfo();

  const [profile, setProfile] = useState<AntenatalProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [visit, setVisit] = useState({ ...EMPTY_VISIT });
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/antenatal/${id}`, { credentials: 'include' });
      if (res.ok) setProfile(await res.json());
      else if (res.status === 404) toast.error('Registration not found');
    } catch (e) {
      console.error('Failed to fetch antenatal profile', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleAddVisit = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/antenatal/${id}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(visit),
      });
      if (res.ok) {
        toast.success('Visit recorded');
        setOpen(false);
        setVisit({ ...EMPTY_VISIT });
        fetchProfile();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to record visit');
      }
    } catch {
      toast.error('Network error recording visit');
    } finally {
      setSaving(false);
    }
  };

  // WHO-style antenatal card: patient/registration header, then one row per
  // visit across the standard ANC measurements — printed as a visit-history
  // report, not the full WHO 8-contact scheduling model (per the agreed
  // first-version scope).
  const handlePrint = () => {
    if (!profile) return;
    const age = profile.date_of_birth ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000) : null;

    const infoHTML = docTemplate.buildInfoGrid(
      {
        title: 'Patient', rows: [
          { label: 'Name', value: `${profile.first_name} ${profile.last_name}`, bold: true },
          { label: 'Patient No.', value: profile.participant_number },
          { label: 'Age', value: age != null ? `${age} yrs` : '-' },
          { label: 'Phone', value: profile.phone || '-' },
        ],
      },
      {
        title: 'Antenatal Registration', rows: [
          { label: 'Reg. No.', value: profile.registration_number },
          { label: 'LMP', value: docTemplate.formatDate(profile.lmp) },
          { label: 'EDD', value: docTemplate.formatDate(profile.edd) },
          { label: 'Gravida / Para', value: `G${profile.gravida || '-'} P${profile.para || '-'}` },
          { label: 'Blood Group', value: profile.blood_group || '-' },
        ],
      }
    );

    const visitsHTML = docTemplate.buildTable(
      [
        { label: 'Date' }, { label: 'GA (wks)' }, { label: 'BP' }, { label: 'Weight (kg)' },
        { label: 'Fundal Ht (cm)' }, { label: 'FHR' }, { label: 'Presentation' },
        { label: 'Urine (P/G)' }, { label: 'Hb' }, { label: 'Next Appt.' },
      ],
      [...profile.visits].reverse().map((v) => ({
        cells: [
          docTemplate.formatDate(v.visit_date),
          v.gestational_age_weeks || '-', v.blood_pressure || '-', v.weight || '-',
          v.fundal_height || '-', v.fetal_heart_rate || '-', v.fetal_presentation || '-',
          `${v.urine_protein || '-'} / ${v.urine_glucose || '-'}`, v.hb_level || '-',
          v.next_appointment ? docTemplate.formatDate(v.next_appointment) : '-',
        ],
      }))
    );

    const riskHTML = profile.risk_notes ? docTemplate.buildNotes(`Risk factors: ${profile.risk_notes}`) : '';

    const bodyHTML = [
      infoHTML,
      '<div class="ic-section-title">Antenatal Visit History</div>',
      profile.visits.length > 0 ? visitsHTML : '<p style="color:#64748b;font-size:13px;">No visits recorded yet.</p>',
      riskHTML,
      docTemplate.buildSignatures([{ label: 'Attending Nurse / Midwife', name: user?.displayName || '' }]),
    ].join('\n');

    const html = docTemplate.buildDocument({
      title: 'Antenatal Card',
      docType: 'WHO Antenatal Care Record',
      docNumber: profile.registration_number,
      date: new Date(),
      bodyHTML,
      logoUrl: facilityInfo.facilityLogo || `${window.location.origin}/hjd-icon.png`,
      facilityInfo: { name: facilityInfo.facilityName, type: facilityInfo.facilityType, address: facilityInfo.facilityAddress, city: facilityInfo.facilityCity, phone: facilityInfo.facilityPhone, email: facilityInfo.facilityEmail, licenseNo: facilityInfo.facilityLicenseNo },
      branchInfo: { name: facilityInfo.branchName, address: facilityInfo.branchAddress, phone: facilityInfo.branchPhone },
    });

    docTemplate.openPrintWindow(html);
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/nursing/antenatal')}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <PageHeader title="Antenatal Record" icon={<HeartPulse />} className="mb-0" />
          </div>
          {profile && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5" onClick={handlePrint}><Printer className="w-4 h-4" /> Print ANC Card</Button>
              <Button className="gap-1.5" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Add Visit</Button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...</div>
        ) : !profile ? (
          <div className="bg-card rounded-lg border shadow-sm p-8 text-center text-muted-foreground">Registration not found.</div>
        ) : (
          <div className="space-y-6">
            <div className="bg-card rounded-lg border shadow-sm p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Patient</p>
                <p className="font-semibold">{profile.first_name} {profile.last_name}</p>
                <p className="text-xs text-muted-foreground font-mono">{profile.participant_number}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reg. No.</p>
                <p className="font-semibold font-mono">{profile.registration_number}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">LMP / EDD</p>
                <p className="font-semibold">{profile.lmp ? new Date(profile.lmp).toLocaleDateString() : '-'} / {profile.edd ? new Date(profile.edd).toLocaleDateString() : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gravida / Para</p>
                <p className="font-semibold">G{profile.gravida || '-'} P{profile.para || '-'}</p>
              </div>
            </div>

            {profile.risk_notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                <strong>Risk Notes:</strong> {profile.risk_notes}
              </div>
            )}

            <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-muted/30">
                <h4 className="font-semibold text-sm text-foreground">Visit History ({profile.visits.length})</h4>
              </div>
              {profile.visits.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No visits recorded yet. Click "Add Visit" to log the first one.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20 text-xs text-muted-foreground uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">GA (wks)</th>
                        <th className="text-left px-3 py-2">BP</th>
                        <th className="text-left px-3 py-2">Weight</th>
                        <th className="text-left px-3 py-2">Fundal Ht</th>
                        <th className="text-left px-3 py-2">FHR</th>
                        <th className="text-left px-3 py-2">Presentation</th>
                        <th className="text-left px-3 py-2">Urine (P/G)</th>
                        <th className="text-left px-3 py-2">Hb</th>
                        <th className="text-left px-3 py-2">Next Appt.</th>
                        <th className="text-left px-3 py-2">By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {profile.visits.map(v => (
                        <tr key={v.id}>
                          <td className="px-3 py-2 whitespace-nowrap">{new Date(v.visit_date).toLocaleDateString()}</td>
                          <td className="px-3 py-2">{v.gestational_age_weeks || '-'}</td>
                          <td className="px-3 py-2">{v.blood_pressure || '-'}</td>
                          <td className="px-3 py-2">{v.weight || '-'}</td>
                          <td className="px-3 py-2">{v.fundal_height || '-'}</td>
                          <td className="px-3 py-2">{v.fetal_heart_rate || '-'}</td>
                          <td className="px-3 py-2">{v.fetal_presentation || '-'}</td>
                          <td className="px-3 py-2">{v.urine_protein || '-'} / {v.urine_glucose || '-'}</td>
                          <td className="px-3 py-2">{v.hb_level || '-'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{v.next_appointment ? new Date(v.next_appointment).toLocaleDateString() : '-'}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{v.recorded_by_name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setVisit({ ...EMPTY_VISIT }); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><HeartPulse className="w-5 h-5" /> Record Antenatal Visit</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Gestational Age (weeks)</label>
              <Input type="number" value={visit.gestational_age_weeks} onChange={e => setVisit({ ...visit, gestational_age_weeks: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Blood Pressure</label>
              <Input placeholder="e.g. 120/80" value={visit.blood_pressure} onChange={e => setVisit({ ...visit, blood_pressure: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Weight (kg)</label>
              <Input type="number" step="0.1" value={visit.weight} onChange={e => setVisit({ ...visit, weight: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Fundal Height (cm)</label>
              <Input type="number" step="0.1" value={visit.fundal_height} onChange={e => setVisit({ ...visit, fundal_height: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Fetal Heart Rate</label>
              <Input placeholder="e.g. 140 bpm" value={visit.fetal_heart_rate} onChange={e => setVisit({ ...visit, fetal_heart_rate: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Fetal Presentation</label>
              <Input placeholder="e.g. Cephalic" value={visit.fetal_presentation} onChange={e => setVisit({ ...visit, fetal_presentation: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Urine Protein</label>
              <Input placeholder="e.g. Nil" value={visit.urine_protein} onChange={e => setVisit({ ...visit, urine_protein: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Urine Glucose</label>
              <Input placeholder="e.g. Nil" value={visit.urine_glucose} onChange={e => setVisit({ ...visit, urine_glucose: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Hb Level</label>
              <Input placeholder="Optional" value={visit.hb_level} onChange={e => setVisit({ ...visit, hb_level: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Next Appointment</label>
              <Input type="date" value={visit.next_appointment} onChange={e => setVisit({ ...visit, next_appointment: e.target.value })} className="mt-1" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Notes</label>
              <Textarea placeholder="Optional" value={visit.notes} onChange={e => setVisit({ ...visit, notes: e.target.value })} rows={2} className="mt-1" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="gap-1.5" disabled={saving} onClick={handleAddVisit}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Visit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

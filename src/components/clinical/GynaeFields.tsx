import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';

// Gynecology/obstetric fields, shown only for a female patient — shared
// across the three places that capture or edit a visit's clinical
// notes/vitals (Triage, the doctor's "Record Vitals" step, and Visit
// Summary's own editable Clinical Notes), so the same fields mean the same
// thing wherever they're filled in or reviewed. Antenatal is an optional
// sub-section (a checkbox reveals it) — not every visit with a female
// patient is an antenatal visit.
export interface AntenatalInfo {
  gestational_age_weeks?: string;
  fundal_height_cm?: string;
  fetal_heart_rate?: string;
  fetal_presentation?: string;
  notes?: string;
}

export interface GynaeInfo {
  pregnancy_status?: string; // '' | 'Not Pregnant' | 'Pregnant' | 'Unknown'
  lmp?: string;
  edd?: string;
  gravida?: string;
  para?: string;
  menstrual_cycle?: string;
  presenting_symptoms?: string;
  antenatal_enabled?: boolean;
  antenatal?: AntenatalInfo;
}

export const EMPTY_GYNAE_INFO: GynaeInfo = {
  pregnancy_status: '', lmp: '', edd: '', gravida: '', para: '',
  menstrual_cycle: '', presenting_symptoms: '', antenatal_enabled: false,
  antenatal: { gestational_age_weeks: '', fundal_height_cm: '', fetal_heart_rate: '', fetal_presentation: '', notes: '' },
};

/** True when there's anything in here actually worth showing/saving. */
export function hasGynaeInfo(g: GynaeInfo | undefined | null): boolean {
  if (!g) return false;
  const { antenatal, antenatal_enabled, ...rest } = g;
  if (Object.values(rest).some((v) => v)) return true;
  if (antenatal_enabled && antenatal && Object.values(antenatal).some((v) => v)) return true;
  return false;
}

const PREGNANCY_STATUS_OPTIONS = [
  { value: 'Not Pregnant', label: 'Not Pregnant' },
  { value: 'Pregnant', label: 'Pregnant' },
  { value: 'Unknown', label: 'Unknown' },
];

interface GynaeFieldsProps {
  value: GynaeInfo;
  onChange: (next: GynaeInfo) => void;
  disabled?: boolean;
}

export default function GynaeFields({ value, onChange, disabled }: GynaeFieldsProps) {
  const v = { ...EMPTY_GYNAE_INFO, ...value, antenatal: { ...EMPTY_GYNAE_INFO.antenatal, ...value.antenatal } };
  const set = (patch: Partial<GynaeInfo>) => onChange({ ...v, ...patch });
  const setAntenatal = (patch: Partial<AntenatalInfo>) => onChange({ ...v, antenatal: { ...v.antenatal, ...patch } });

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-pink-50/40 border-pink-200">
      <p className="text-xs font-semibold text-pink-800 uppercase">Gynecology / Obstetric</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Pregnancy Status</label>
          <Combobox
            options={PREGNANCY_STATUS_OPTIONS}
            value={v.pregnancy_status || ''}
            onChange={(val) => set({ pregnancy_status: val })}
            placeholder="Select..."
            searchPlaceholder="Search..."
            className="mt-1 h-9"
          />
        </div>
        {v.pregnancy_status === 'Pregnant' && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground">EDD (Expected Date of Delivery)</label>
            <Input type="date" value={v.edd} onChange={(e) => set({ edd: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-muted-foreground">LMP (Last Menstrual Period)</label>
          <Input type="date" value={v.lmp} onChange={(e) => set({ lmp: e.target.value })} className="mt-1" disabled={disabled} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Gravida</label>
            <Input type="number" min="0" placeholder="e.g. 2" value={v.gravida} onChange={(e) => set({ gravida: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Para</label>
            <Input type="number" min="0" placeholder="e.g. 1" value={v.para} onChange={(e) => set({ para: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground">Menstrual Cycle</label>
        <Input placeholder="e.g. Regular, 28 days" value={v.menstrual_cycle} onChange={(e) => set({ menstrual_cycle: e.target.value })} className="mt-1" disabled={disabled} />
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground">Presenting Gynae Symptoms</label>
        <Textarea placeholder="e.g. abnormal bleeding, discharge, pelvic pain..." value={v.presenting_symptoms} onChange={(e) => set({ presenting_symptoms: e.target.value })} rows={2} className="resize-none mt-1" disabled={disabled} />
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          className="rounded border-input"
          checked={!!v.antenatal_enabled}
          disabled={disabled}
          onChange={(e) => set({ antenatal_enabled: e.target.checked })}
        />
        Antenatal Care (optional)
      </label>

      {v.antenatal_enabled && (
        <div className="grid grid-cols-2 gap-3 pl-1 border-l-2 border-pink-200 ml-1">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Gestational Age (weeks)</label>
            <Input type="number" min="0" value={v.antenatal?.gestational_age_weeks} onChange={(e) => setAntenatal({ gestational_age_weeks: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Fundal Height (cm)</label>
            <Input type="number" min="0" value={v.antenatal?.fundal_height_cm} onChange={(e) => setAntenatal({ fundal_height_cm: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Fetal Heart Rate (bpm)</label>
            <Input type="number" min="0" value={v.antenatal?.fetal_heart_rate} onChange={(e) => setAntenatal({ fetal_heart_rate: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Fetal Presentation</label>
            <Input placeholder="e.g. Cephalic" value={v.antenatal?.fetal_presentation} onChange={(e) => setAntenatal({ fetal_presentation: e.target.value })} className="mt-1" disabled={disabled} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-semibold text-muted-foreground">Antenatal Notes</label>
            <Textarea value={v.antenatal?.notes} onChange={(e) => setAntenatal({ notes: e.target.value })} rows={2} className="resize-none mt-1" disabled={disabled} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only summary — used wherever gynae info is shown but not edited (e.g. Visit Summary's non-editing view). */
export function GynaeFieldsReadOnly({ value }: { value: GynaeInfo }) {
  if (!hasGynaeInfo(value)) return null;
  const rows: [string, string | undefined][] = [
    ['Pregnancy Status', value.pregnancy_status],
    ['LMP', value.lmp],
    ['EDD', value.edd],
    ['Gravida', value.gravida],
    ['Para', value.para],
    ['Menstrual Cycle', value.menstrual_cycle],
    ['Presenting Symptoms', value.presenting_symptoms],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="border rounded-lg p-3 bg-pink-50/40 border-pink-200 space-y-2">
      <p className="text-xs font-semibold text-pink-800 uppercase">Gynecology / Obstetric</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {rows.map(([label, val]) => (
          <div key={label}>
            <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
            <p>{val}</p>
          </div>
        ))}
      </div>
      {value.antenatal_enabled && value.antenatal && Object.values(value.antenatal).some((v) => v) && (
        <div className="pt-2 border-t border-pink-200/70">
          <p className="text-[10px] text-muted-foreground uppercase mb-1">Antenatal</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {value.antenatal.gestational_age_weeks && <div><p className="text-[10px] text-muted-foreground">Gestational Age</p><p>{value.antenatal.gestational_age_weeks} weeks</p></div>}
            {value.antenatal.fundal_height_cm && <div><p className="text-[10px] text-muted-foreground">Fundal Height</p><p>{value.antenatal.fundal_height_cm} cm</p></div>}
            {value.antenatal.fetal_heart_rate && <div><p className="text-[10px] text-muted-foreground">Fetal Heart Rate</p><p>{value.antenatal.fetal_heart_rate} bpm</p></div>}
            {value.antenatal.fetal_presentation && <div><p className="text-[10px] text-muted-foreground">Presentation</p><p>{value.antenatal.fetal_presentation}</p></div>}
            {value.antenatal.notes && <div className="col-span-2"><p className="text-[10px] text-muted-foreground">Notes</p><p>{value.antenatal.notes}</p></div>}
          </div>
        </div>
      )}
    </div>
  );
}

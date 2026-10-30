import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Suggested parts per exam family, matched on the exam's catalog name. The
// doctor can tick several (Abdomen + Pelvis for "both") or type anything else,
// so the list only needs to cover the common requests, not every possibility.
const PART_SETS: Array<{ match: RegExp; parts: string[] }> = [
  { match: /\bct\b|computed tomograph/i, parts: ['Head / Brain', 'Neck', 'Chest', 'Abdomen', 'Pelvis', 'Spine'] },
  { match: /mri|magnetic resonance/i, parts: ['Brain', 'Spine', 'Knee', 'Shoulder', 'Abdomen', 'Pelvis'] },
  { match: /ultra\s*-?sound|usg|sono|doppler|echo/i, parts: ['Abdomen', 'Pelvis', 'Obstetric', 'Breast', 'Thyroid / Neck', 'Scrotum', 'Kidneys (KUB)', 'Soft tissue'] },
  { match: /x\s*-?ray|radiograph/i, parts: ['Chest', 'Abdomen', 'Skull', 'Cervical spine', 'Lumbar spine', 'Pelvis', 'Upper limb', 'Lower limb'] },
];
const DEFAULT_PARTS = ['Head', 'Neck', 'Chest', 'Abdomen', 'Pelvis', 'Spine', 'Upper limb', 'Lower limb'];

export function bodyPartOptions(examName: string): string[] {
  return PART_SETS.find(set => set.match.test(examName || ''))?.parts ?? DEFAULT_PARTS;
}

const splitParts = (value: string) => value.split(',').map(p => p.trim()).filter(Boolean);

/**
 * Which part/region a radiology exam is for, stored as plain text
 * ("Abdomen, Pelvis") on the request so the radiologist sees it as written.
 */
export function RadiologyBodyPartPicker({ examName, value, onChange }: { examName: string; value: string; onChange: (value: string) => void }) {
  const options = bodyPartOptions(examName);
  const initial = splitParts(value);
  const [chosen, setChosen] = useState<string[]>(options.filter(o => initial.includes(o)));
  const [other, setOther] = useState(initial.filter(p => !options.includes(p)).join(', '));

  const emit = (nextChosen: string[], nextOther: string) => {
    setChosen(nextChosen);
    setOther(nextOther);
    onChange([...options.filter(o => nextChosen.includes(o)), ...splitParts(nextOther)].join(', '));
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Part / region <span className="opacity-70">— pick one or more</span></p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(part => {
          const active = chosen.includes(part);
          return (
            <button
              key={part}
              type="button"
              aria-pressed={active}
              onClick={() => emit(active ? chosen.filter(p => p !== part) : [...chosen, part], other)}
              className={cn(
                'px-2 py-0.5 rounded-full border text-xs transition-colors',
                active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground hover:bg-muted'
              )}
            >
              {part}
            </button>
          );
        })}
      </div>
      <Input
        value={other}
        onChange={e => emit(chosen, e.target.value)}
        placeholder="Other (e.g. left knee, right hand)"
        className="h-8 text-xs"
      />
    </div>
  );
}

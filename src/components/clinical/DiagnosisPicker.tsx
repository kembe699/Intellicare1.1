import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { Loader2, Plus, Star, X, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface VisitDiagnosis {
  id: string;
  icd_code: string | null;
  icd_source: string | null;
  icd_version: string | null;
  description: string;
  is_primary: boolean;
  source: 'icd' | 'custom';
  custom_diagnosis_id: string | null;
}

interface Icd10Result {
  code: string;
  code_nodot: string;
  description: string;
  category_code: string;
  chapter: string | null;
  block: string | null;
  is_billable: boolean;
  is_priority: boolean;
  usage_count?: number;
}

interface ClinicalDiagnosis { id: string; diagnosis_text: string; icd_code: string | null; }

interface DiagnosisPickerProps {
  orderId: string;
  /** Read-only once the visit is closed — same rule as everywhere else in the Visit Summary. */
  readOnly?: boolean;
  /** clinical_notes is updated server-side on every add — call this so the parent refreshes it. */
  onNotesUpdated?: () => void;
  className?: string;
}

/**
 * The visit's diagnosis list + "add diagnosis" combobox: ICD-10 coded by
 * default, with the existing free-text "custom" path always available as
 * the last option for anything not found. Self-contained — fetches and
 * mutates its own list via /api/lis/orders/:id/diagnoses, so any screen
 * that has an order id can drop this in (Visit Summary today; Request
 * Admission is a documented follow-up, not wired up here yet).
 */
export function DiagnosisPicker({ orderId, readOnly, onNotesUpdated, className }: DiagnosisPickerProps) {
  const [diagnoses, setDiagnoses] = useState<VisitDiagnosis[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [icdResults, setIcdResults] = useState<Icd10Result[]>([]);
  const [priorityList, setPriorityList] = useState<Icd10Result[]>([]);
  const [recentList, setRecentList] = useState<Icd10Result[]>([]);
  const [customList, setCustomList] = useState<ClinicalDiagnosis[]>([]);
  const [codeVersion, setCodeVersion] = useState<{ source: string; version: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDiagnoses = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await authFetch(`/api/lis/orders/${orderId}/diagnoses`, { credentials: 'include' });
      if (res.ok) setDiagnoses(await res.json());
    } catch {
      // Left as an empty list — the "Add Diagnosis" control still works.
    } finally {
      setLoadingList(false);
    }
  }, [orderId]);

  useEffect(() => { fetchDiagnoses(); }, [fetchDiagnoses]);

  useEffect(() => {
    if (!open) return;
    authFetch('/api/clinical-diagnoses', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : []))
      .then(setCustomList)
      .catch(() => {});
    Promise.all([
      authFetch('/api/icd10/priority', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
      authFetch('/api/icd10/recent?limit=10', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([pri, rec]) => {
      if (pri) { setPriorityList(pri.results); setCodeVersion({ source: pri.source, version: pri.version }); }
      if (rec) setRecentList(rec.results);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setIcdResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/icd10/search?q=${encodeURIComponent(q)}&limit=30`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setIcdResults(data.results);
          setCodeVersion({ source: data.source, version: data.version });
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const alreadyHasCode = (code: string) => diagnoses.some((d) => d.source === 'icd' && d.icd_code === code);
  const alreadyHasCustomText = (text: string) => diagnoses.some((d) => d.source === 'custom' && d.description.toLowerCase() === text.toLowerCase());

  const postDiagnosis = async (body: Record<string, any>) => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/lis/orders/${orderId}/diagnoses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchDiagnoses();
        onNotesUpdated?.();
        setOpen(false);
        setQuery('');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add diagnosis');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const addIcdResult = (r: Icd10Result) => {
    if (alreadyHasCode(r.code)) { toast.error(`${r.code} is already recorded for this visit`); return; }
    postDiagnosis({ icd_code: r.code, icd_source: codeVersion?.source, icd_version: codeVersion?.version, description: r.description });
  };

  const addCustomExisting = (c: ClinicalDiagnosis) => {
    if (alreadyHasCustomText(c.diagnosis_text)) { toast.error(`"${c.diagnosis_text}" is already recorded for this visit`); return; }
    postDiagnosis({ description: c.diagnosis_text, custom_diagnosis_id: c.id });
  };

  const addCustomNew = async () => {
    const text = query.trim();
    if (!text) return;
    if (alreadyHasCustomText(text)) { toast.error(`"${text}" is already recorded for this visit`); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/clinical-diagnoses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ diagnosis_text: text }),
      });
      if (!res.ok) { toast.error('Failed to add diagnosis'); return; }
      const created = await res.json();
      await postDiagnosis({ description: created.diagnosis_text, custom_diagnosis_id: created.id });
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  const setPrimary = async (diagId: string) => {
    const res = await authFetch(`/api/lis/orders/${orderId}/diagnoses/${diagId}/primary`, { method: 'PUT', credentials: 'include' });
    if (res.ok) fetchDiagnoses();
    else toast.error('Failed to set primary diagnosis');
  };

  const removeDiagnosis = async (diagId: string) => {
    const res = await authFetch(`/api/lis/orders/${orderId}/diagnoses/${diagId}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { fetchDiagnoses(); onNotesUpdated?.(); }
    else toast.error('Failed to remove diagnosis');
  };

  const filteredCustom = customList.filter((c) => !query.trim() || c.diagnosis_text.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className={cn('space-y-2.5', className)}>
      {!loadingList && diagnoses.length > 0 && (
        <div className="space-y-1.5">
          {diagnoses.map((d) => (
            <div key={d.id} className="flex items-center gap-2 border rounded-md px-2.5 py-1.5 bg-card">
              {d.source === 'icd' && d.icd_code ? (
                <Badge variant="info" className="font-mono shrink-0">{d.icd_code}</Badge>
              ) : (
                <Badge variant="neutral" className="shrink-0">Not coded</Badge>
              )}
              <span className="text-sm flex-1 truncate">{d.description}</span>
              {d.is_primary ? (
                <span title="Primary diagnosis"><Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" /></span>
              ) : !readOnly ? (
                <button type="button" title="Make primary" onClick={() => setPrimary(d.id)} className="shrink-0">
                  <Star className="w-3.5 h-3.5 text-muted-foreground hover:text-amber-500 shrink-0" />
                </button>
              ) : null}
              {!readOnly && (
                <button type="button" title="Remove" onClick={() => removeDiagnosis(d.id)} className="shrink-0">
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between font-normal" disabled={saving}>
              <span className="flex items-center gap-1.5 text-muted-foreground"><Plus className="w-3.5 h-3.5" /> Add diagnosis...</span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[380px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Search ICD-10 or type a diagnosis..." value={query} onValueChange={setQuery} />
              <CommandList>
                {searching && (
                  <div className="py-3 flex items-center justify-center text-xs text-muted-foreground gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching...
                  </div>
                )}

                {!query.trim() && !searching && (
                  <>
                    {priorityList.length > 0 && (
                      <CommandGroup heading="Common in South Sudan">
                        {priorityList.map((r) => (
                          <CommandItem key={r.code} value={r.code} onSelect={() => addIcdResult(r)}>
                            <IcdResultRow r={r} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {recentList.length > 0 && (
                      <CommandGroup heading="Recently used here">
                        {recentList.map((r) => (
                          <CommandItem key={`recent-${r.code}`} value={`recent-${r.code}`} onSelect={() => addIcdResult(r)}>
                            <IcdResultRow r={r} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {customList.length > 0 && (
                      <CommandGroup heading="Custom diagnoses">
                        {customList.slice(0, 15).map((c) => (
                          <CommandItem key={c.id} value={c.diagnosis_text} onSelect={() => addCustomExisting(c)}>
                            <Badge variant="neutral" className="mr-2 shrink-0">Not coded</Badge>
                            {c.diagnosis_text}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {priorityList.length === 0 && recentList.length === 0 && customList.length === 0 && (
                      <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Start typing to search ICD-10...</CommandEmpty>
                    )}
                  </>
                )}

                {query.trim() && !searching && (
                  <>
                    {icdResults.length > 0 && (
                      <CommandGroup heading="ICD-10">
                        {icdResults.map((r) => (
                          <CommandItem key={r.code} value={r.code} onSelect={() => addIcdResult(r)}>
                            <IcdResultRow r={r} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {filteredCustom.length > 0 && (
                      <CommandGroup heading="Custom (not coded)">
                        {filteredCustom.slice(0, 10).map((c) => (
                          <CommandItem key={c.id} value={`custom-${c.diagnosis_text}`} onSelect={() => addCustomExisting(c)}>
                            <Badge variant="neutral" className="mr-2 shrink-0">Not coded</Badge>
                            {c.diagnosis_text}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {icdResults.length === 0 && filteredCustom.length === 0 && (
                      <CommandEmpty className="py-3 px-4 text-sm text-center text-muted-foreground">No matches found.</CommandEmpty>
                    )}
                    <CommandGroup>
                      <CommandItem value={`add-custom-${query}`} onSelect={addCustomNew} className="text-primary">
                        {saving ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
                        Add "{query.trim()}" as a custom diagnosis (not coded)
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
              {codeVersion && (
                <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground text-center">
                  {codeVersion.source} {codeVersion.version}
                </div>
              )}
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function IcdResultRow({ r }: { r: Icd10Result }) {
  return (
    <div className="flex flex-col min-w-0 py-0.5">
      <span className="text-sm truncate">
        <span className="font-mono font-medium">{r.code}</span> · {r.description}
      </span>
      {r.chapter && <span className="text-[11px] text-muted-foreground truncate">{r.chapter}</span>}
    </div>
  );
}

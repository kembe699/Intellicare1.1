import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { Stethoscope, Loader2, ChevronsUpDown, Check } from 'lucide-react';

interface UncodedDiagnosis {
  id: string;
  diagnosis_text: string;
  usage_count: number;
}

interface Icd10Result {
  code: string;
  description: string;
  chapter: string | null;
}

/**
 * Admin screen for mapping the free-text diagnosis catalog (clinical_diagnoses)
 * onto real ICD-10 codes, ranked by how often each entry is actually used so
 * the highest-value ones surface first. Coding one going forward doesn't
 * silently rewrite history — applying the mapping to past visits is a
 * separate, explicit, audited choice per row.
 */
export default function UncodedDiagnoses() {
  const [rows, setRows] = useState<UncodedDiagnosis[]>([]);
  const [loading, setLoading] = useState(true);
  const [mappingRow, setMappingRow] = useState<UncodedDiagnosis | null>(null);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/clinical-diagnoses/uncoded', { credentials: 'include' });
      if (res.ok) setRows(await res.json());
      else toast.error('Failed to load uncoded diagnoses');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); }, []);

  const columns: Column<UncodedDiagnosis>[] = [
    { key: 'diagnosis_text', header: 'Diagnosis', sortable: true, filterable: true },
    { key: 'usage_count', header: 'Times used', sortable: true, align: 'right', width: '120px' },
    {
      key: 'actions', header: '', align: 'right', width: '140px',
      render: (_v, row) => (
        <Button size="sm" variant="outline" onClick={() => setMappingRow(row)}>Map to ICD-10</Button>
      ),
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-5">
        <PageHeader title="Uncoded Diagnoses" icon={<Stethoscope />} subtitle="Map free-text diagnoses to ICD-10 codes" />
        <AdvancedDataTable
          data={rows}
          columns={columns}
          loading={loading}
          loadingMessage="Loading uncoded diagnoses..."
          emptyMessage="Every diagnosis in the catalog is already coded."
          searchable
          searchPlaceholder="Search diagnoses..."
          pagination={{ enabled: true, pageSize: 25 }}
          keyExtractor={(r) => r.id}
        />
      </div>

      {mappingRow && (
        <MapDiagnosisDialog
          diagnosis={mappingRow}
          onClose={() => setMappingRow(null)}
          onMapped={() => { setMappingRow(null); fetchRows(); }}
        />
      )}
    </AppLayout>
  );
}

function MapDiagnosisDialog({ diagnosis, onClose, onMapped }: {
  diagnosis: UncodedDiagnosis; onClose: () => void; onMapped: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(diagnosis.diagnosis_text);
  const [results, setResults] = useState<Icd10Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Icd10Result | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/icd10/search?q=${encodeURIComponent(q)}&limit=20`, { credentials: 'include' });
        if (res.ok) setResults((await res.json()).results);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const handleSave = async () => {
    if (!selected) { toast.error('Pick an ICD-10 code first'); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/clinical-diagnoses/${diagnosis.id}/map`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ icd_code: selected.code, icd_description: selected.description, apply_to_existing: applyToExisting }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(applyToExisting && data.updated_visits > 0
          ? `Mapped to ${selected.code} — updated ${data.updated_visits} past visit(s)`
          : `Mapped to ${selected.code}`);
        onMapped();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to map diagnosis');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Map "{diagnosis.diagnosis_text}" to ICD-10</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between font-normal">
                {selected ? <span><span className="font-mono font-medium">{selected.code}</span> · {selected.description}</span> : <span className="text-muted-foreground">Search ICD-10...</span>}
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[440px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput placeholder="Search ICD-10..." value={query} onValueChange={setQuery} />
                <CommandList>
                  {searching && <div className="py-3 flex items-center justify-center text-xs text-muted-foreground gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching...</div>}
                  {!searching && results.length === 0 && <CommandEmpty className="py-3 text-center text-sm text-muted-foreground">No matches found.</CommandEmpty>}
                  <CommandGroup>
                    {results.map((r) => (
                      <CommandItem key={r.code} value={r.code} onSelect={() => { setSelected(r); setOpen(false); }}>
                        <Check className={selected?.code === r.code ? 'mr-2 h-4 w-4 opacity-100' : 'mr-2 h-4 w-4 opacity-0'} />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate"><span className="font-mono font-medium">{r.code}</span> · {r.description}</span>
                          {r.chapter && <span className="text-xs text-muted-foreground truncate">{r.chapter}</span>}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={applyToExisting} onCheckedChange={(v) => setApplyToExisting(!!v)} className="mt-0.5" />
            <span>
              Also apply this code to past visits that used "{diagnosis.diagnosis_text}" ({diagnosis.usage_count} visit{diagnosis.usage_count === 1 ? '' : 's'})
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !selected}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Save Mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

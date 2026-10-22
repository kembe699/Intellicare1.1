import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/api/apiClient';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Icd10Result {
  code: string;
  description: string;
  chapter: string | null;
}

interface DiagnosisAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * A single free-text diagnosis field with a live ICD-10 lookup dropdown
 * layered on top. Typing always updates `value` on every keystroke — manual
 * entry works exactly like a plain Input — and once 2+ characters are
 * typed, a dropdown of matching real ICD-10-CM codes (via /api/icd10/search,
 * the same catalog DiagnosisPicker.tsx already uses for the LIS visit
 * summary) appears below it; picking a result replaces the field's text
 * with "<code> - <description>". Unlike DiagnosisPicker, this binds
 * directly to one flat string (no multi-entry list, no persistence of its
 * own) — for pages like Theatre Requests with a single `diagnosis` column
 * rather than a diagnoses table.
 */
export function DiagnosisAutocomplete({ value, onChange, placeholder, className }: DiagnosisAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Icd10Result[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/icd10/search?q=${encodeURIComponent(q)}&limit=15`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const pick = (r: Icd10Result) => {
    onChange(`${r.code} - ${r.description}`);
    setResults([]);
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || 'Type a diagnosis, or search ICD-10...'}
      />
      {open && value.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-card shadow-md">
          {searching ? (
            <div className="py-3 flex items-center justify-center text-xs text-muted-foreground gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching ICD-10...
            </div>
          ) : results.length > 0 ? (
            results.map((r) => (
              <button
                key={r.code}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0"
                onClick={() => pick(r)}
              >
                <span className="font-mono font-medium">{r.code}</span> · {r.description}
                {r.chapter && <div className="text-xs text-muted-foreground truncate">{r.chapter}</div>}
              </button>
            ))
          ) : (
            <div className="py-3 px-3 text-xs text-muted-foreground">No ICD-10 match — "{value}" will be kept as free text.</div>
          )}
        </div>
      )}
    </div>
  );
}

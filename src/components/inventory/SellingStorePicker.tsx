import { Store } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import type { SellingStore } from '@/hooks/useSellingStore';

/** "Selling from: [store]" — which store's items are listed and whose stock a sale takes. */
export function SellingStorePicker({ stores, value, onChange, className = '' }: {
  stores: SellingStore[]; value: string; onChange: (id: string) => void; className?: string;
}) {
  if (!stores.length) return null;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground whitespace-nowrap">
        <Store className="h-3.5 w-3.5" /> Selling from
      </span>
      <Combobox
        options={[{ value: 'all', label: 'All stores' }, ...stores.map((s) => ({ value: s.id, label: `${s.name}${s.is_default ? ' (default)' : ''}` }))]}
        value={value || 'all'}
        onChange={(v) => onChange(v === 'all' ? '' : v)}
        searchPlaceholder="Search stores..."
        className="h-8 min-w-[11rem] text-sm"
      />
    </div>
  );
}

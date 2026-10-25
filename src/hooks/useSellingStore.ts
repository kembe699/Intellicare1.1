import { useEffect, useState } from 'react';
import { authFetch } from '@/api/apiClient';

export interface SellingStore { id: string; name: string; type?: string; location_code?: string; is_default?: boolean }

/**
 * The store products are sold / prescribed / dispensed from on this screen.
 * Starts on the default selling store (Inventory › Storage Locations ›
 * "Set as default selling store"); the person can switch it for this screen.
 * '' = no store chosen (no default set) — every item is listed, as before.
 */
export function useSellingStore() {
  const [stores, setStores] = useState<SellingStore[]>([]);
  const [storeId, setStoreId] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    authFetch('/api/inventory/selling-stores')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: SellingStore[]) => {
        if (!alive) return;
        const rows = Array.isArray(list) ? list : [];
        setStores(rows);
        setStoreId((prev) => prev || rows.find((s) => s.is_default)?.id || '');
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, []);

  const store = stores.find((s) => s.id === storeId) || null;
  return { stores, storeId, setStoreId, store, loaded };
}

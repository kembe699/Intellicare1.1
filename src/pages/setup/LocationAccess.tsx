import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { useConfirm } from '@/hooks/useConfirm';
import { MapPinned, Trash2, Loader2, Plus } from 'lucide-react';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';

interface UserOption { id: string; displayName: string; email: string; }
interface StockLocation { id: string; location_name: string; }

interface Grant {
  id: string;
  user_id: string;
  location_id: string;
  user_name: string;
  user_email: string;
  location_name: string;
  can_request: boolean;
  can_fulfill: boolean;
}

// Who may request items to be pulled into a given store ("can_request"), and
// who may approve + release stock from it when it's the source of someone
// else's request ("can_fulfill") — see utils/locationAccess.js. An admin
// always passes both checks regardless of what's granted here.
const LocationAccess: React.FC = () => {
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [canRequest, setCanRequest] = useState(true);
  const [canFulfill, setCanFulfill] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, locsRes, grantsRes] = await Promise.all([
        authFetch('/api/users?all=true', { credentials: 'include' }),
        authFetch('/api/stock-transfers/locations', { credentials: 'include' }),
        authFetch('/api/stock-transfers/location-access/all', { credentials: 'include' }),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.map((u: any) => ({ id: String(u.id), displayName: u.display_name || u.displayName || '', email: u.email || '' }))
          .sort((a: UserOption, b: UserOption) => a.displayName.localeCompare(b.displayName)));
      }
      if (locsRes.ok) setLocations(await locsRes.json());
      if (grantsRes.ok) setGrants(await grantsRes.json());
    } catch (e) {
      console.error(e);
      toast.error('Failed to load store access grants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const grantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !selectedLocationId) {
      toast.error('Pick a user and a store');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/stock-transfers/location-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ user_id: selectedUserId, location_id: selectedLocationId, can_request: canRequest, can_fulfill: canFulfill }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to grant access');
      toast.success('Store access granted');
      setSelectedUserId(''); setSelectedLocationId(''); setCanRequest(true); setCanFulfill(false);
      load();
    } catch (error: any) {
      toast.error(error.message || 'Failed to grant access');
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = async (grant: Grant, field: 'can_request' | 'can_fulfill') => {
    try {
      const res = await authFetch(`/api/stock-transfers/location-access/${grant.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          can_request: field === 'can_request' ? !grant.can_request : grant.can_request,
          can_fulfill: field === 'can_fulfill' ? !grant.can_fulfill : grant.can_fulfill,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      load();
    } catch {
      toast.error('Failed to update grant');
    }
  };

  const revoke = async (grant: Grant) => {
    const ok = await confirm({
      title: `Revoke ${grant.user_name}'s access?`,
      description: `They'll no longer be able to request or fulfil stock transfers for ${grant.location_name}.`,
      confirmLabel: 'Revoke access',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch(`/api/stock-transfers/location-access/${grant.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to revoke');
      toast.success('Access revoked');
      load();
    } catch {
      toast.error('Failed to revoke access');
    }
  };

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
        <div className="max-w-[1400px] mx-auto w-full">
          <PageHeader title="Store Access" icon={<MapPinned />} className="mb-3" />
          <p className="text-sm text-muted-foreground -mt-2 mb-3">
            Grant a specific user the right to requisition on behalf of a store (so they can create stock transfer
            requests to it) and/or to fulfill requests drawn from it (approve + release its stock to another store).
          </p>

          <form onSubmit={grantAccess} className="bg-card rounded-lg border shadow-sm p-4 mb-6 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">User</Label>
              <Combobox
                options={users.map(u => ({ value: u.id, label: `${u.displayName} — ${u.email}` }))}
                value={selectedUserId}
                onChange={setSelectedUserId}
                placeholder="Select user"
                searchPlaceholder="Search users..."
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Store</Label>
              <Combobox
                options={locations.map(l => ({ value: l.id, label: l.location_name }))}
                value={selectedLocationId}
                onChange={setSelectedLocationId}
                placeholder="Select store"
                searchPlaceholder="Search stores..."
                className="mt-1 h-9"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" className="rounded" checked={canRequest} onChange={e => setCanRequest(e.target.checked)} />
              Can request
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" className="rounded" checked={canFulfill} onChange={e => setCanFulfill(e.target.checked)} />
              Can fulfill / receive
            </label>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Grant Access
            </Button>
          </form>

          <AdvancedDataTable<Grant>
            data={grants}
            loading={loading}
            loadingMessage="Loading store access grants..."
            emptyMessage="No store access has been granted yet."
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Search..."
            pagination={{ enabled: true, pageSize: 10, pageSizeOptions: [10, 20, 50] }}
            columns={[
              { key: 'user_name', header: 'User', render: (v, row) => <div><p className="font-medium">{v}</p><p className="text-xs text-muted-foreground">{row.user_email}</p></div> },
              { key: 'location_name', header: 'Store', sortable: true },
              {
                key: 'can_request', header: 'Can Request', align: 'center',
                render: (v, row) => (
                  <button onClick={(e) => { e.stopPropagation(); toggleFlag(row, 'can_request'); }} className={`relative w-9 h-5 rounded-full transition-colors ${v ? 'bg-primary' : 'bg-muted'}`}>
                    <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform ${v ? 'translate-x-4' : ''}`} />
                  </button>
                ),
              },
              {
                key: 'can_fulfill', header: 'Can Fulfill / Receive', align: 'center',
                render: (v, row) => (
                  <button onClick={(e) => { e.stopPropagation(); toggleFlag(row, 'can_fulfill'); }} className={`relative w-9 h-5 rounded-full transition-colors ${v ? 'bg-primary' : 'bg-muted'}`}>
                    <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform ${v ? 'translate-x-4' : ''}`} />
                  </button>
                ),
              },
              {
                key: 'id', header: 'Actions', align: 'center',
                render: (_v, row) => (
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); revoke(row); }}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </div>
    </AppLayout>
  );
};

export default LocationAccess;

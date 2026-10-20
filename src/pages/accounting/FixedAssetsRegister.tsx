import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingState } from '@/components/common';
import { AdvancedDataTable, Column } from '@/components/common/DataTable/AdvancedDataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from '@/lib/notify';
import { Asset, NATURE_BADGE, NATURE_LABEL, fmt } from './fixedAssetsShared';

export default function FixedAssetsRegister() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/fixed-assets?status=${statusFilter}${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ''}`, { credentials: 'include' });
      if (res.ok) setAssets(await res.json());
    } catch {
      toast.error('Failed to load fixed assets');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const columns: Column<Asset>[] = [
    { key: 'asset_code', header: 'Code', sortable: true, width: '120px' },
    { key: 'name', header: 'Name', sortable: true, filterable: true },
    { key: 'category_name', header: 'Category', sortable: true },
    {
      key: 'nature', header: 'Nature', width: '130px',
      render: (v) => <Badge variant={NATURE_BADGE[v] || 'neutral'}>{NATURE_LABEL[v] || v}</Badge>,
    },
    { key: 'location', header: 'Location', render: (v) => v || '—' },
    {
      key: 'assignee_first_name', header: 'Assigned To',
      render: (_v, row) => (row.assignee_first_name ? `${row.assignee_first_name} ${row.assignee_last_name || ''}` : '—'),
    },
    {
      key: 'acquisition_cost', header: 'Cost', align: 'right',
      render: (v, row) => fmt(row.acquisition_cost_original ?? v) + (row.acquisition_currency ? ` ${row.acquisition_currency}` : ''),
    },
    { key: 'current_value', header: 'Book Value', align: 'right', render: (v) => fmt(v) },
    {
      key: 'status', header: 'Status', width: '110px',
      render: (v) => <Badge variant={v === 'active' ? 'success' : v === 'disposed' ? 'danger' : 'neutral'}>{v}</Badge>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
            <Combobox
              options={[{ value: 'active', label: 'Active' }, { value: 'under_maintenance', label: 'Under maintenance' }, { value: 'disposed', label: 'Disposed' }, { value: 'written_off', label: 'Written off' }, { value: '', label: 'All' }]}
              value={statusFilter}
              onChange={setStatusFilter}
              searchPlaceholder="Search status..."
              className="h-9"
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Search</label>
            <Input placeholder="Name, code, serial, location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-9" />
          </div>
        </CardContent>
      </Card>

      {loading ? <LoadingState message="Loading assets..." /> : (
        <AdvancedDataTable
          data={assets}
          columns={columns}
          onRowClick={(row) => navigate(`/accounting/fixed-assets/register/${row.id}`)}
          emptyMessage="No assets recorded yet."
          pagination={{ enabled: true, pageSize: 25 }}
          keyExtractor={(r) => r.id}
          exportable
          exportFileName="fixed-assets-register"
        />
      )}
    </div>
  );
}

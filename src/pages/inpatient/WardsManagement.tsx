import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Plus, Edit2, Trash2, Building2, Users, BedDouble, DoorOpen, X, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Combobox } from '@/components/ui/combobox';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function WardsManagement() {
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const clinicId = user?.clinic || 1;
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingWard, setEditingWard] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', code: '', description: '', ward_type: 'general', capacity: '', service_id: '' });

  const { data: wards = [], isLoading } = useQuery({
    queryKey: ['wards', clinicId],
    queryFn: async () => {
      const res = await authFetch(`/api/inpatient/wards?clinic_id=${clinicId}`);
      if (!res.ok) throw new Error('Failed to load wards');
      return res.json();
    },
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services-for-wards'],
    queryFn: async () => {
      const res = await authFetch('/api/services');
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : []).filter((s: any) => s.isActive !== false);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = editingWard ? `/api/inpatient/wards/${editingWard.id}` : '/api/inpatient/wards';
      const method = editingWard ? 'PUT' : 'POST';
      const res = await authFetch(url, { method, body: JSON.stringify({ ...data, clinic_id: clinicId }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      return res.json();
    },
    onSuccess: () => {
      toast.success(editingWard ? 'Ward updated' : 'Ward created');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/inpatient/wards/${id}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed'); }
      return res.json();
    },
    onSuccess: () => { toast.success('Ward deleted'); queryClient.invalidateQueries({ queryKey: ['wards'] }); },
    onError: (err: any) => toast.error(err.message),
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingWard(null);
    setFormData({ name: '', code: '', description: '', ward_type: 'general', capacity: '', service_id: '' });
  };

  const handleEdit = (ward: any) => {
    setEditingWard(ward);
    setFormData({ name: ward.name, code: ward.code, description: ward.description || '', ward_type: ward.ward_type || 'general', capacity: String(ward.capacity || ''), service_id: ward.service_id || '' });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code) { toast.error('Name and code are required'); return; }
    saveMutation.mutate(formData);
  };

  const wardTypes = ['general', 'surgical', 'maternity', 'pediatric', 'icu', 'emergency', 'psychiatric', 'isolation'];

  return (
    <AppLayout>
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 max-w-6xl mx-auto w-full flex flex-col">
        <PageHeader
          icon={<BedDouble />}
          title="Wards Management"
          actions={
            <Button onClick={() => { resetForm(); setShowForm(true); }} className="gap-2">
              <Plus className="h-4 w-4" />Add Ward
            </Button>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="rounded-lg shadow-sm border-primary/30 bg-primary/10">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-primary">{wards.length}</p>
              <p className="text-xs text-muted-foreground">Total Wards</p>
            </CardContent>
          </Card>
          <Card className="rounded-lg shadow-sm border-green-200/50 bg-green-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-700">{wards.reduce((s: number, w: any) => s + (w.total_beds || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Total Beds</p>
            </CardContent>
          </Card>
          <Card className="rounded-lg shadow-sm border-amber-200/50 bg-amber-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{wards.reduce((s: number, w: any) => s + (w.current_occupancy || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Occupied</p>
            </CardContent>
          </Card>
          <Card className="rounded-lg shadow-sm border-purple-200/50 bg-purple-50/30">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-700">{wards.reduce((s: number, w: any) => s + (w.total_rooms || 0), 0)}</p>
              <p className="text-xs text-muted-foreground">Total Rooms</p>
            </CardContent>
          </Card>
        </div>

        {/* Ward Form Modal */}
        <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto gap-0 p-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10">
                  <Building2 className="w-3.5 h-3.5 text-primary" />
                </div>
                {editingWard ? 'Edit Ward' : 'New Ward'}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Configure ward details and capacity
              </DialogDescription>
            </DialogHeader>

              <div className="px-5 py-4">
                <form id="ward-form" onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Ward Name *</Label>
                    <Input placeholder="e.g., General Medicine" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Ward Code *</Label>
                      <Input placeholder="e.g., GM-001" value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Capacity (Beds)</Label>
                      <Input type="number" placeholder="50" value={formData.capacity} onChange={e => setFormData({ ...formData, capacity: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Ward Type</Label>
                      <Combobox
                        options={wardTypes.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
                        value={formData.ward_type}
                        onChange={v => setFormData({ ...formData, ward_type: v })}
                        searchPlaceholder="Search..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Billing Service</Label>
                      <Combobox
                        options={services.map((s: any) => ({ value: s.id, label: `${s.name} — ${fmt(s.price)}` }))}
                        value={formData.service_id}
                        onChange={v => setFormData({ ...formData, service_id: v })}
                        placeholder="Select service..."
                        searchPlaceholder="Search services..."
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {formData.service_id
                          ? `Daily bed rate: ${fmt(services.find((s: any) => s.id === formData.service_id)?.price || 0)}`
                          : 'The daily bed rate is pulled from the selected service\'s price.'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Description</Label>
                    <Textarea placeholder="Ward description..." value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} />
                  </div>
                </form>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
                <Button type="submit" form="ward-form" disabled={saveMutation.isPending} className="gap-2">
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {editingWard ? 'Update' : 'Create'} Ward
                </Button>
              </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Wards List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : wards.length === 0 ? (
          <Card className="rounded-lg p-12 text-center border-dashed">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No wards configured yet</p>
            <p className="text-sm text-muted-foreground mt-1">Click "Add Ward" to create your first ward</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {wards.map((ward: any) => {
              const occupancyPct = ward.total_beds > 0 ? Math.round((ward.current_occupancy / ward.total_beds) * 100) : 0;
              return (
                <Card key={ward.id} className="rounded-lg shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-base font-semibold truncate">{ward.name}</h3>
                          <Badge variant="outline" className="text-xs font-mono">{ward.code}</Badge>
                          <Badge className="text-xs capitalize" variant="secondary">{ward.ward_type}</Badge>
                        </div>
                        {ward.description && <p className="text-sm text-muted-foreground mb-3">{ward.description}</p>}
                        <div className="flex items-center gap-6 text-sm">
                          <div className="flex items-center gap-1.5">
                            <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{ward.total_rooms || 0}</span>
                            <span className="text-muted-foreground">rooms</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <BedDouble className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{ward.total_beds || 0}</span>
                            <span className="text-muted-foreground">beds</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{ward.current_occupancy || 0}</span>
                            <span className="text-muted-foreground">occupied</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${occupancyPct > 80 ? 'bg-red-500' : occupancyPct > 50 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${occupancyPct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{occupancyPct}%</span>
                          </div>
                          {parseFloat(ward.daily_rate) > 0 && (
                            <Badge variant="outline" className="text-xs font-normal">
                              {ward.service_name ? `${ward.service_name} · ` : ''}{fmt(ward.daily_rate)}/day
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(ward)}><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { if (confirm('Delete this ward?')) deleteMutation.mutate(ward.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </AppLayout>
  );
}

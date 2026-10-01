import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@/components/common';
import { DoorOpen, BedDouble, Plus, Trash2, RefreshCw, Search, X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AdvancedDataTable } from '@/components/common/DataTable/AdvancedDataTable';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

const ROOM_TYPES = [
  { value: 'consultation', label: 'Consultation Room' },
  { value: 'ward', label: 'Ward' },
  { value: 'or', label: 'Operating Theatre (OR)' },
];
const ROOM_TYPE_LABEL: Record<string, string> = { ward: 'Ward', consultation: 'Consultation Room', or: 'Operating Theatre' };

const BED_STATUSES = ['available', 'occupied', 'maintenance', 'reserved'];

const bedStatusToneMap: Record<string, StatusBadgeTone> = {
  available: 'success',
  occupied: 'danger',
  maintenance: 'warning',
  reserved: 'primary',
};

const roomTypeToneMap: Record<string, StatusBadgeTone> = {
  ward: 'primary',
  consultation: 'info',
  or: 'success',
};

export default function RoomsManagement() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { user } = useAuth();
  const clinicId = user?.clinic || 1;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null);

  const [roomForm, setRoomForm] = useState({ ward_id: '', room_number: '', room_type: '', capacity: '' });
  const [pendingBeds, setPendingBeds] = useState<{ bed_number: string; status: string }[]>([]);
  const [bedDraft, setBedDraft] = useState({ bed_number: '', status: 'available' });
  const [registering, setRegistering] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const resetRoomForm = () => {
    setRoomForm({ ward_id: '', room_number: '', room_type: '', capacity: '' });
    setPendingBeds([]);
    setBedDraft({ bed_number: '', status: 'available' });
  };

  const { data: wards = [] } = useQuery({
    queryKey: ['wards', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/wards?clinic_id=${clinicId}`); return r.ok ? r.json() : []; },
  });

  const { data: rooms = [], isLoading: roomsLoading, refetch: refetchRooms } = useQuery({
    queryKey: ['rooms-all', clinicId],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/rooms?clinic_id=${clinicId}`); return r.ok ? r.json() : []; },
  });

  const { data: modalBeds = [] } = useQuery({
    queryKey: ['beds', selectedRoom?.id],
    queryFn: async () => { const r = await authFetch(`/api/inpatient/beds?clinic_id=${clinicId}&room_id=${selectedRoom.id}`); return r.ok ? r.json() : []; },
    enabled: !!selectedRoom,
  });

  const deleteRoomMutation = useMutation({
    mutationFn: async (id: string) => { const r = await authFetch(`/api/inpatient/rooms/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error('Failed'); return r.json(); },
    onSuccess: () => {
      toast.success('Room deleted');
      setSelectedRoom(null);
      queryClient.invalidateQueries({ queryKey: ['rooms-all'] });
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
    onError: () => toast.error('Failed to delete room'),
  });

  const addBedMutation = useMutation({
    mutationFn: async (data: { bed_number: string; status: string }) => {
      const r = await authFetch('/api/inpatient/beds', {
        method: 'POST',
        body: JSON.stringify({ ...data, room_id: selectedRoom.id, ward_id: selectedRoom.ward_id, clinic_id: clinicId }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); } return r.json();
    },
    onSuccess: () => {
      toast.success('Bed added');
      setBedDraft({ bed_number: '', status: 'available' });
      queryClient.invalidateQueries({ queryKey: ['beds', selectedRoom?.id] });
      queryClient.invalidateQueries({ queryKey: ['rooms-all'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to add bed'),
  });

  const deleteBedMutation = useMutation({
    mutationFn: async (id: string) => { const r = await authFetch(`/api/inpatient/beds/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error('Failed'); return r.json(); },
    onSuccess: () => {
      toast.success('Bed removed');
      queryClient.invalidateQueries({ queryKey: ['beds', selectedRoom?.id] });
      queryClient.invalidateQueries({ queryKey: ['rooms-all'] });
    },
    onError: () => toast.error('Failed to remove bed'),
  });

  const addPendingBed = () => {
    if (!bedDraft.bed_number.trim()) { toast.error('Bed number required'); return; }
    setPendingBeds([...pendingBeds, bedDraft]);
    setBedDraft({ bed_number: '', status: 'available' });
  };

  const removePendingBed = (index: number) => {
    setPendingBeds(pendingBeds.filter((_, i) => i !== index));
  };

  const handleRegisterRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registering) return;
    if (!roomForm.room_type) { toast.error('Please select a room type'); return; }
    if (roomForm.room_type === 'ward' && !roomForm.ward_id) { toast.error('Please select a ward'); return; }
    if (!roomForm.room_number.trim()) { toast.error('Room number required'); return; }

    setRegistering(true);
    try {
      const res = await authFetch('/api/inpatient/rooms', {
        method: 'POST',
        body: JSON.stringify({ ...roomForm, clinic_id: clinicId }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Failed to create room');
        return;
      }
      const newRoom = await res.json();

      if (roomForm.room_type === 'ward' && pendingBeds.length > 0) {
        const bedResults = await Promise.all(pendingBeds.map(bed =>
          authFetch('/api/inpatient/beds', {
            method: 'POST',
            body: JSON.stringify({ ...bed, room_id: newRoom.id, ward_id: roomForm.ward_id, clinic_id: clinicId }),
          }).then(r => r.ok).catch(() => false)
        ));
        const failedCount = bedResults.filter(ok => !ok).length;
        if (failedCount > 0) {
          // The room was already created — don't leave it silently orphaned
          // with a misleading "Network error" while some/all beds are
          // missing. Roll the room back so the form can be safely retried.
          await authFetch(`/api/inpatient/rooms/${newRoom.id}`, { method: 'DELETE' }).catch(() => {});
          toast.error(`${failedCount} of ${pendingBeds.length} bed(s) failed to register — room was rolled back, please retry`);
          queryClient.invalidateQueries({ queryKey: ['rooms-all'] });
          queryClient.invalidateQueries({ queryKey: ['wards'] });
          return;
        }
      }

      toast.success('Room registered successfully');
      resetRoomForm();
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['rooms-all'] });
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    } catch {
      toast.error('Network error');
    } finally {
      setRegistering(false);
    }
  };

  const filteredRooms = rooms.filter((r: any) =>
    r.room_number?.toLowerCase().includes(search.toLowerCase()) ||
    r.ward_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      {confirmDialog}
      <div className="-m-3 lg:-m-4 p-6 bg-primary/20 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="space-y-6 max-w-6xl mx-auto w-full flex flex-col">
        <PageHeader
          title="Rooms"
          icon={<DoorOpen />}
          actions={
            <Button onClick={() => { resetRoomForm(); setShowForm(true); }} className="gap-2">
              <Plus className="h-4 w-4" />Add Room
            </Button>
          }
        />

        {/* Search Bar and Actions */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by room or ward..."
              className="pl-9 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetchRooms()} disabled={roomsLoading}>
            <RefreshCw className={`w-4 h-4 ${roomsLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Room Directory */}
        <AdvancedDataTable<any>
          data={filteredRooms}
          keyExtractor={(room) => room.id}
          loading={roomsLoading}
          emptyMessage="No rooms found."
          onRowClick={(room) => setSelectedRoom(room)}
          pagination={{ enabled: true, pageSize: 20, pageSizeOptions: [20, 50, 100] }}
          columns={[
            { key: 'room_number', header: 'Room No.', sortable: true, render: (v) => <span className="font-mono text-primary font-medium">{v}</span> },
            { key: 'ward_name', header: 'Ward', sortable: true, render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
            {
              key: 'room_type', header: 'Type', sortable: true,
              render: (v) => <StatusBadge status={v} map={roomTypeToneMap} label={ROOM_TYPE_LABEL[v] || v} />,
            },
            { key: 'capacity', header: 'Capacity', render: (v) => <span className="text-muted-foreground">{v || '-'}</span> },
            {
              key: '__beds', header: 'Beds',
              render: (_v, room) => <span className="text-muted-foreground">{room.room_type === 'ward' ? `${room.current_occupancy || 0}/${room.total_beds || 0}` : '-'}</span>,
            },
          ]}
        />
      </div>
      </div>

      {/* Add Room Modal */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetRoomForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto gap-0 p-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-primary/10">
                <DoorOpen className="w-3.5 h-3.5 text-primary" />
              </div>
              Register New Room
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure the room and, for a ward room, its beds
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-4">
            <form id="room-form" onSubmit={handleRegisterRoom} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Room Type</Label>
                <Combobox
                  options={ROOM_TYPES}
                  value={roomForm.room_type}
                  onChange={(room_type) => {
                    setRoomForm({ ...roomForm, room_type, ward_id: room_type === 'consultation' ? '' : roomForm.ward_id });
                    setPendingBeds([]);
                  }}
                  placeholder="Select type..."
                  searchPlaceholder="Search..."
                />
              </div>

              {roomForm.room_type === 'ward' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Ward</Label>
                  <Combobox
                    options={wards.map((w: any) => ({ value: String(w.id), label: `${w.name} (${w.code})` }))}
                    value={roomForm.ward_id}
                    onChange={(ward_id) => setRoomForm({ ...roomForm, ward_id })}
                    placeholder="Select ward..."
                    searchPlaceholder="Search wards..."
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Room Number</label>
                <Input
                  value={roomForm.room_number}
                  onChange={e => setRoomForm({ ...roomForm, room_number: e.target.value })}
                  placeholder="e.g. R-101"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Capacity</label>
                <Input
                  type="number"
                  min="0"
                  value={roomForm.capacity}
                  onChange={e => setRoomForm({ ...roomForm, capacity: e.target.value })}
                  placeholder="Optional"
                  className="mt-1"
                />
              </div>

              {roomForm.room_type === 'ward' && (
                <div className="p-3 bg-card rounded-md border border-dashed space-y-3">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <BedDouble className="w-3 h-3" /> Beds in this Ward Room
                  </label>

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        value={bedDraft.bed_number}
                        onChange={e => setBedDraft({ ...bedDraft, bed_number: e.target.value })}
                        placeholder="Bed No. (e.g. B-01)"
                        className="h-9"
                      />
                    </div>
                    <Combobox
                      options={BED_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                      value={bedDraft.status}
                      onChange={(status) => setBedDraft({ ...bedDraft, status })}
                      searchPlaceholder="Search..."
                      className="w-32"
                    />
                    <Button type="button" size="sm" variant="outline" className="h-9" onClick={addPendingBed}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {pendingBeds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pendingBeds.map((bed, i) => (
                        <StatusBadge
                          key={i}
                          status={bed.status}
                          map={bedStatusToneMap}
                          className="rounded-full"
                          label={
                            <>
                              {bed.bed_number}
                              <X className="w-2.5 h-2.5 cursor-pointer opacity-60 hover:opacity-100" onClick={() => removePendingBed(i)} />
                            </>
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>

          <DialogFooter className="px-5 py-4 border-t">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetRoomForm(); }} disabled={registering}>
              Cancel
            </Button>
            <Button type="submit" form="room-form" disabled={registering}>
              {registering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Register Room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Room Details Modal */}
      <Dialog open={!!selectedRoom} onOpenChange={(open) => { if (!open) setSelectedRoom(null); }}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto gap-0 p-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
              <DoorOpen className="w-3.5 h-3.5 text-primary" />
              Room Details
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              View room information and manage beds
            </DialogDescription>
          </DialogHeader>

          {selectedRoom && (
            <div className="px-6 py-5">
              <div className="grid grid-cols-2 gap-y-5 gap-x-8 text-[13px]">
                <div>
                  <span className="text-muted-foreground block text-[11px] uppercase tracking-wide mb-1.5">Room No.</span>
                  <span className="font-mono font-medium text-primary text-sm">{selectedRoom.room_number}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px] uppercase tracking-wide mb-1.5">Ward</span>
                  <span className="font-medium text-sm">{selectedRoom.ward_name || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px] uppercase tracking-wide mb-1.5">Type</span>
                  <span>{ROOM_TYPE_LABEL[selectedRoom.room_type] || selectedRoom.room_type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px] uppercase tracking-wide mb-1.5">Capacity</span>
                  <span>{selectedRoom.capacity || '-'}</span>
                </div>
              </div>

              {selectedRoom.room_type === 'ward' && (
                <div className="mt-7">
                  <span className="text-muted-foreground block text-[11px] uppercase tracking-wide mb-3">Beds</span>

                  <div className="flex items-end gap-2 mb-4">
                    <div className="flex-1">
                      <Input
                        value={bedDraft.bed_number}
                        onChange={e => setBedDraft({ ...bedDraft, bed_number: e.target.value })}
                        placeholder="Bed No. (e.g. B-01)"
                        className="h-9"
                      />
                    </div>
                    <Combobox
                      options={BED_STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                      value={bedDraft.status}
                      onChange={(status) => setBedDraft({ ...bedDraft, status })}
                      searchPlaceholder="Search..."
                      className="w-32"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={addBedMutation.isPending}
                      onClick={() => {
                        if (addBedMutation.isPending) return;
                        if (!bedDraft.bed_number.trim()) { toast.error('Bed number required'); return; }
                        addBedMutation.mutate(bedDraft);
                      }}
                    >
                      {addBedMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </Button>
                  </div>

                  {modalBeds.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No beds in this room yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {modalBeds.map((bed: any) => (
                        <div key={bed.id} className="border rounded-lg p-3 text-center bg-card hover:shadow-sm transition-shadow">
                          <div className="flex items-start justify-between gap-1">
                            <p className="font-bold text-sm leading-tight">{bed.bed_number}</p>
                            {bed.status === 'available' && (
                              <button
                                type="button"
                                className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                                disabled={deleteBedMutation.isPending}
                                title="Remove bed"
                                onClick={async () => {
                                  if (deleteBedMutation.isPending) return;
                                  if (await confirm({ description: 'Remove this bed?', destructive: true })) deleteBedMutation.mutate(bed.id);
                                }}
                              >
                                {deleteBedMutation.isPending && deleteBedMutation.variables === bed.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                          <div className="mt-2 flex justify-center">
                            <StatusBadge status={bed.status} map={bedStatusToneMap} className="text-[10px] px-2 py-0.5" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              onClick={async () => {
                if (deleteRoomMutation.isPending) return;
                if (selectedRoom) { if (await confirm({ description: 'Delete this room?', destructive: true })) deleteRoomMutation.mutate(selectedRoom.id); }
              }}
              disabled={deleteRoomMutation.isPending}
            >
              {deleteRoomMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deleteRoomMutation.isPending ? 'Deleting...' : 'Delete Room'}
            </Button>
            <Button variant="outline" onClick={() => setSelectedRoom(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

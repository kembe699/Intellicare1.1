import React, { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, LoadingState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';
import { DoorOpen, Plus, Loader2 } from 'lucide-react';
import { TheatreRoom, ROOM_STATUS_BADGE } from './theatreShared';

export default function TheatreRooms() {
  const [rooms, setRooms] = useState<TheatreRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/theatre/rooms', { credentials: 'include' });
      if (res.ok) setRooms(await res.json());
    } catch {
      toast.error('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const res = await authFetch('/api/theatre/rooms', { method: 'POST', body: JSON.stringify({ name: name.trim(), notes: notes || null }) });
      if (res.ok) {
        toast.success('Room added');
        setName(''); setNotes(''); setAdding(false);
        fetchRooms();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add room');
      }
    } catch { toast.error('Network error'); } finally { setSaving(false); }
  };

  const handleStatusChange = async (room: TheatreRoom, status: string) => {
    setBusyId(room.id);
    try {
      const res = await authFetch(`/api/theatre/rooms/${room.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      if (res.ok) { toast.success('Room updated'); fetchRooms(); }
      else { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Failed to update room'); }
    } catch { toast.error('Network error'); } finally { setBusyId(null); }
  };

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PageHeader title="Theatre Rooms" icon={<DoorOpen />} subtitle="Manage the ORs available for scheduling" />
          <Button size="sm" className="gap-1.5" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> New Room
          </Button>
        </div>

        {adding && (
          <Card>
            <CardContent className="p-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[200px]">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OR 1" />
              </div>
              <div className="min-w-[220px] flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Notes (optional)</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <Button onClick={handleCreate} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Save</Button>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            </CardContent>
          </Card>
        )}

        {loading ? <LoadingState message="Loading rooms..." /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rooms.length === 0 && <p className="text-sm text-muted-foreground">No theatre rooms yet.</p>}
            {rooms.map((room) => (
              <Card key={room.id}>
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{room.name}</p>
                    <Badge variant={ROOM_STATUS_BADGE[room.status]}>{room.status.replace('_', ' ')}</Badge>
                  </div>
                  {room.notes && <p className="text-xs text-muted-foreground">{room.notes}</p>}
                  <Combobox
                    options={[
                      { value: 'available', label: 'Available' }, { value: 'in_use', label: 'In Use' },
                      { value: 'cleaning', label: 'Cleaning' }, { value: 'maintenance', label: 'Maintenance' },
                    ]}
                    value={room.status} onChange={(v) => handleStatusChange(room, v)} searchPlaceholder="Search..."
                    disabled={busyId === room.id}
                    className="h-8 text-xs"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

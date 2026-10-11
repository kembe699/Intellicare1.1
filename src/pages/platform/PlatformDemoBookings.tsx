import React, { useEffect, useState } from 'react';
import { platformFetch } from '@/api/platformApiClient';
import { PlatformAppLayout } from '@/components/layout/PlatformAppLayout';
import { PageHeader } from '@/components/common/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Loader2, CalendarCheck, Search, Settings as SettingsIcon, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface BookingRow {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  full_name: string;
  email: string;
  phone: string;
  job_title: string | null;
  facility_name: string;
  facility_type: string;
  location_city: string;
  staff_or_beds_range: string | null;
  demo_type: string;
  notes: string | null;
  status: 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  internal_notes: string | null;
}

interface SettingsRow {
  duration_minutes: number;
  working_days: number[];
  work_start_time: string;
  work_end_time: string;
  buffer_minutes: number;
  min_notice_hours: number;
  max_advance_days: number;
  timezone: string;
}

interface BlockedDateRow {
  id: number;
  blocked_date: string;
  reason: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'neutral' | 'danger' | 'warning'> = {
  confirmed: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PlatformDemoBookings: React.FC = () => {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<BookingRow | null>(null);
  const [internalNotesDraft, setInternalNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [blockedDates, setBlockedDates] = useState<BlockedDateRow[]>([]);
  const [newBlockedDate, setNewBlockedDate] = useState('');
  const [newBlockedReason, setNewBlockedReason] = useState('');

  const loadBookings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const res = await platformFetch(`/demo-bookings?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load bookings');
      setBookings(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await platformFetch('/demo-bookings/settings');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load settings');
      setSettings(data);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const loadBlockedDates = async () => {
    try {
      const res = await platformFetch('/demo-bookings/blocked-dates');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load blocked dates');
      setBlockedDates(data);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  useEffect(() => { loadBookings(); loadSettings(); loadBlockedDates(); }, []);
  useEffect(() => {
    const t = setTimeout(() => loadBookings(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, dateFrom, dateTo]);

  const updateStatus = async (booking: BookingRow, status: string) => {
    try {
      const res = await platformFetch(`/demo-bookings/${booking.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update booking');
      toast.success(status === 'cancelled' ? 'Booking cancelled — the slot is free again' : 'Booking updated');
      await loadBookings();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const openNotes = (booking: BookingRow) => {
    setSelected(booking);
    setInternalNotesDraft(booking.internal_notes || '');
  };

  const saveNotes = async () => {
    if (!selected) return;
    setSavingNotes(true);
    try {
      const res = await platformFetch(`/demo-bookings/${selected.id}`, { method: 'PUT', body: JSON.stringify({ internal_notes: internalNotesDraft }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save notes');
      toast.success('Internal notes saved');
      setSelected(null);
      await loadBookings();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingNotes(false);
    }
  };

  const toggleWorkingDay = (day: number) => {
    if (!settings) return;
    const has = settings.working_days.includes(day);
    const working_days = has ? settings.working_days.filter((d) => d !== day) : [...settings.working_days, day].sort();
    setSettings({ ...settings, working_days });
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await platformFetch('/demo-bookings/settings', { method: 'PUT', body: JSON.stringify(settings) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSettings(data);
      toast.success('Availability settings saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const addBlockedDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockedDate) return;
    try {
      const res = await platformFetch('/demo-bookings/blocked-dates', {
        method: 'POST',
        body: JSON.stringify({ blocked_date: newBlockedDate, reason: newBlockedReason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to block that date');
      setNewBlockedDate('');
      setNewBlockedReason('');
      await loadBlockedDates();
      toast.success('Date blocked');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const removeBlockedDate = async (id: number) => {
    try {
      const res = await platformFetch(`/demo-bookings/blocked-dates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove blocked date');
      await loadBlockedDates();
      toast.success('Date unblocked');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <PlatformAppLayout>
      <PageHeader
        icon={<CalendarCheck />}
        title="Demo Bookings"
        subtitle="Manage demo requests from the public Book a Demo page and control its availability"
      />

      <Tabs defaultValue="bookings">
        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="settings"><SettingsIcon className="w-3.5 h-3.5 mr-1.5" />Availability Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="mt-4">
          <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="p-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-2">
              <div className="relative max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search name, email, facility..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm w-56" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No-show</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-sm" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-sm" />
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Date / Time</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Demo Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell></TableRow>
                ) : bookings.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    <CalendarCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No bookings match these filters
                  </TableCell></TableRow>
                ) : bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium text-foreground whitespace-nowrap">
                      {b.booking_date}<br /><span className="text-xs text-muted-foreground">{b.start_time}–{b.end_time}</span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{b.facility_name}</div>
                      <div className="text-xs text-muted-foreground">{b.facility_type} • {b.location_city}</div>
                    </TableCell>
                    <TableCell>
                      <div>{b.full_name}</div>
                      <div className="text-xs text-muted-foreground">{b.email} • {b.phone}</div>
                    </TableCell>
                    <TableCell>{b.demo_type}</TableCell>
                    <TableCell>
                      <Select value={b.status} onValueChange={(v) => updateStatus(b, v)}>
                        <SelectTrigger className="h-7 w-32 text-xs border-0 shadow-none p-0">
                          <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="confirmed">Confirmed</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                          <SelectItem value="no_show">No-show</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openNotes(b)}>
                        Details{b.internal_notes ? ' •' : ''}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-6">
          {!settings ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-5 max-w-xl">
                <h3 className="font-semibold text-sm">Slot Rules</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Demo duration (minutes)</Label>
                    <Input type="number" min={5} value={settings.duration_minutes}
                      onChange={(e) => setSettings({ ...settings, duration_minutes: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Buffer between demos (minutes)</Label>
                    <Input type="number" min={0} value={settings.buffer_minutes}
                      onChange={(e) => setSettings({ ...settings, buffer_minutes: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Working hours start</Label>
                    <Input type="time" value={settings.work_start_time}
                      onChange={(e) => setSettings({ ...settings, work_start_time: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Working hours end</Label>
                    <Input type="time" value={settings.work_end_time}
                      onChange={(e) => setSettings({ ...settings, work_end_time: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Minimum notice (hours)</Label>
                    <Input type="number" min={0} value={settings.min_notice_hours}
                      onChange={(e) => setSettings({ ...settings, min_notice_hours: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Bookable how far ahead (days)</Label>
                    <Input type="number" min={1} value={settings.max_advance_days}
                      onChange={(e) => setSettings({ ...settings, max_advance_days: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Working days</Label>
                  <div className="flex flex-wrap gap-3">
                    {DAY_LABELS.map((label, idx) => (
                      <label key={idx} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={settings.working_days.includes(idx)} onCheckedChange={() => toggleWorkingDay(idx)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Times shown and booked are in {settings.timezone} (UTC+2).</p>
                <Button onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Settings'}
                </Button>
              </div>

              <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-4 max-w-xl">
                <h3 className="font-semibold text-sm">Blocked Dates / Holidays</h3>
                <form onSubmit={addBlockedDate} className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={newBlockedDate} onChange={(e) => setNewBlockedDate(e.target.value)} className="h-8 w-40" required />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <Label className="text-xs">Reason (optional)</Label>
                    <Input value={newBlockedReason} onChange={(e) => setNewBlockedReason(e.target.value)} className="h-8" placeholder="e.g. Public holiday" />
                  </div>
                  <Button type="submit" size="sm" className="h-8"><Plus className="w-3.5 h-3.5 mr-1" />Block</Button>
                </form>
                {blockedDates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No blocked dates yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {blockedDates.map((bd) => (
                      <li key={bd.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-sm bg-muted/30">
                        <span><span className="font-medium">{bd.blocked_date}</span>{bd.reason ? ` — ${bd.reason}` : ''}</span>
                        <button onClick={() => removeBlockedDate(bd.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.facility_name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Date/Time:</span> {selected.booking_date} {selected.start_time}–{selected.end_time}</div>
                <div><span className="text-muted-foreground">Demo type:</span> {selected.demo_type}</div>
                <div><span className="text-muted-foreground">Contact:</span> {selected.full_name}</div>
                <div><span className="text-muted-foreground">Job title:</span> {selected.job_title || '—'}</div>
                <div><span className="text-muted-foreground">Email:</span> {selected.email}</div>
                <div><span className="text-muted-foreground">Phone:</span> {selected.phone}</div>
                <div><span className="text-muted-foreground">Facility type:</span> {selected.facility_type}</div>
                <div><span className="text-muted-foreground">Location:</span> {selected.location_city}</div>
                <div><span className="text-muted-foreground">Staff/beds:</span> {selected.staff_or_beds_range || '—'}</div>
              </div>
              {selected.notes && (
                <div>
                  <Label className="text-xs">Visitor notes</Label>
                  <p className="text-sm text-muted-foreground mt-1">{selected.notes}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Internal notes</Label>
                <Textarea rows={3} value={internalNotesDraft} onChange={(e) => setInternalNotesDraft(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
            <Button onClick={saveNotes} disabled={savingNotes}>
              {savingNotes ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Notes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformAppLayout>
  );
};

export default PlatformDemoBookings;

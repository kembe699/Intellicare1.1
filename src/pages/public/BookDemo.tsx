import React, { useEffect, useMemo, useState } from 'react';
import { publicFetch } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Loader2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckCircle2,
  Building2, ArrowLeft, ArrowRight, Download, Clock, MonitorPlay, Users as UsersIcon, ShieldCheck,
} from 'lucide-react';

// Brand identity for this one public marketing page — deliberately NOT the
// app's internal --primary token (~#1A7A75): the spec gave exact hex values
// distinct from the HMIS chrome, so they're used directly rather than
// through the shared theme.
const TEAL = '#0A96A1';
const NAVY = '#153765';

const FACILITY_TYPES = ['Hospital', 'Clinic', 'Medical Centre', 'Pharmacy', 'Laboratory', 'Other'];
const DEMO_TYPES = ['In person', 'Online'];
const STAFF_RANGES = ['1–10', '11–50', '51–100', '101–300', '301–1000', '1000+'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const BENEFITS = [
  { icon: MonitorPlay, text: 'A real 30-minute walkthrough of registration, billing, lab and pharmacy' },
  { icon: UsersIcon, text: 'Tailored to your facility type and team size' },
  { icon: ShieldCheck, text: 'No obligation — reschedule or cancel anytime before your slot' },
];

type DayStatus = 'available' | 'full' | 'closed';
type Slot = { start: string; end: string };
type Step = 1 | 2 | 3;

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  job_title: string;
  facility_name: string;
  facility_type: string;
  location_city: string;
  staff_or_beds_range: string;
  demo_type: string;
  notes: string;
  website: string; // honeypot — real visitors never see or fill this
}

const emptyForm: FormState = {
  full_name: '', email: '', phone: '+211', job_title: '',
  facility_name: '', facility_type: '', location_city: '',
  staff_or_beds_range: '', demo_type: '', notes: '', website: '',
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Builds a .ics file for "Add to calendar", converting the booked Africa/Juba
// (fixed UTC+2) wall-clock time to a UTC instant — no timezone library
// needed since the offset never changes.
function buildIcs({ date, start, end, facilityName, demoType }: { date: string; start: string; end: string; facilityName: string; demoType: string }) {
  const toUtcStamp = (d: string, hhmm: string) => {
    const [y, mo, day] = d.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const ms = Date.UTC(y, mo - 1, day, h, mi) - 2 * 60 * 60000;
    return new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IntelliCare//Book a Demo//EN',
    'BEGIN:VEVENT',
    `UID:${date}-${start}-${Math.random().toString(36).slice(2)}@intellicare`,
    `DTSTAMP:${toUtcStamp(date, start)}`,
    `DTSTART:${toUtcStamp(date, start)}`,
    `DTEND:${toUtcStamp(date, end)}`,
    `SUMMARY:IntelliCare Demo — ${facilityName}`,
    `DESCRIPTION:${demoType} demo of IntelliCare HMIS for ${facilityName}.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function downloadIcs(content: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'intellicare-demo.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const StepDots: React.FC<{ step: Step }> = ({ step }) => (
  <div className="flex items-center gap-2 mb-7 lg:justify-start justify-center" aria-hidden="true">
    {[1, 2, 3].map((n) => (
      <div
        key={n}
        className="h-1.5 rounded-full transition-all duration-300"
        style={{ width: n === step ? 28 : 16, backgroundColor: n <= step ? TEAL : '#E2E8F0' }}
      />
    ))}
  </div>
);

// Desktop-only branding rail — this is what actually makes the page read as
// a real desktop layout instead of a mobile column stretched into empty
// whitespace. Hidden below `lg` so the phone experience is untouched.
const BrandPanel: React.FC = () => (
  <aside
    className="hidden lg:flex lg:flex-col lg:justify-between lg:w-[340px] lg:shrink-0 px-10 py-12"
    style={{ background: `linear-gradient(165deg, ${TEAL} 0%, ${NAVY} 100%)` }}
  >
    <div>
      <img src="/hjd.png" alt="IntelliCare" className="h-12 w-auto object-contain mb-12" />
      <h2 className="text-white text-[26px] font-bold leading-tight tracking-tight mb-4">
        See IntelliCare&nbsp;HMIS in action
      </h2>
      <p className="text-white/75 text-sm leading-relaxed mb-10">
        Book a short, guided demo and see exactly how your team would use it day to day.
      </p>
      <ul className="space-y-5">
        {BENEFITS.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
              <Icon className="w-4 h-4 text-white" />
            </div>
            <span className="text-white/90 text-[13.5px] leading-snug">{text}</span>
          </li>
        ))}
      </ul>
    </div>
    <p className="text-white/50 text-xs">All times shown in Africa/Juba (UTC+2)</p>
  </aside>
);

const MobileLogo: React.FC = () => (
  <div className="lg:hidden flex items-center justify-center py-6">
    <img src="/hjd.png" alt="IntelliCare" className="h-14 w-auto object-contain" />
  </div>
);

// Shared outer shell for both the wizard and the success screen — on mobile
// it's edge-to-edge (unchanged from before); from `lg` up it becomes a single
// centered card with the branding rail on the left and content on the right,
// so desktop gets an actual designed layout instead of a narrow mobile column.
const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-white lg:bg-slate-50">
    <div className="lg:min-h-screen lg:flex lg:items-center lg:justify-center lg:p-8">
      <div className="w-full lg:max-w-5xl lg:flex lg:bg-white lg:rounded-[28px] lg:shadow-[0_24px_70px_-20px_rgba(21,55,101,0.18)] lg:border lg:border-slate-100 lg:overflow-hidden">
        <BrandPanel />
        <div className="flex-1 flex flex-col min-h-screen lg:min-h-[640px] lg:px-12 lg:py-12">
          {children}
        </div>
      </div>
    </div>
  </div>
);

const BookDemo: React.FC = () => {
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — calendar + slots
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [monthDays, setMonthDays] = useState<Record<string, DayStatus>>({});
  const [monthLoading, setMonthLoading] = useState(true);
  const [timezone, setTimezone] = useState('Africa/Juba');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [daySlots, setDaySlots] = useState<Slot[] | null>(null);
  const [daySlotsLoading, setDaySlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);

  // Step 2 — form
  const [form, setForm] = useState<FormState>(emptyForm);

  // Success
  const [result, setResult] = useState<{ facility_name: string; demo_type: string } | null>(null);

  const today = useMemo(() => new Date(), []);
  const isCurrentMonth = visibleMonth.getFullYear() === today.getFullYear() && visibleMonth.getMonth() === today.getMonth();

  const loadMonth = async (d: Date) => {
    setMonthLoading(true);
    try {
      const res = await publicFetch(`/api/public/book-demo/availability/month?month=${monthKey(d)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load availability');
      setMonthDays(data.days || {});
      setTimezone(data.timezone || 'Africa/Juba');
    } catch (err: any) {
      toast.error(err.message || 'Could not load the calendar. Please try again.');
    } finally {
      setMonthLoading(false);
    }
  };

  useEffect(() => { loadMonth(visibleMonth); }, [visibleMonth]);

  const loadDay = async (date: string) => {
    setDaySlotsLoading(true);
    setDayError(null);
    setSelectedSlot(null);
    try {
      const res = await publicFetch(`/api/public/book-demo/availability/day?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load times');
      setDaySlots(data.slots || []);
    } catch (err: any) {
      setDayError(err.message || 'Could not load free times. Please try again.');
      setDaySlots(null);
    } finally {
      setDaySlotsLoading(false);
    }
  };

  const pickDate = (date: string, status: DayStatus) => {
    if (status === 'closed') return;
    setSelectedDate(date);
    loadDay(date);
  };

  const changeMonth = (delta: number) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1);
    if (delta < 0 && next.getFullYear() === today.getFullYear() && next.getMonth() < today.getMonth()) return;
    if (delta < 0 && next.getFullYear() < today.getFullYear()) return;
    setVisibleMonth(next);
    setSelectedDate(null);
    setDaySlots(null);
    setSelectedSlot(null);
  };

  const calendarCells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: dateKey(new Date(year, month, day)), day });
    }
    return cells;
  }, [visibleMonth]);

  const validateStep2 = (): string | null => {
    if (!form.full_name.trim()) return 'Full name is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'A valid email is required';
    if (!form.phone.trim() || form.phone.trim() === '+211') return 'Phone / WhatsApp is required';
    if (!form.facility_name.trim()) return 'Facility name is required';
    if (!FACILITY_TYPES.includes(form.facility_type)) return 'Please select a facility type';
    if (!form.location_city.trim()) return 'Location / city is required';
    if (!DEMO_TYPES.includes(form.demo_type)) return 'Please select a demo type';
    return null;
  };

  const goToStep2 = () => {
    if (!selectedDate || !selectedSlot) return;
    setStep(2);
  };

  const goToStep3 = () => {
    const err = validateStep2();
    if (err) { toast.error(err); return; }
    setStep(3);
  };

  const confirmBooking = async () => {
    if (!selectedDate || !selectedSlot) return;
    setSubmitting(true);
    try {
      const res = await publicFetch('/api/public/book-demo', {
        method: 'POST',
        body: JSON.stringify({
          date: selectedDate,
          start_time: selectedSlot.start,
          ...form,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        toast.error(data.message || 'That time was just booked by someone else. Please pick another time.');
        setStep(1);
        setSelectedSlot(null);
        await loadDay(selectedDate);
        await loadMonth(visibleMonth);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to book your demo');
      setResult({ facility_name: form.facility_name, demo_type: form.demo_type });
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToCalendar = () => {
    if (!selectedDate || !selectedSlot) return;
    downloadIcs(buildIcs({
      date: selectedDate, start: selectedSlot.start, end: selectedSlot.end,
      facilityName: form.facility_name, demoType: form.demo_type,
    }));
  };

  if (result) {
    return (
      <PageShell>
        <MobileLogo />
        <div className="flex-1 flex items-center justify-center px-4 pb-10 lg:p-0">
          <div className="w-full max-w-md text-center lg:text-left space-y-5">
            <div className="mx-auto lg:mx-0 w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${TEAL}1A` }}>
              <CheckCircle2 className="w-9 h-9" style={{ color: TEAL }} />
            </div>
            <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight" style={{ color: NAVY }}>Your demo is booked!</h1>
            <p className="text-slate-600">We&rsquo;ve sent a confirmation to <strong>{form.email}</strong>.</p>
            <div className="rounded-xl border border-slate-200 p-5 text-left space-y-2.5 bg-slate-50">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Facility</span><span className="font-semibold" style={{ color: NAVY }}>{result.facility_name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Date</span><span className="font-semibold" style={{ color: NAVY }}>{selectedDate}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Time</span><span className="font-semibold" style={{ color: NAVY }}>{selectedSlot?.start}–{selectedSlot?.end} ({timezone}, UTC+2)</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Demo type</span><span className="font-semibold" style={{ color: NAVY }}>{result.demo_type}</span></div>
            </div>
            <Button onClick={handleAddToCalendar} className="w-full h-12 text-base font-semibold" style={{ backgroundColor: TEAL }}>
              <Download className="w-4 h-4 mr-2" /> Add to calendar
            </Button>
            <p className="text-xs text-slate-400">Need to make a change? Email support@nilehc.tech</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <MobileLogo />
      <div className="flex-1 px-4 pb-28 lg:pb-0 lg:px-0">
        <div className="max-w-3xl lg:max-w-none mx-auto lg:mx-0">
          <h1 className="text-center lg:text-left text-2xl sm:text-3xl lg:text-[28px] font-bold tracking-tight mb-1" style={{ color: NAVY }}>Book a Demo</h1>
          <p className="text-center lg:text-left text-slate-500 mb-6 text-sm sm:text-base">See IntelliCare HMIS in action for your facility</p>
          <StepDots step={step} />

          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] lg:grid-cols-[1fr_260px] gap-6 lg:gap-10 items-start">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <button
                    aria-label="Previous month"
                    onClick={() => changeMonth(-1)}
                    disabled={isCurrentMonth}
                    className="w-11 h-11 flex items-center justify-center rounded-full disabled:opacity-30 hover:bg-slate-100"
                  >
                    <ChevronLeft className="w-5 h-5" style={{ color: NAVY }} />
                  </button>
                  <span className="font-semibold" style={{ color: NAVY }}>{MONTH_NAMES[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</span>
                  <button
                    aria-label="Next month"
                    onClick={() => changeMonth(1)}
                    className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-slate-100"
                  >
                    <ChevronRight className="w-5 h-5" style={{ color: NAVY }} />
                  </button>
                </div>

                <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-400 mb-1">
                  {DAY_HEADERS.map((d, i) => <div key={i} className="py-1">{d}</div>)}
                </div>

                {monthLoading ? (
                  <div className="h-56 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1.5">
                    {calendarCells.map((cell, idx) => {
                      if (!cell) return <div key={idx} />;
                      const status = monthDays[cell.date] || 'closed';
                      const isSelected = selectedDate === cell.date;
                      const base = 'aspect-square min-h-[44px] w-full rounded-lg text-sm font-medium flex items-center justify-center transition-colors';
                      if (status === 'closed') {
                        return <div key={idx} className={`${base} text-slate-300 cursor-not-allowed`}>{cell.day}</div>;
                      }
                      if (status === 'full') {
                        return (
                          <div key={idx} className={`${base} text-slate-400 bg-slate-50 cursor-not-allowed`} title="Fully booked">
                            {cell.day}
                          </div>
                        );
                      }
                      return (
                        <button
                          key={idx}
                          onClick={() => pickDate(cell.date, status)}
                          className={`${base} hover:opacity-90`}
                          style={isSelected
                            ? { backgroundColor: TEAL, color: '#fff' }
                            : { color: NAVY, backgroundColor: '#F0FAFB' }}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5 justify-center lg:justify-start">
                  <Clock className="w-3.5 h-3.5" /> All times shown in {timezone} (UTC+2)
                </p>
              </div>

              <div className="md:w-64 lg:w-full">
                <h2 className="text-sm font-semibold mb-2" style={{ color: NAVY }}>
                  {selectedDate ? `Available times` : 'Pick a date to see times'}
                </h2>
                {selectedDate && <p className="text-xs text-slate-400 mb-3">{selectedDate}</p>}
                {!selectedDate ? (
                  <div className="h-32 flex items-center justify-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
                    <CalendarIcon className="w-5 h-5 mr-2" /> No date selected
                  </div>
                ) : daySlotsLoading ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : dayError ? (
                  <div className="text-sm text-red-600 p-3 rounded-lg bg-red-50">{dayError}</div>
                ) : !daySlots || daySlots.length === 0 ? (
                  <div className="text-sm text-slate-500 p-4 rounded-lg bg-slate-50 text-center">No free times on this day</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-1 gap-2 max-h-[340px] overflow-y-auto pr-1">
                    {daySlots.map((slot) => (
                      <button
                        key={slot.start}
                        onClick={() => setSelectedSlot(slot)}
                        className="min-h-[44px] rounded-lg text-sm font-semibold border transition-colors"
                        style={selectedSlot?.start === slot.start
                          ? { backgroundColor: TEAL, color: '#fff', borderColor: TEAL }
                          : { color: NAVY, borderColor: '#E2E8F0' }}
                      >
                        {slot.start}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="max-w-md lg:max-w-none mx-auto lg:mx-0 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Full name *</Label>
                  <Input className="h-11" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input className="h-11" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Phone / WhatsApp *</Label>
                  <Input className="h-11" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Job title / role</Label>
                  <Input className="h-11" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Facility name *</Label>
                  <Input className="h-11" value={form.facility_name} onChange={(e) => setForm({ ...form, facility_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Facility type *</Label>
                  <Select value={form.facility_type} onValueChange={(v) => setForm({ ...form, facility_type: v })}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Select facility type" /></SelectTrigger>
                    <SelectContent>
                      {FACILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Location / city *</Label>
                  <Input className="h-11" value={form.location_city} onChange={(e) => setForm({ ...form, location_city: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Number of staff or beds</Label>
                  <Select value={form.staff_or_beds_range} onValueChange={(v) => setForm({ ...form, staff_or_beds_range: v })}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Select a range (optional)" /></SelectTrigger>
                    <SelectContent>
                      {STAFF_RANGES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Preferred demo type *</Label>
                <div className="grid grid-cols-2 lg:w-96 gap-2">
                  {DEMO_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, demo_type: t })}
                      className="min-h-[44px] rounded-lg text-sm font-semibold border transition-colors"
                      style={form.demo_type === t ? { backgroundColor: TEAL, color: '#fff', borderColor: TEAL } : { color: NAVY, borderColor: '#E2E8F0' }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              {/* Honeypot: hidden from real visitors via CSS, not `type="hidden"`
                  (which some bots skip filling), and never read as a tab stop. */}
              <div className="absolute w-px h-px overflow-hidden opacity-0" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
                  value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
            </div>
          )}

          {step === 3 && selectedDate && selectedSlot && (
            <div className="max-w-md lg:max-w-xl mx-auto lg:mx-0 space-y-4">
              <div className="rounded-xl border border-slate-200 p-5 lg:p-6 space-y-3 bg-slate-50">
                <div className="flex items-center gap-2 mb-1" style={{ color: NAVY }}>
                  <Building2 className="w-4 h-4" /><span className="font-semibold">{form.facility_name}</span>
                </div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Date</span><span className="font-medium" style={{ color: NAVY }}>{selectedDate}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Time</span><span className="font-medium" style={{ color: NAVY }}>{selectedSlot.start}–{selectedSlot.end} ({timezone}, UTC+2)</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Demo type</span><span className="font-medium" style={{ color: NAVY }}>{form.demo_type}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Contact</span><span className="font-medium" style={{ color: NAVY }}>{form.full_name}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Email</span><span className="font-medium" style={{ color: NAVY }}>{form.email}</span></div>
              </div>
              <p className="text-xs text-slate-400 text-center lg:text-left">By confirming, you&rsquo;ll receive a confirmation email with these details.</p>
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom action bar on mobile — keeps the primary action
          reachable with one thumb on a small phone. From `lg` it becomes a
          normal inline, right-aligned action row inside the card. */}
      <div className="fixed inset-x-0 bottom-0 bg-white border-t border-slate-100 p-4 flex gap-3 lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:pt-10 lg:justify-end">
        {step > 1 && (
          <Button variant="outline" className="h-12 flex-1 lg:flex-none lg:w-32" onClick={() => setStep((s) => (s - 1) as Step)}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        )}
        {step === 1 && (
          <Button className="h-12 flex-1 lg:flex-none lg:w-48 text-base font-semibold" style={{ backgroundColor: TEAL }} disabled={!selectedDate || !selectedSlot} onClick={goToStep2}>
            Continue <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        )}
        {step === 2 && (
          <Button className="h-12 flex-1 lg:flex-none lg:w-48 text-base font-semibold" style={{ backgroundColor: TEAL }} onClick={goToStep3}>
            Continue <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        )}
        {step === 3 && (
          <Button className="h-12 flex-1 lg:flex-none lg:w-56 text-base font-semibold" style={{ backgroundColor: TEAL }} disabled={submitting} onClick={confirmBooking}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm booking'}
          </Button>
        )}
      </div>
    </PageShell>
  );
};

export default BookDemo;

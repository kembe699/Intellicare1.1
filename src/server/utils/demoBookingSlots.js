// Pure slot-generation logic for the public "Book a Demo" page. No DB access
// here — routes/publicBookDemo.js loads settings/blocked-dates/bookings and
// passes plain data in, which keeps this testable without a database and
// keeps the availability math in one place shared by the month-grid and
// single-day endpoints.
//
// Africa/Juba is a fixed UTC+2 offset with no DST, so there's no need for a
// timezone library (and the backend has its own package.json/node_modules,
// separate from the frontend's date-fns) — plain UTC arithmetic with a fixed
// offset is exact and dependency-free.
const JUBA_OFFSET_MINUTES = 2 * 60;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

// The UTC epoch ms corresponding to a given Africa/Juba wall-clock moment.
function slotInstantMs(dateStr, hhmm) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - JUBA_OFFSET_MINUTES * 60000;
}

// "Now", expressed as Africa/Juba wall-clock fields (via UTC getters on a
// shifted Date), used for date-string/day-of-week comparisons.
function jubaNow() {
  return new Date(Date.now() + JUBA_OFFSET_MINUTES * 60000);
}

function jubaTodayString() {
  const n = jubaNow();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

function dateStrToUTCDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

function dayOfWeek(dateStr) {
  return dateStrToUTCDate(dateStr).getUTCDay(); // 0=Sun..6=Sat, matches working_days
}

function addDaysToDateString(dateStr, days) {
  const d = dateStrToUTCDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// All candidate slot start times for a date, ignoring bookings — i.e. what
// the day WOULD offer if nothing were booked yet and "now"/min-notice didn't
// matter. Used as the base list that getFreeSlotsForDate filters down.
function candidateSlotsForDate(settings, dateStr) {
  if (!settings.working_days.includes(dayOfWeek(dateStr))) return [];
  const step = settings.duration_minutes + settings.buffer_minutes;
  const startMin = toMinutes(settings.work_start_time);
  const endMin = toMinutes(settings.work_end_time);
  const slots = [];
  for (let t = startMin; t + settings.duration_minutes <= endMin; t += step) {
    slots.push(toHHMM(t));
  }
  return slots;
}

function isDateBookable(settings, blockedDateSet, dateStr) {
  const today = jubaTodayString();
  if (dateStr < today) return false;
  if (blockedDateSet.has(dateStr)) return false;
  if (!settings.working_days.includes(dayOfWeek(dateStr))) return false;
  const maxDate = addDaysToDateString(today, settings.max_advance_days);
  if (dateStr > maxDate) return false;
  return true;
}

// Free slot start times ('HH:mm') for one date, after removing past/
// too-soon slots and anything already booked (bookedStartTimes: array of
// 'HH:mm' strings with a non-cancelled booking that day).
function getFreeSlotsForDate(settings, blockedDateSet, dateStr, bookedStartTimes) {
  if (!isDateBookable(settings, blockedDateSet, dateStr)) return [];
  const booked = new Set(bookedStartTimes);
  const minNoticeMs = settings.min_notice_hours * 3600000;
  const earliestAllowed = Date.now() + minNoticeMs;
  return candidateSlotsForDate(settings, dateStr).filter((start) => {
    if (booked.has(start)) return false;
    return slotInstantMs(dateStr, start) >= earliestAllowed;
  });
}

function computeEndTime(startHHMM, durationMinutes) {
  return toHHMM(toMinutes(startHHMM) + durationMinutes);
}

// Day status for the calendar month-grid: 'closed' (non-working/blocked/
// past/beyond max-advance), 'full' (working day, nothing free), or
// 'available'. bookingsForDate: array of 'HH:mm' strings booked that day.
function getDayStatus(settings, blockedDateSet, dateStr, bookingsForDate) {
  if (!isDateBookable(settings, blockedDateSet, dateStr)) return 'closed';
  const free = getFreeSlotsForDate(settings, blockedDateSet, dateStr, bookingsForDate);
  return free.length > 0 ? 'available' : 'full';
}

module.exports = {
  JUBA_OFFSET_MINUTES,
  toMinutes,
  toHHMM,
  slotInstantMs,
  jubaNow,
  jubaTodayString,
  dayOfWeek,
  addDaysToDateString,
  candidateSlotsForDate,
  isDateBookable,
  getFreeSlotsForDate,
  computeEndTime,
  getDayStatus,
};

/**
 * Pure slot-generation logic for the public Book a Demo page — no DB, so
 * these run fast and don't need the platform connection at all. See
 * src/server/utils/demoBookingSlots.js for why Africa/Juba (fixed UTC+2, no
 * DST) is handled with plain arithmetic instead of a timezone library.
 */
const {
  toMinutes,
  toHHMM,
  candidateSlotsForDate,
  isDateBookable,
  getFreeSlotsForDate,
  computeEndTime,
  getDayStatus,
  jubaTodayString,
  addDaysToDateString,
  dayOfWeek,
} = require('../../src/server/utils/demoBookingSlots');

const baseSettings = () => ({
  duration_minutes: 30,
  working_days: [1, 2, 3, 4, 5], // Mon-Fri
  work_start_time: '09:00',
  work_end_time: '17:00',
  buffer_minutes: 0,
  min_notice_hours: 12,
  max_advance_days: 30,
  timezone: 'Africa/Juba',
});

// A weekday far enough in the future to never trip min-notice/max-advance in
// these tests, computed from "today" rather than hardcoded so the suite
// doesn't rot.
function aFutureWeekday(daysOut = 10) {
  let d = addDaysToDateString(jubaTodayString(), daysOut);
  while (![1, 2, 3, 4, 5].includes(dayOfWeek(d))) {
    d = addDaysToDateString(d, 1);
  }
  return d;
}

test('toMinutes/toHHMM round-trip', () => {
  expect(toMinutes('09:30')).toBe(570);
  expect(toHHMM(570)).toBe('09:30');
});

test('computeEndTime adds the duration', () => {
  expect(computeEndTime('09:00', 30)).toBe('09:30');
  expect(computeEndTime('09:45', 45)).toBe('10:30');
});

test('candidateSlotsForDate generates back-to-back 30-min slots across the working day', () => {
  const date = aFutureWeekday();
  const slots = candidateSlotsForDate(baseSettings(), date);
  expect(slots[0]).toBe('09:00');
  expect(slots[slots.length - 1]).toBe('16:30'); // last slot that still ends by 17:00
  expect(slots).not.toContain('17:00');
});

test('changing duration from 30 to 45 changes the generated slots (admin "Done when" criterion)', () => {
  const date = aFutureWeekday();
  const settings45 = { ...baseSettings(), duration_minutes: 45 };
  const slots30 = candidateSlotsForDate(baseSettings(), date);
  const slots45 = candidateSlotsForDate(settings45, date);
  expect(slots30).not.toEqual(slots45);
  expect(slots45[slots45.length - 1]).toBe('15:45'); // last 45-min slot ending by 17:00 (16:30)
});

test('buffer minutes space slots further apart', () => {
  const date = aFutureWeekday();
  const settings = { ...baseSettings(), buffer_minutes: 15 };
  const slots = candidateSlotsForDate(settings, date);
  expect(slots[0]).toBe('09:00');
  expect(slots[1]).toBe('09:45'); // 30 min demo + 15 min buffer
});

test('a non-working day (Saturday) has no candidate slots and is closed', () => {
  let date = aFutureWeekday();
  while (dayOfWeek(date) !== 6) date = addDaysToDateString(date, 1);
  if (dayOfWeek(date) !== 6) {
    // fall back to walking forward from a known Saturday-safe offset
    date = addDaysToDateString(aFutureWeekday(), 1);
  }
  const settings = baseSettings();
  // Force onto an actual Saturday deterministically.
  while (dayOfWeek(date) !== 6) date = addDaysToDateString(date, 1);
  expect(candidateSlotsForDate(settings, date)).toEqual([]);
  expect(isDateBookable(settings, new Set(), date)).toBe(false);
  expect(getDayStatus(settings, new Set(), date, [])).toBe('closed');
});

test('a blocked date (holiday) is closed even though it is a working day', () => {
  const date = aFutureWeekday();
  const settings = baseSettings();
  expect(isDateBookable(settings, new Set([date]), date)).toBe(false);
  expect(getDayStatus(settings, new Set([date]), date, [])).toBe('closed');
});

test('a date beyond max_advance_days is not bookable', () => {
  const settings = { ...baseSettings(), max_advance_days: 5 };
  const tooFar = addDaysToDateString(jubaTodayString(), 6);
  expect(isDateBookable(settings, new Set(), tooFar)).toBe(false);
});

test('booked slots disappear from the free list, and a cancelled one does not count as booked', () => {
  const date = aFutureWeekday();
  const settings = baseSettings();
  const free = getFreeSlotsForDate(settings, new Set(), date, ['09:00', '10:00']);
  expect(free).not.toContain('09:00');
  expect(free).not.toContain('10:00');
  expect(free).toContain('09:30');

  // Caller is responsible for only passing non-cancelled bookings in — an
  // empty booked list (as if the booking were cancelled) frees the slot again.
  const freeAfterCancel = getFreeSlotsForDate(settings, new Set(), date, []);
  expect(freeAfterCancel).toContain('09:00');
});

test('a day with every slot booked is "full", not "available"', () => {
  const date = aFutureWeekday();
  const settings = baseSettings();
  const allSlots = candidateSlotsForDate(settings, date);
  expect(getDayStatus(settings, new Set(), date, allSlots)).toBe('full');
  expect(getDayStatus(settings, new Set(), date, [])).toBe('available');
});

test('min_notice_hours filters out slots that start too soon from "now"', () => {
  // "Today" in Juba with a 12-hour notice requirement should have no slots
  // left if the working day (09:00-17:00) has already fully elapsed relative
  // to "now" + 12h in all but edge-of-day cases — rather than depend on wall
  // clock timing, assert the general property: a 10000-hour notice window
  // leaves nothing bookable on any date within range.
  const date = aFutureWeekday(1);
  const settings = { ...baseSettings(), min_notice_hours: 10000 };
  expect(getFreeSlotsForDate(settings, new Set(), date, [])).toEqual([]);
});

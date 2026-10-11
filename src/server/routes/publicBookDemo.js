// Public, unauthenticated "Book a Demo" page (src/pages/public/BookDemo.tsx
// at /book-demo) — mounted in index.js BEFORE app.use('/api', authenticateToken)
// the same way routes/publicPayroll.js is, so it never requires a tenant or
// platform-admin token. This is pure control-plane data (not tenant-scoped),
// so unlike publicPayroll.js it reaches straight into models/platform rather
// than resolving a per-request tenant connection.
//
// The public surface here must never leak another visitor's booking details
// — the availability endpoints return free slot times only, never names or
// emails (see getFreeSlotsForDate), and there is no public GET-by-id.
const express = require('express');
const { Op } = require('sequelize');
const { DemoBooking, DemoBookingSettings, DemoBookingBlockedDate } = require('../models/platform');
const { bookDemoAvailabilityLimiter, bookDemoSubmitLimiter } = require('../middleware/rateLimiters');
const {
  getDayStatus,
  getFreeSlotsForDate,
  computeEndTime,
  isDateBookable,
} = require('../utils/demoBookingSlots');
const { sendDemoBookingConfirmationEmail, sendDemoBookingNotificationEmail } = require('../utils/emailService');

const router = express.Router();

const FACILITY_TYPES = ['Hospital', 'Clinic', 'Medical Centre', 'Pharmacy', 'Laboratory', 'Other'];
const DEMO_TYPES = ['In person', 'Online'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

async function loadSettings() {
  const [settings] = await DemoBookingSettings.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
  return settings.get({ plain: true });
}

async function loadBlockedDateSet(fromDate, toDate) {
  const rows = await DemoBookingBlockedDate.findAll({
    where: { blocked_date: { [Op.between]: [fromDate, toDate] } },
    attributes: ['blocked_date'],
  });
  return new Set(rows.map((r) => r.blocked_date));
}

// date -> array of booked 'HH:mm' start times (non-cancelled only — a
// cancelled booking must not block the slot it freed up).
async function loadBookingsByDate(fromDate, toDate) {
  const rows = await DemoBooking.findAll({
    where: { booking_date: { [Op.between]: [fromDate, toDate] }, status: { [Op.ne]: 'cancelled' } },
    attributes: ['booking_date', 'start_time'],
  });
  const byDate = {};
  for (const r of rows) {
    const d = r.booking_date;
    (byDate[d] = byDate[d] || []).push(r.start_time);
  }
  return byDate;
}

router.get('/availability/month', bookDemoAvailabilityLimiter, async (req, res) => {
  try {
    const month = String(req.query.month || '');
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

    const settings = await loadSettings();
    const [y, m] = month.split('-').map(Number);
    const firstDay = `${month}-01`;
    const lastDateObj = new Date(Date.UTC(y, m, 0));
    const lastDay = `${month}-${String(lastDateObj.getUTCDate()).padStart(2, '0')}`;

    const [blockedDateSet, bookingsByDate] = await Promise.all([
      loadBlockedDateSet(firstDay, lastDay),
      loadBookingsByDate(firstDay, lastDay),
    ]);

    const days = {};
    for (let day = 1; day <= lastDateObj.getUTCDate(); day++) {
      const dateStr = `${month}-${String(day).padStart(2, '0')}`;
      days[dateStr] = getDayStatus(settings, blockedDateSet, dateStr, bookingsByDate[dateStr] || []);
    }

    res.json({ timezone: settings.timezone, durationMinutes: settings.duration_minutes, days });
  } catch (error) {
    console.error('Book-demo month availability error:', error);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

router.get('/availability/day', bookDemoAvailabilityLimiter, async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const settings = await loadSettings();
    const [blockedDateSet, bookingsByDate] = await Promise.all([
      loadBlockedDateSet(date, date),
      loadBookingsByDate(date, date),
    ]);

    const freeStarts = getFreeSlotsForDate(settings, blockedDateSet, date, bookingsByDate[date] || []);
    const slots = freeStarts.map((start) => ({ start, end: computeEndTime(start, settings.duration_minutes) }));

    res.json({ timezone: settings.timezone, durationMinutes: settings.duration_minutes, slots });
  } catch (error) {
    console.error('Book-demo day availability error:', error);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

router.post('/', bookDemoSubmitLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: a real visitor never fills this hidden field. Reply with a
    // generic success shape (never tipping the bot off) without touching
    // the database — the one piece of the "spam protection" that must stay
    // silent rather than erroring.
    if (String(body.website || '').trim() !== '') {
      return res.status(201).json({ id: null, booking_date: body.date, start_time: body.start_time });
    }

    const date = String(body.date || '').trim();
    const startTime = String(body.start_time || '').trim();
    const fullName = String(body.full_name || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    const jobTitle = String(body.job_title || '').trim();
    const facilityName = String(body.facility_name || '').trim();
    const facilityType = String(body.facility_type || '').trim();
    const locationCity = String(body.location_city || '').trim();
    const staffOrBedsRange = String(body.staff_or_beds_range || '').trim();
    const demoType = String(body.demo_type || '').trim();
    const notes = String(body.notes || '').trim();

    const errors = [];
    if (!DATE_RE.test(date)) errors.push('date is required');
    if (!TIME_RE.test(startTime)) errors.push('start_time is required');
    if (!fullName) errors.push('full_name is required');
    if (!EMAIL_RE.test(email)) errors.push('a valid email is required');
    if (!phone) errors.push('phone is required');
    if (!facilityName) errors.push('facility_name is required');
    if (!FACILITY_TYPES.includes(facilityType)) errors.push('facility_type must be one of: ' + FACILITY_TYPES.join(', '));
    if (!locationCity) errors.push('location_city is required');
    if (!DEMO_TYPES.includes(demoType)) errors.push('demo_type must be one of: ' + DEMO_TYPES.join(', '));
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const settings = await loadSettings();
    const blockedDateSet = await loadBlockedDateSet(date, date);
    if (!isDateBookable(settings, blockedDateSet, date)) {
      return res.status(409).json({ error: 'slot_taken', message: 'That date is no longer available. Please pick another date.' });
    }
    const bookingsByDate = await loadBookingsByDate(date, date);
    const freeStarts = getFreeSlotsForDate(settings, blockedDateSet, date, bookingsByDate[date] || []);
    if (!freeStarts.includes(startTime)) {
      return res.status(409).json({ error: 'slot_taken', message: 'That time was just booked by someone else. Please pick another time.' });
    }

    const endTime = computeEndTime(startTime, settings.duration_minutes);

    let booking;
    try {
      booking = await DemoBooking.create({
        booking_date: date,
        start_time: startTime,
        end_time: endTime,
        full_name: fullName,
        email,
        phone,
        job_title: jobTitle || null,
        facility_name: facilityName,
        facility_type: facilityType,
        location_city: locationCity,
        staff_or_beds_range: staffOrBedsRange || null,
        demo_type: demoType,
        notes: notes || null,
      });
    } catch (err) {
      // The partial unique index (demo_bookings_slot_unique) is the actual
      // guarantee here — the free-slot check above is just a fast path that
      // narrows the race window. Two requests that both passed that check
      // for the same slot will both reach this INSERT; the index lets only
      // one through and the loser lands here.
      if (err.name === 'SequelizeUniqueConstraintError' || err.original?.code === '23505') {
        return res.status(409).json({ error: 'slot_taken', message: 'That time was just booked by someone else. Please pick another time.' });
      }
      throw err;
    }

    const plain = booking.get({ plain: true });
    sendDemoBookingConfirmationEmail({
      to: email,
      fullName,
      bookingDate: date,
      startTime,
      endTime,
      demoType,
      facilityName,
    }).catch((e) => console.error('Demo booking confirmation email failed:', e.message));
    sendDemoBookingNotificationEmail({ booking: plain }).catch((e) => console.error('Demo booking notification email failed:', e.message));

    res.status(201).json({
      id: plain.id,
      booking_date: plain.booking_date,
      start_time: plain.start_time,
      end_time: plain.end_time,
      full_name: plain.full_name,
      facility_name: plain.facility_name,
      demo_type: plain.demo_type,
      timezone: settings.timezone,
    });
  } catch (error) {
    console.error('Book-demo create error:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

module.exports = router;

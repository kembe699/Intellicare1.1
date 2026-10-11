const express = require('express');
const { Op } = require('sequelize');
const { DemoBooking, DemoBookingSettings, DemoBookingBlockedDate } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

const STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];

// ── Bookings ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.status && STATUSES.includes(req.query.status)) {
      where.status = req.query.status;
    }
    if (req.query.from || req.query.to) {
      where.booking_date = {};
      if (req.query.from) where.booking_date[Op.gte] = req.query.from;
      if (req.query.to) where.booking_date[Op.lte] = req.query.to;
    }
    if (req.query.search) {
      const q = `%${req.query.search}%`;
      where[Op.or] = [
        { full_name: { [Op.iLike]: q } },
        { email: { [Op.iLike]: q } },
        { facility_name: { [Op.iLike]: q } },
        { phone: { [Op.iLike]: q } },
      ];
    }
    const bookings = await DemoBooking.findAll({
      where,
      order: [['booking_date', 'DESC'], ['start_time', 'DESC']],
    });
    res.json(bookings);
  } catch (error) {
    console.error('List demo bookings error:', error);
    res.status(500).json({ error: 'Failed to load bookings' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const booking = await DemoBooking.findByPk(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const { status, internal_notes } = req.body;
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      booking.status = status; // cancelling frees the slot — availability queries exclude 'cancelled'
    }
    if (internal_notes !== undefined) booking.internal_notes = internal_notes;
    await booking.save();
    res.json(booking);
  } catch (error) {
    console.error('Update demo booking error:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// ── Settings (singleton row, id=1) ──────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const [settings] = await DemoBookingSettings.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    res.json(settings);
  } catch (error) {
    console.error('Load demo booking settings error:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const [settings] = await DemoBookingSettings.findOrCreate({ where: { id: 1 }, defaults: { id: 1 } });
    const {
      duration_minutes, working_days, work_start_time, work_end_time,
      buffer_minutes, min_notice_hours, max_advance_days, timezone,
    } = req.body;

    if (duration_minutes !== undefined) settings.duration_minutes = duration_minutes;
    if (Array.isArray(working_days)) settings.working_days = working_days;
    if (work_start_time !== undefined) settings.work_start_time = work_start_time;
    if (work_end_time !== undefined) settings.work_end_time = work_end_time;
    if (buffer_minutes !== undefined) settings.buffer_minutes = buffer_minutes;
    if (min_notice_hours !== undefined) settings.min_notice_hours = min_notice_hours;
    if (max_advance_days !== undefined) settings.max_advance_days = max_advance_days;
    if (timezone !== undefined) settings.timezone = timezone;

    await settings.save();
    res.json(settings);
  } catch (error) {
    console.error('Update demo booking settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ── Blocked dates ────────────────────────────────────────────────────────
router.get('/blocked-dates', async (req, res) => {
  try {
    const rows = await DemoBookingBlockedDate.findAll({ order: [['blocked_date', 'ASC']] });
    res.json(rows);
  } catch (error) {
    console.error('List blocked dates error:', error);
    res.status(500).json({ error: 'Failed to load blocked dates' });
  }
});

router.post('/blocked-dates', async (req, res) => {
  try {
    const { blocked_date, reason } = req.body;
    if (!blocked_date) return res.status(400).json({ error: 'blocked_date is required' });
    const row = await DemoBookingBlockedDate.create({ blocked_date, reason: reason || null });
    res.status(201).json(row);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'That date is already blocked' });
    }
    console.error('Create blocked date error:', error);
    res.status(500).json({ error: 'Failed to add blocked date' });
  }
});

router.delete('/blocked-dates/:id', async (req, res) => {
  try {
    const row = await DemoBookingBlockedDate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Blocked date not found' });
    await row.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete blocked date error:', error);
    res.status(500).json({ error: 'Failed to remove blocked date' });
  }
});

module.exports = router;

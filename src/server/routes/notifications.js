const express = require('express');
const router = express.Router();

// No authorize() gate beyond the global authenticateToken — every endpoint
// here is scoped to req.user.id itself, so there is no privilege to check:
// a user can only ever see or modify their own app_notifications.

// List the current user's app_notifications, most recent first. ?unread_only=true
// narrows to unread ones (used by the bell's dropdown); the count endpoint
// below is what drives the badge, so this stays a plain capped list rather
// than something the frontend has to paginate through for a header widget.
router.get('/', async (req, res) => {
  try {
    const { sequelize } = req.models;
    const unreadOnly = req.query.unread_only === 'true';
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

    const [rows] = await sequelize.query(
      `SELECT id, type, title, message, entity_type, entity_id, link, is_read, created_at
         FROM app_notifications
        WHERE user_id = :userId ${unreadOnly ? 'AND is_read = false' : ''}
        ORDER BY created_at DESC
        LIMIT :limit`,
      { replacements: { userId: req.user.id, limit } }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching app_notifications:', error);
    res.status(500).json({ error: 'Failed to fetch app_notifications' });
  }
});

// Just the unread count — polled far more often than the full list, so it
// stays a single COUNT(*) rather than shipping full rows every tick.
router.get('/unread-count', async (req, res) => {
  try {
    const { sequelize } = req.models;
    const [[row]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM app_notifications WHERE user_id = :userId AND is_read = false`,
      { replacements: { userId: req.user.id } }
    );
    res.json({ count: parseInt(row?.cnt, 10) || 0 });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// Mark one notification read. Scoped to user_id in the WHERE clause itself
// (not just looked up by id) so a user can never mark — or even discover
// the existence of — another user's notification by guessing an id.
router.put('/:id/read', async (req, res) => {
  try {
    const { sequelize } = req.models;
    const [, meta] = await sequelize.query(
      `UPDATE app_notifications SET is_read = true WHERE id = :id AND user_id = :userId`,
      { replacements: { id: req.params.id, userId: req.user.id } }
    );
    if (meta.rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

router.put('/read-all', async (req, res) => {
  try {
    const { sequelize } = req.models;
    await sequelize.query(
      `UPDATE app_notifications SET is_read = true WHERE user_id = :userId AND is_read = false`,
      { replacements: { userId: req.user.id } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all app_notifications read:', error);
    res.status(500).json({ error: 'Failed to update app_notifications' });
  }
});

module.exports = router;

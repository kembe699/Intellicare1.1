const express = require('express');
const bcrypt = require('bcrypt');
const { PlatformAdmin } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

router.get('/', async (req, res) => {
  try {
    const admins = await PlatformAdmin.findAll({
      attributes: ['id', 'name', 'email', 'createdAt'],
      order: [['createdAt', 'ASC']],
    });
    res.json(admins);
  } catch (error) {
    console.error('List platform admins error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await PlatformAdmin.findOne({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    const admin = await PlatformAdmin.create({ name, email: email.toLowerCase(), password_hash });

    res.status(201).json({ id: admin.id, name: admin.name, email: admin.email, createdAt: admin.createdAt });
  } catch (error) {
    console.error('Create platform admin error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.platformAdmin.id) {
      return res.status(400).json({ error: "You can't remove your own account" });
    }

    const total = await PlatformAdmin.count();
    if (total <= 1) {
      return res.status(400).json({ error: 'At least one platform admin must remain' });
    }

    const admin = await PlatformAdmin.findByPk(targetId);
    if (!admin) return res.status(404).json({ error: 'User not found' });

    await admin.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete platform admin error:', error);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

module.exports = router;

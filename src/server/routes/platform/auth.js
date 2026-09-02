const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PlatformAdmin } = require('../../models/platform');
const { authLimiter } = require('../../middleware/rateLimiters');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const admin = await PlatformAdmin.findOne({ where: { email: email.toLowerCase() } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, name: admin.name, isPlatformAdmin: true },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (error) {
    console.error('Platform admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;

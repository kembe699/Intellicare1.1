const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on clinical documentation, so the API enforces what the client already assumes.
const CLINICAL_WRITE = ['admin', 'doctor', 'nurse'];
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
// Only for the one-time boot-time table-ensure below — every tenant's own
// database already gets this table via the schema clone at provisioning
// time (see scripts/provisionTenant.js), so this default-database check is
// just a safety net for the original/legacy database, never used for actual
// request data. Route handlers below use req.models' tenant-aware
// connection instead — using this static one there was a real cross-tenant
// data leak (every tenant's clinical diagnoses were being read from and
// written to this one shared database regardless of which tenant asked).
const defaultSequelize = require('../config/database');

(async () => {
  try {
    await defaultSequelize.query(`
      CREATE TABLE IF NOT EXISTS clinical_diagnoses (
        id VARCHAR(36) PRIMARY KEY,
        diagnosis_text VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ clinical_diagnoses table ready');
  } catch (e) {
    console.error('Error ensuring clinical_diagnoses table:', e.message);
  }
})();

router.get('/', async (req, res) => {
  const { sequelize } = req.models;
  try {
    const [rows] = await sequelize.query(`SELECT id, diagnosis_text FROM clinical_diagnoses ORDER BY diagnosis_text ASC`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clinical diagnoses' });
  }
});

router.post('/', authorize(CLINICAL_WRITE), async (req, res) => {
  const { sequelize } = req.models;
  const { diagnosis_text } = req.body;
  if (!diagnosis_text || !diagnosis_text.trim()) {
    return res.status(400).json({ error: 'diagnosis_text is required' });
  }
  const text = diagnosis_text.trim();
  try {
    const [existing] = await sequelize.query(
      `SELECT id, diagnosis_text FROM clinical_diagnoses WHERE diagnosis_text = :text`,
      { replacements: { text } }
    );
    if (existing.length > 0) {
      return res.json(existing[0]);
    }
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO clinical_diagnoses (id, diagnosis_text) VALUES (:id, :text)`,
      { replacements: { id, text } }
    );
    res.status(201).json({ id, diagnosis_text: text });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create clinical diagnosis' });
  }
});

module.exports = router;

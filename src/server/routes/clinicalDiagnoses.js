const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on clinical documentation, so the API enforces what the client already assumes.
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

// Admin "Uncoded diagnoses" screen: free-text entries with no ICD-10 code
// yet, ranked by how often they're actually used (custom visit_diagnoses
// rows pointing at them) so the highest-value ones to map surface first.
router.get('/uncoded', authorize('clinical.diagnoses.write'), async (req, res) => {
  const { sequelize } = req.models;
  try {
    const [rows] = await sequelize.query(`
      SELECT cd.id, cd.diagnosis_text, COUNT(vd.id)::int AS usage_count
      FROM clinical_diagnoses cd
      LEFT JOIN visit_diagnoses vd ON vd.custom_diagnosis_id = cd.id AND vd.deleted_at IS NULL
      WHERE cd.icd_code IS NULL
      GROUP BY cd.id, cd.diagnosis_text
      ORDER BY usage_count DESC, cd.diagnosis_text ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error listing uncoded diagnoses:', error);
    res.status(500).json({ error: 'Failed to list uncoded diagnoses' });
  }
});

// Maps a free-text diagnosis to an ICD-10 code going forward. Optionally
// (apply_to_existing) also rewrites past visit_diagnoses rows that used
// this custom entry to the coded form — never touches clinical_notes text
// already saved, since that's an immutable record of what was written at
// the time.
router.put('/:id/map', authorize('clinical.diagnoses.write'), async (req, res) => {
  const { sequelize } = req.models;
  const { id } = req.params;
  const { icd_code, icd_description, apply_to_existing } = req.body;
  if (!icd_code || !icd_description) {
    return res.status(400).json({ error: 'icd_code and icd_description are required' });
  }
  try {
    const [[diagnosis]] = await sequelize.query(`SELECT id, diagnosis_text FROM clinical_diagnoses WHERE id = :id`, { replacements: { id } });
    if (!diagnosis) return res.status(404).json({ error: 'Diagnosis not found' });

    await sequelize.query(`UPDATE clinical_diagnoses SET icd_code = :icdCode WHERE id = :id`, { replacements: { id, icdCode: icd_code } });

    let updatedVisits = 0;
    if (apply_to_existing) {
      const [result] = await sequelize.query(
        `UPDATE visit_diagnoses SET icd_code = :icdCode, description = :icdDescription, source = 'icd'
         WHERE custom_diagnosis_id = :id AND deleted_at IS NULL AND source = 'custom'`,
        { replacements: { id, icdCode: icd_code, icdDescription: icd_description } }
      );
      updatedVisits = result?.rowCount ?? 0;
    }

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Clinical', action: 'DIAGNOSIS_MAPPED', entity_type: 'ClinicalDiagnosis', entity_id: id,
        description: `Mapped "${diagnosis.diagnosis_text}" to ICD-10 ${icd_code}${apply_to_existing ? ` (applied to ${updatedVisits} past visit(s))` : ''}`,
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ id, diagnosis_text: diagnosis.diagnosis_text, icd_code, updated_visits: updatedVisits });
  } catch (error) {
    console.error('Error mapping diagnosis:', error);
    res.status(500).json({ error: 'Failed to map diagnosis' });
  }
});

router.post('/', authorize('clinical.diagnoses.write'), async (req, res) => {
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

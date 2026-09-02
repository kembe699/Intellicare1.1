const express = require('express');
const { sequelize } = require('../models');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getTenantConnection } = require('../tenantDb');
const tenantContext = require('../tenantContext');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

// ─── Dual-Auth Integration Middleware ────────────────────────────────────────
// Accepts two types of credentials:
//   1. Standard JWT  — for backward compatibility with existing running agents
//   2. Static Token  — generated via Setup → API Configurations; stored by hash
const verifyIntegrationToken = async (req, res, next) => {
  try {
    let raw = req.headers.authorization?.replace('Bearer ', '');
    if (!raw) return res.status(401).json({ error: 'No token provided' });

    raw = raw.trim(); // Ensure no trailing spaces

    // ── Path A: Static integration token (starts with "ic-") ──
    if (raw.startsWith('ic-')) {
      // This route is public (see publicPaths in middleware/auth.js — the Lab Agent has
      // no session/JWT to resolve a tenant from), so `sequelize` above is always the
      // Proxy's no-context fallback: the app's single hardcoded default database. A
      // token minted with the new ic-<prefix>:<schemaName>:<random> format (see
      // apiConfigurations.js) carries its own tenant, which we resolve explicitly here
      // instead. An older ic-<prefix>:<random> token (2 segments, no schemaName — issued
      // before this fix) has no tenant to recover and keeps working exactly as before,
      // checked only against the default database.
      const segments = raw.split(':');
      const embeddedDbName = segments.length >= 3 ? segments[1] : null;

      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      const db = embeddedDbName ? (await getTenantConnection(embeddedDbName)).sequelize : sequelize;

      const [rows] = await db.query(`
        SELECT id, config_type, is_active FROM api_integration_tokens
        WHERE token_hash = ? AND is_active = TRUE
        LIMIT 1
      `, { replacements: [tokenHash] });

      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'Invalid or revoked integration token' });
      }

      // Update last_used_at timestamp (fire-and-forget)
      db.query(
        `UPDATE api_integration_tokens SET last_used_at = NOW() WHERE id = ?`,
        { replacements: [rows[0].id] }
      ).catch(() => {});

      req.user = { role: 'integration', tokenType: 'static', configType: rows[0].config_type };
      if (!embeddedDbName) return next();

      // The rest of this route (writing the result into the Holding Tank) reads
      // `sequelize`/models the same tenant-aware way every other route does — running
      // it inside this tenant's context is what makes that resolve correctly instead
      // of also silently landing in the default database.
      const tenantConnection = await getTenantConnection(embeddedDbName);
      return tenantContext.run(tenantConnection, () => next());
    }

    // ── Path B: Standard JWT (legacy / user-login tokens) ──
    const decoded = jwt.verify(raw, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.role !== 'integration') {
      return res.status(403).json({ error: 'Insufficient permissions for lab integration' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// 1. POST /api/lab-integration/receive
// This receives data from the local Agent and drops it in the Holding Tank
router.post('/receive', verifyIntegrationToken, async (req, res) => {
  try {
    const { sampleId, machineName, rawData, parsedData } = req.body;

    if (!sampleId || !parsedData) {
      return res.status(400).json({ error: 'sampleId and parsedData are required' });
    }

    await sequelize.query(`
      INSERT INTO lab_machine_raw_results (sample_id, machine_name, raw_data, parsed_data)
      VALUES (?, ?, ?, ?)
    `, {
      replacements: [
        sampleId, 
        machineName || 'Mindray BC-10', 
        JSON.stringify(rawData || {}), 
        JSON.stringify(parsedData)
      ]
    });

    res.json({ success: true, message: 'Result safely placed in holding tank' });
  } catch (error) {
    console.error('Lab Integration Receive Error:', error);
    res.status(500).json({ error: 'Failed to process machine result' });
  }
});

// 2. GET /api/lab-integration/fetch-machine-result?sampleId=1234
// This is called by the UI when the user clicks "Fetch from Machine"
// We use a regular JWT auth middleware here (not just integration)
const verifyAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

router.get('/fetch-machine-result', verifyAuth, async (req, res) => {
  try {
    const { sampleId } = req.query;

    if (!sampleId) {
      return res.status(400).json({ error: 'sampleId query parameter is required' });
    }

    const [results] = await sequelize.query(`
      SELECT * FROM lab_machine_raw_results 
      WHERE sample_id = ? AND is_processed = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `, {
      replacements: [sampleId]
    });

    if (results.length === 0) {
      return res.status(404).json({ error: 'No pending machine results found for this Sample ID' });
    }

    res.json({ success: true, data: results[0] });
  } catch (error) {
    console.error('Lab Integration Fetch Error:', error);
    res.status(500).json({ error: 'Failed to fetch from holding tank' });
  }
});

// 3. POST /api/lab-integration/mark-processed
// Called by UI after the user successfully saves the fetched data
router.post('/mark-processed', verifyAuth, async (req, res) => {
  try {
    const { id } = req.body;
    
    if (!id) return res.status(400).json({ error: 'Holding tank ID is required' });

    await sequelize.query(`
      UPDATE lab_machine_raw_results 
      SET is_processed = TRUE, processed_at = NOW() 
      WHERE id = ?
    `, {
      replacements: [id]
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Lab Integration Process Error:', error);
    res.status(500).json({ error: 'Failed to mark as processed' });
  }
});

module.exports = router;

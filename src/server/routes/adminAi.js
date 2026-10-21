/**
 * Admin-only diagnostics for the Anthropic integration — lets an admin (or
 * whoever deploys this) confirm the key/model/network path actually works
 * end to end without digging through server logs or opening a clinical
 * record. Gated on pages.security.access (permanently admin-only, no
 * default roles — see permissionsCatalog.js) since this reveals whether
 * credentials are configured, even though it never reveals the key itself.
 */
const express = require('express');
const { authorize } = require('../middleware/authorize');
const anthropicClient = require('../services/ai/anthropicClient');

const router = express.Router();

router.get('/ai/health', authorize('pages.security.access'), async (req, res) => {
  if (!anthropicClient.isConfigured()) {
    return res.json({ configured: false, ok: false, model: anthropicClient.getDefaultModel(), error: { type: 'not_configured', message: 'ANTHROPIC_API_KEY is not set' } });
  }
  const result = await anthropicClient.ping();
  res.json({ configured: true, model: anthropicClient.getDefaultModel(), ...result });
});

module.exports = router;

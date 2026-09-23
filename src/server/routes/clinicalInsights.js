const express = require('express');
const { authorize } = require('../middleware/authorize');
const { clinicalInsightsLimiter } = require('../middleware/rateLimiters');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const ClinicalInsightsService = require('../services/ClinicalInsightsService');

const router = express.Router();

// A pending row younger than this is still "in flight" and worth waiting on;
// one older than this is presumed stuck (the sweep will fail it out
// separately) and a fresh POST is free to start a new attempt over it.
const STUCK_PENDING_MS = 3 * 60 * 1000;

function featureEnabled() {
  return process.env.CLINICAL_INSIGHTS_ENABLED === 'true';
}

async function loadOrderForAccessCheck(db, orderId) {
  const [[order]] = await db.query(`SELECT id, clinic_id, branch_id FROM lis_test_orders WHERE id = ?`, { replacements: [orderId] });
  return order;
}

// Dispatches generation and returns immediately — see ClinicalInsightsService
// .generateInsights for the actual (fire-and-forget) call.
router.post('/:orderId/clinical-insights', authorize('lis.clinical.insights.write'), clinicalInsightsLimiter, async (req, res) => {
  const { sequelize: db } = req.models;
  const { orderId } = req.params;
  if (!featureEnabled()) return res.status(503).json({ error: 'Clinical Insights is not enabled' });

  try {
    const order = await loadOrderForAccessCheck(db, orderId);
    if (!order) return res.status(404).json({ error: 'Visit not found' });
    if (!BranchQueryFilter.canAccessRecord(order, req.branchContext)) return res.status(404).json({ error: 'Visit not found' });

    const regenerate = req.query.regenerate === 'true';
    if (!regenerate) {
      const [[existing]] = await db.query(
        `SELECT id, status, created_at FROM clinical_insights WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
        { replacements: [orderId] }
      );
      const stillFresh = existing?.status === 'pending' && (Date.now() - new Date(existing.created_at).getTime()) < STUCK_PENDING_MS;
      if (existing && (existing.status === 'completed' || stillFresh)) {
        return res.json({ id: existing.id, status: existing.status });
      }
    }

    const result = await ClinicalInsightsService.generateInsights(db, {
      orderId, requestedBy: req.user?.id, clinicId: order.clinic_id, branchId: order.branch_id,
    });

    // Every request is logged with user and timestamp — the audit trail the
    // feature spec calls for, via the same logAudit helper other billing/
    // clinical routes already use (never logs the payload/response itself).
    try {
      const rr = require('./reports');
      await rr.logAudit({
        req, clinic_id: order.clinic_id, user_id: req.user?.id, user_name: req.user?.displayName, user_role: req.user?.role,
        module: 'Clinical', action: 'CLINICAL_INSIGHTS_REQUESTED', entity_type: 'LisTestOrder', entity_id: orderId,
        description: `Clinical Insights requested for visit ${orderId}${regenerate ? ' (regenerate)' : ''}`,
      });
    } catch (e) { /* audit failure must never block the request itself */ }

    res.json(result);
  } catch (error) {
    console.error('Error requesting clinical insights:', error.message);
    res.status(500).json({ error: 'Failed to request clinical insights' });
  }
});

// Returns the most recent generation attempt for this visit, or its status
// while still pending. {enabled: false} when the feature flag is off, so the
// frontend can decide not to render the button at all.
router.get('/:orderId/clinical-insights', authorize('lis.clinical.insights.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { orderId } = req.params;
  if (!featureEnabled()) return res.json({ enabled: false });

  try {
    const order = await loadOrderForAccessCheck(db, orderId);
    if (!order) return res.status(404).json({ error: 'Visit not found' });
    if (!BranchQueryFilter.canAccessRecord(order, req.branchContext)) return res.status(404).json({ error: 'Visit not found' });

    const [[row]] = await db.query(
      `SELECT id, status, model, response, error_message, created_at, updated_at
       FROM clinical_insights WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
      { replacements: [orderId] }
    );
    if (!row) return res.json({ status: 'none' });

    res.json({
      id: row.id,
      status: row.status,
      model: row.model,
      response: row.response ? (typeof row.response === 'string' ? JSON.parse(row.response) : row.response) : null,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (error) {
    console.error('Error fetching clinical insights:', error.message);
    res.status(500).json({ error: 'Failed to fetch clinical insights' });
  }
});

module.exports = router;

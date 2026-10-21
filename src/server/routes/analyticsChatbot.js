const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { chatbotLimiter, chatbotLlmLimiter } = require('../middleware/rateLimiters');
const { answerQuestion, hasPrivilege } = require('../services/analyticsChatbot/chatbotEngine');
const llmEngine = require('../services/analyticsChatbot/llmEngine');
const { SUGGESTED_QUESTIONS } = require('../services/analyticsChatbot/responseTemplates');

// Base access gate for the whole feature — "can open the Assistant at all".
// Individual financial questions are checked again per-request against
// accounting.read inside chatbotEngine.js; this only decides whether the
// page/API exists for this user.
router.use(authorize('pages.analytics_assistant.view'));

const MAX_QUESTION_LENGTH = 500;

/** Ownership-checked conversation lookup — never lets one user read or post into another user's conversation. */
async function loadOwnConversation(sequelize, conversationId, userId) {
  const [[row]] = await sequelize.query(
    `SELECT id, user_id, clinic_id, branch_id, title FROM chatbot_conversations WHERE id = :id AND user_id = :userId`,
    { replacements: { id: conversationId, userId } },
  );
  return row || null;
}

// Suggested questions, filtered to what this user is actually allowed to
// ask — never advertise a question whose answer they'd just get refused.
router.get('/suggestions', async (req, res) => {
  try {
    const canSeeRevenue = await hasPrivilege(req, 'accounting.read');
    const suggestions = SUGGESTED_QUESTIONS
      .filter((s) => !s.requiresPermission || canSeeRevenue)
      .map((s) => s.text);
    res.json({ suggestions });
  } catch (error) {
    console.error('Error building chatbot suggestions:', error.message);
    res.status(500).json({ error: 'Failed to load suggestions' });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const { sequelize } = req.models;
    const [rows] = await sequelize.query(
      `SELECT id, title, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM chatbot_conversations WHERE user_id = :userId
        ORDER BY updated_at DESC LIMIT 50`,
      { replacements: { userId: req.user.id } },
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing chatbot conversations:', error.message);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { sequelize } = req.models;
    const conv = await loadOwnConversation(sequelize, req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const [rows] = await sequelize.query(
      `SELECT id, role, content, intent, created_at AS "createdAt"
         FROM chatbot_messages WHERE conversation_id = :id ORDER BY created_at ASC`,
      { replacements: { id: req.params.id } },
    );
    res.json(rows);
  } catch (error) {
    console.error('Error loading chatbot messages:', error.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

router.delete('/conversations/:id', async (req, res) => {
  try {
    const { sequelize } = req.models;
    const conv = await loadOwnConversation(sequelize, req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    await sequelize.query(`DELETE FROM chatbot_conversations WHERE id = :id`, { replacements: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chatbot conversation:', error.message);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

router.post('/ask', chatbotLimiter, chatbotLlmLimiter, async (req, res) => {
  try {
    const { sequelize } = req.models;
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required' });
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters)` });
    }

    let conversationId = req.body?.conversationId || null;
    let conv = null;
    if (conversationId) {
      conv = await loadOwnConversation(sequelize, conversationId, req.user.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    } else {
      conversationId = uuidv4();
      const title = question.length > 60 ? `${question.slice(0, 57)}...` : question;
      const { getCreateBranchId } = require('../middleware/branchFilter');
      await sequelize.query(
        `INSERT INTO chatbot_conversations (id, user_id, clinic_id, branch_id, title) VALUES (:id, :userId, :clinicId, :branchId, :title)`,
        { replacements: { id: conversationId, userId: req.user.id, clinicId: req.user.clinicId || null, branchId: getCreateBranchId(req), title } },
      );
    }

    const clinicId = parseInt(req.user?.clinicId, 10) || 1;
    let result = null;
    let engineUsed = 'keyword';

    // The actual analytics queries (not conversation bookkeeping above,
    // which still needs to INSERT/UPDATE and so always uses the normal
    // `sequelize`) run on the dedicated read-only connection when one is
    // available for this tenant — see tenantDb.js's getReadOnlyTenantConnection
    // and ensureAnalyticsReadOnlyRole.js. Falls back to the normal
    // connection whenever the read-only layer isn't configured or isn't
    // ready yet for this schema; this is a defense-in-depth addition, never
    // a hard requirement for the assistant to answer.
    const { getReadOnlyTenantConnection } = require('../tenantDb');
    const analyticsSequelize = (await getReadOnlyTenantConnection(req.tenantSchema).catch(() => null)) || sequelize;

    // LLM mode, when enabled: give Claude the real conversation history (not
    // just one inherited turn) so it can follow up, clarify, and understand
    // phrasing the keyword engine's fixed patterns never would. Any failure
    // here (no API key, timeout, API error) falls through to the
    // deterministic engine below rather than failing the request — the
    // feature must keep working even if the LLM path is unavailable.
    if (llmEngine.featureEnabled()) {
      try {
        const [historyRows] = await sequelize.query(
          `SELECT role, content FROM chatbot_messages WHERE conversation_id = :id ORDER BY created_at ASC`,
          { replacements: { id: conversationId } },
        );
        const llmResult = await llmEngine.answerQuestion({ sequelize: analyticsSequelize, req, question, history: historyRows, clinicId });
        result = { text: llmResult.text, table: null, intentKey: llmResult.toolCalls.map((t) => t.name).join(',') || null, toolCalls: llmResult.toolCalls };
        engineUsed = 'llm';
      } catch (e) {
        console.error('Analytics Assistant LLM engine failed, falling back to keyword engine:', e.message);
      }
    }

    if (!result) {
      // Follow-up context: the most recent assistant message in THIS
      // conversation that actually resolved to a real topic (intent IS NOT
      // NULL) — see chatbotEngine.js's answerQuestion for exactly which
      // pieces of it get inherited when the new question doesn't specify
      // them itself. Permission is still re-checked fresh every turn there,
      // regardless of what this stored context contains.
      //
      // Deliberately skips over any intervening "I'm not sure I understood"
      // turn (stored with intent = NULL) instead of just grabbing the
      // literal last message: a real topic ("doctor activity") followed by
      // one unrelated/unsupported question shouldn't permanently erase that
      // topic — the next genuine follow-up ("I mean for last month") should
      // still be able to resume it, the same way a person would in
      // conversation rather than treating one dead-end detour as a hard reset.
      const [[lastRealTurnRow]] = await sequelize.query(
        `SELECT intent, params FROM chatbot_messages
          WHERE conversation_id = :id AND role = 'assistant' AND intent IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`,
        { replacements: { id: conversationId } },
      );
      const priorTurn = lastRealTurnRow?.intent
        ? { intent: lastRealTurnRow.intent, params: lastRealTurnRow.params }
        : null;
      result = await answerQuestion({ sequelize: analyticsSequelize, req, question, priorTurn });
    }

    const userMsgId = uuidv4();
    const assistantMsgId = uuidv4();
    const paramsToStore = result.dateRange
      ? { start: result.dateRange.start, end: result.dateRange.end, label: result.dateRange.label, doctorId: result.doctorEntity?.id || null }
      : null;

    await sequelize.query(
      `INSERT INTO chatbot_messages (id, conversation_id, role, content) VALUES (:id, :cid, 'user', :content)`,
      { replacements: { id: userMsgId, cid: conversationId, content: question } },
    );
    await sequelize.query(
      `INSERT INTO chatbot_messages (id, conversation_id, role, content, intent, params)
       VALUES (:id, :cid, 'assistant', :content, :intent, :params)`,
      {
        replacements: {
          id: assistantMsgId,
          cid: conversationId,
          content: result.text,
          intent: result.intentKey || null,
          params: paramsToStore ? JSON.stringify(paramsToStore) : null,
        },
      },
    );
    await sequelize.query(`UPDATE chatbot_conversations SET updated_at = NOW() WHERE id = :id`, { replacements: { id: conversationId } });

    // Audit trail: which tools/intent resolved the question and row counts
    // only — deliberately never the question text itself (a user could type
    // anything, including something that names a patient) nor the query
    // result/model prose. `tools` (LLM mode) already carries each call's
    // resultSummary — a row-count-only shape, see llmEngine.js's
    // summarizeToolResult — never the actual values.
    try {
      const rr = require('./reports');
      await rr.logAudit({
        req, clinic_id: req.user.clinicId, user_id: req.user.id, user_name: req.user.displayName, user_role: req.user.role,
        module: 'Analytics', action: 'ANALYTICS_CHATBOT_QUERY', entity_type: 'ChatbotConversation', entity_id: conversationId,
        description: `Analytics Assistant question (${engineUsed} engine)`,
        new_values: engineUsed === 'llm'
          ? { engine: 'llm', tools: result.toolCalls }
          : { engine: 'keyword', intent: result.intentKey, dateLabel: result.dateRange?.label },
      });
    } catch (e) { /* audit failure must never block the request itself */ }

    res.json({
      conversationId,
      reply: { text: result.text, table: result.table || null, suggestions: result.suggestions || null },
      intent: result.intentKey,
      // Tells the UI whether to show "running in basic mode" — only
      // meaningful when LLM mode is actually enabled for this deployment;
      // if it was never enabled, the keyword engine answering isn't a
      // fallback, it's just how the feature normally runs.
      engine: engineUsed,
      llmEnabled: llmEngine.featureEnabled(),
    });
  } catch (error) {
    console.error('Error answering chatbot question:', error.message);
    res.status(500).json({ error: 'Failed to answer question' });
  }
});

module.exports = router;

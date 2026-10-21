const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { chatbotLimiter } = require('../middleware/rateLimiters');
const { answerQuestion, hasPrivilege } = require('../services/analyticsChatbot/chatbotEngine');
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

router.post('/ask', chatbotLimiter, async (req, res) => {
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

    // Follow-up context: the last assistant message in THIS conversation,
    // if any — see chatbotEngine.js's answerQuestion for exactly which
    // pieces of it get inherited when the new question doesn't specify
    // them itself. Permission is still re-checked fresh every turn there,
    // regardless of what this stored context contains.
    const [[lastAssistantRow]] = await sequelize.query(
      `SELECT intent, params FROM chatbot_messages
        WHERE conversation_id = :id AND role = 'assistant'
        ORDER BY created_at DESC LIMIT 1`,
      { replacements: { id: conversationId } },
    );
    const priorTurn = lastAssistantRow?.intent
      ? { intent: lastAssistantRow.intent, params: lastAssistantRow.params }
      : null;

    const result = await answerQuestion({ sequelize, req, question, priorTurn });

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

    // Audit trail: the question and the resolved intent/params, never the
    // query result itself — same convention clinicalInsights.js uses for
    // its own AI-feature audit entries.
    try {
      const rr = require('./reports');
      await rr.logAudit({
        req, clinic_id: req.user.clinicId, user_id: req.user.id, user_name: req.user.displayName, user_role: req.user.role,
        module: 'Analytics', action: 'ANALYTICS_CHATBOT_QUERY', entity_type: 'ChatbotConversation', entity_id: conversationId,
        description: question,
        new_values: { intent: result.intentKey, dateLabel: result.dateRange?.label },
      });
    } catch (e) { /* audit failure must never block the request itself */ }

    res.json({
      conversationId,
      reply: { text: result.text, table: result.table || null, suggestions: result.suggestions || null },
      intent: result.intentKey,
    });
  } catch (error) {
    console.error('Error answering chatbot question:', error.message);
    res.status(500).json({ error: 'Failed to answer question' });
  }
});

module.exports = router;

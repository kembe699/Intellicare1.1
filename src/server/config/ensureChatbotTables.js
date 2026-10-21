/**
 * DDL only — creates the Analytics Assistant's conversation-history tables
 * if they don't exist yet. Same shape as ensureClinicalInsightsTable.js/
 * ensureNotificationsTable.js: safe to call repeatedly, safe to call
 * per-tenant (see tenantDb.js's buildTenantConnection for why per-tenant
 * call sites, not a one-off boot migration, are how a brand-new table
 * actually reaches every schema).
 *
 * Conversations are per-user (not shared clinic-wide state) — "keep history
 * like a real chat" means each user's own chat history, the same way
 * ChatGPT's sidebar is scoped to the signed-in account, not to everyone who
 * uses the product. clinic_id/branch_id are still stamped on each
 * conversation for defense-in-depth auditing, even though schema-per-tenant
 * already isolates one hospital's data from another's.
 *
 * chatbot_messages.params stores the resolved intent/date-range/entities for
 * an assistant reply (JSONB) — this is what lets a follow-up question like
 * "what about yesterday?" inherit the prior turn's intent without the
 * conversation needing any server-side session state (see
 * services/analyticsChatbot/chatbotEngine.js). It never stores raw query
 * results or patient-level data, only the resolved parameters.
 */
async function ensureChatbotTables(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS chatbot_conversations (
      id VARCHAR(36) PRIMARY KEY,
      user_id INTEGER NOT NULL,
      clinic_id INTEGER,
      branch_id INTEGER,
      title VARCHAR(255) NOT NULL DEFAULT 'New conversation',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_user ON chatbot_conversations(user_id, updated_at DESC)
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS chatbot_messages (
      id VARCHAR(36) PRIMARY KEY,
      conversation_id VARCHAR(36) NOT NULL REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      intent VARCHAR(50),
      params JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS idx_chatbot_messages_conversation ON chatbot_messages(conversation_id, created_at ASC)
  `);
}

module.exports = { ensureChatbotTables };

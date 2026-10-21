/**
 * The Analytics Assistant's LLM-backed understanding layer — Claude decides
 * which (if any) of llmTools.js's fixed, read-only, permission-checked
 * functions to call and with what arguments, then phrases the final answer
 * from their real results. This is what makes the assistant understand
 * open-ended phrasing instead of only the keyword patterns in
 * intentPatterns.js — but the safety properties are unchanged from the
 * deterministic engine:
 *
 *   - Claude never gets database access, raw SQL, or any ability to write.
 *     Its only capability is calling one of llmTools.js's named functions —
 *     the same allowlist the deterministic engine (chatbotEngine.js) uses.
 *   - Every number in the final answer must come from a tool_result. The
 *     system prompt says so explicitly, and llmTools.js's permission checks
 *     (accounting.read for anything financial) run server-side BEFORE a
 *     query executes — a denial reaches Claude as ordinary data
 *     ({error: 'permission_denied'}) to relay honestly, never something it
 *     could compute around.
 *   - No raw SQL, ever — llmTools.executeTool only ever calls
 *     analyticsFunctions.js's fixed, parameterized queries.
 *
 * Goes through the shared client (services/ai/anthropicClient.js, the
 * official @anthropic-ai/sdk) rather than raw fetch — isTimeout/
 * isConfigError/isApiError error tagging and the feature flag/mock mode
 * are unchanged, but runs synchronously within the request instead of
 * fire-and-forget (unlike ClinicalInsightsService.js), since a chat reply
 * has nowhere else to go. If this engine is disabled, errors, or times out,
 * routes/analyticsChatbot.js falls back to the deterministic keyword engine
 * (chatbotEngine.js) so the feature keeps working either way.
 */
const { TOOLS, executeTool } = require('./llmTools');
const anthropicClient = require('../ai/anthropicClient');

const MODEL_DEFAULT = process.env.ANALYTICS_CHATBOT_MODEL || 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 4;
const MAX_HISTORY_MESSAGES = 16; // ~8 user/assistant turns of context, bounds token cost

function featureEnabled() {
  return process.env.ANALYTICS_CHATBOT_LLM_ENABLED === 'true';
}

function isMockMode() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ANALYTICS_CHATBOT_MOCK === 'true';
}

function systemPrompt(now) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `You are the Analytics Assistant inside IntelliCare, a hospital management system. You answer hospital staff's questions about registrations, visits, revenue, doctor activity, and department/category billing breakdowns, using ONLY the tools provided.

Today's date is ${today} (the hospital's own server-local time — there is no separate facility timezone configured). "this_week" means the rolling 7 days ending today, and "this_month" means the 1st of the current month through today — these deliberately match the Dashboard's own Today/This Week/This Month filters, not an ISO calendar week.

Hard rules:
- Every number, count, or amount in your answer MUST come from a tool result. Never state, estimate, compute, or recall a figure that didn't appear in a tool_result. If you're unsure a question is answerable with the available tools, say so plainly rather than guessing.
- If a tool result contains {error: "permission_denied"}, tell the user plainly they don't have access to that data (e.g. financial figures require accounting access) — don't retry, don't work around it, don't imply the number exists but is just hidden.
- There is no tool for revenue per doctor — patient bills aren't linked to a doctor at all in this system. If asked, say so plainly; don't approximate it from other tools.
- For a question outside what these tools cover (e.g. inventory stock levels, a specific patient's record, appointments, HR) say plainly that you can currently only help with registrations, visits, revenue, department breakdowns, and doctor activity — don't guess at an answer from outside your tools.
- Use the full conversation history for follow-ups ("what about yesterday?" means re-run the same kind of question for a different period; "what date range was that?" or "what can you do?" can be answered directly from what you already said, with no new tool call).
- Keep answers brief and direct — a sentence or two, like a colleague giving a quick number, not a report. Use a short table only when listing several items (e.g. a doctor ranking or a department breakdown) genuinely helps.
- Currency amounts: state the currency code the tool gave you, formatted plainly (e.g. "SSP 4,250,000.00").
- Formatting: never use an em dash (—) anywhere in your reply. Use a period, comma, colon, or semicolon instead.`;
}

function toAnthropicTools() {
  return TOOLS.map((t) => ({
    ...t,
    strict: true,
    input_schema: { ...t.input_schema, additionalProperties: false },
  }));
}

const MOCK_TEXT = "Mock response. No real model was called (ANALYTICS_CHATBOT_MOCK=true).";

async function callAnthropic(body) {
  if (isMockMode()) {
    return { content: [{ type: 'text', text: MOCK_TEXT }], stop_reason: 'end_turn' };
  }
  const client = anthropicClient.getClient();
  if (!client) {
    const err = new Error('Analytics Assistant LLM mode is not fully configured (no ANTHROPIC_API_KEY)');
    err.isConfigError = true;
    throw err;
  }
  try {
    // `body` is already the exact Messages API request shape (model,
    // max_tokens, system, output_config, tools, tool_choice, messages) —
    // the SDK's create() takes the same field names, so this is a direct
    // pass-through and the response has the same shape callers already read
    // (response.stop_reason, response.content, ...).
    return await client.messages.create(body);
  } catch (e) {
    const described = anthropicClient.describeError(e);
    // Never log the request/response body — it can contain hospital
    // activity data; type + status + Anthropic's own error message is
    // enough to diagnose from server logs.
    console.error(`Analytics Assistant Anthropic call failed: ${described.type} (status ${described.status})`, described.message);
    if (described.type === 'timeout_error') {
      const err = new Error('Request to the model timed out');
      err.isTimeout = true;
      throw err;
    }
    const err = new Error(`Anthropic API error: ${described.type}`);
    err.isApiError = true;
    throw err;
  }
}

/**
 * `history` is the conversation's prior turns as `{role: 'user'|'assistant',
 * content: string}[]` (oldest first), already capped by the caller's own DB
 * query — trimmed again here as a second bound. Returns
 * `{ text, toolCalls: [{name, input}] }` — `toolCalls` is for the route's
 * audit log only (which tools ran, with what period — never the prose).
 */
async function answerQuestion({ sequelize, req, question, history, clinicId }) {
  const now = new Date();
  const messages = [
    ...history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAnthropic({
      model: MODEL_DEFAULT,
      max_tokens: 4096,
      system: systemPrompt(now),
      output_config: { effort: 'low' }, // a quick tool-routing + short-reply task, not deep reasoning — see cost-optimization guidance
      tools: toAnthropicTools(),
      tool_choice: { type: 'auto' },
      messages,
    });

    if (response.stop_reason === 'refusal') {
      const err = new Error('The model declined to answer this question');
      err.isApiError = true;
      throw err;
    }

    const toolUseBlocks = (response.content || []).filter((c) => c.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      const text = (response.content || []).find((c) => c.type === 'text')?.text || '';
      return { text: text.trim() || "I wasn't able to put together an answer for that. Could you rephrase?", toolCalls };
    }

    // Execute every tool call from this turn, then return ALL results in one
    // user message (never split across messages — see claude-api skill's
    // "Parallel tool use" guidance, which warns that splitting them silently
    // trains the model to stop calling tools in parallel).
    messages.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const block of toolUseBlocks) {
      toolCalls.push({ name: block.name, input: block.input });
      let result;
      try {
        result = await executeTool(block.name, block.input, { sequelize, req, clinicId });
      } catch (e) {
        result = { error: 'tool_execution_failed', message: e.message };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // MAX_TOOL_ROUNDS exhausted without a final text answer — bounded failure,
  // not an infinite loop; fall back rather than hang the request.
  const err = new Error('The model could not settle on an answer within the allowed number of steps');
  err.isApiError = true;
  throw err;
}

module.exports = { answerQuestion, featureEnabled, isMockMode, MODEL_DEFAULT };

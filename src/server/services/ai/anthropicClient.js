/**
 * Shared Anthropic client — the one place every Anthropic-backed feature
 * (Clinical Insights, the Analytics Assistant's LLM mode) constructs its
 * client and resolves its model/timeout config from, through the official
 * @anthropic-ai/sdk rather than raw fetch. Centralizing this is what lets
 * GET /api/admin/ai/health and the startup log line speak for every caller,
 * not just one, and is where retry/error handling lives exactly once.
 *
 * Retries: the SDK's own `maxRetries` already retries 408/409/429/5xx and
 * connection errors with exponential backoff — see its Client config docs —
 * so there is deliberately no hand-rolled retry loop here.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL_DEFAULT = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS, 10) || 60 * 1000;
const MAX_RETRIES = 3;

let cachedClient = null;

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!isConfigured()) return null;
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    });
  }
  return cachedClient;
}

function getDefaultModel() {
  return MODEL_DEFAULT;
}

// Normalizes any error the SDK can throw into a small, loggable, non-
// sensitive shape — never the request body (may carry patient/hospital
// data) or the API key, just enough to diagnose which failure mode this
// was from server logs. Order matters: check the most specific error class
// first (see the SDK's own error hierarchy — APIConnectionError and the
// rest all extend APIError).
function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return { type: 'authentication_error', status: 401, message: error.message, retryable: false };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { type: 'permission_error', status: 403, message: error.message, retryable: false };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { type: 'not_found_error', status: 404, message: error.message, retryable: false };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { type: 'rate_limit_error', status: 429, message: error.message, retryable: true };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { type: 'invalid_request_error', status: 400, message: error.message, retryable: false };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return { type: 'api_error', status: error.status || 500, message: error.message, retryable: true };
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { type: 'timeout_error', status: null, message: error.message, retryable: true };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { type: 'connection_error', status: null, message: error.message, retryable: true };
  }
  if (error instanceof Anthropic.APIError) {
    // Catches API error subclasses with no dedicated branch above (e.g.
    // UnprocessableEntityError/422) — `error.name` is just "Error" on every
    // subclass in this SDK (never overridden), so the status code is the
    // only reliable way to label an unmatched one.
    const status = error.status;
    return { type: `api_error_${status ?? 'unknown'}`, status, message: error.message, retryable: status === 429 || (status >= 500 && status < 600) };
  }
  return { type: 'unknown_error', status: null, message: error && error.message ? error.message : String(error), retryable: false };
}

// A tiny, cheap call used by the admin health check and the startup log —
// not a real clinical/chatbot request, just enough to prove the key, model
// ID, and network path actually work end to end.
async function ping() {
  const client = getClient();
  if (!client) {
    return { ok: false, error: { type: 'not_configured', status: null, message: 'ANTHROPIC_API_KEY is not set', retryable: false } };
  }
  try {
    const response = await client.messages.create({
      model: getDefaultModel(),
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
    });
    const text = (response.content || []).find((b) => b.type === 'text')?.text || '';
    return { ok: true, model: response.model, repliedOk: text.trim().toLowerCase().includes('ok') };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

module.exports = { Anthropic, getClient, isConfigured, getDefaultModel, describeError, ping };

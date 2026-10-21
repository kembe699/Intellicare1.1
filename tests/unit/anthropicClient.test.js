/**
 * The shared Anthropic client (src/server/services/ai/anthropicClient.js) —
 * every Anthropic-backed feature (Clinical Insights, the Analytics
 * Assistant's LLM mode) goes through this one module for its client
 * construction, model/timeout config, and error classification. No real
 * network call is ever made here — the Anthropic SDK's constructor and
 * `messages.create` are mocked, and describeError() is exercised against
 * real instances of the SDK's own typed error classes (plain data classes,
 * safe to construct directly) rather than hand-rolled fakes.
 */
// Captured once, at file-load time — NOT inside the mock factory below.
// jest.resetModules() (used between tests so env-var changes take effect on
// a fresh require of the client module) clears the module registry, so a
// jest.requireActual() call made *inside* the factory would re-execute the
// real SDK's source on every reset and hand back a brand-new set of class
// objects each time — meaning `new RealAnthropic.RateLimitError(...)`
// constructed here and the client module's own `instanceof
// Anthropic.RateLimitError` check would silently compare against two
// different classes and never match. Capturing it once up front and having
// the factory reuse this same reference (never the real SDK) keeps class
// identity (and `instanceof`) stable across every reset, and guarantees the
// real module's own constructor — which would make a genuine network call —
// never gets reached even after a reset.
const mockRealAnthropic = jest.requireActual('@anthropic-ai/sdk');
const RealAnthropic = mockRealAnthropic;

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  function MockAnthropicCtor() {
    return { messages: { create: mockCreate } };
  }
  // Carry over every named export (the error classes, etc.) so
  // `instanceof Anthropic.RateLimitError` checks inside the module under
  // test keep working against the exact same classes this file constructs
  // its own test fixtures from.
  return Object.assign(MockAnthropicCtor, mockRealAnthropic);
});

describe('anthropicClient', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockCreate.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('isConfigured / getDefaultModel / getClient', () => {
    test('isConfigured is false with no ANTHROPIC_API_KEY', () => {
      const client = require('../../src/server/services/ai/anthropicClient');
      expect(client.isConfigured()).toBe(false);
    });

    test('isConfigured is true once ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const client = require('../../src/server/services/ai/anthropicClient');
      expect(client.isConfigured()).toBe(true);
    });

    test('getDefaultModel falls back to a current model ID when ANTHROPIC_MODEL is unset', () => {
      const client = require('../../src/server/services/ai/anthropicClient');
      expect(client.getDefaultModel()).toBe('claude-sonnet-5-5');
    });

    test('getDefaultModel respects ANTHROPIC_MODEL when set', () => {
      process.env.ANTHROPIC_MODEL = 'claude-haiku-5-5';
      const client = require('../../src/server/services/ai/anthropicClient');
      expect(client.getDefaultModel()).toBe('claude-haiku-5-5');
    });

    test('getClient returns null when not configured — never silently constructs a keyless client', () => {
      const client = require('../../src/server/services/ai/anthropicClient');
      expect(client.getClient()).toBeNull();
    });

    test('getClient returns a usable client once configured', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const client = require('../../src/server/services/ai/anthropicClient');
      const instance = client.getClient();
      expect(instance).not.toBeNull();
      expect(typeof instance.messages.create).toBe('function');
    });

    test('getClient caches the instance rather than constructing a new one per call', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const client = require('../../src/server/services/ai/anthropicClient');
      expect(client.getClient()).toBe(client.getClient());
    });
  });

  describe('describeError — classifies every SDK error type, never leaks a request/response body', () => {
    let client;
    beforeEach(() => {
      client = require('../../src/server/services/ai/anthropicClient');
    });

    test('AuthenticationError (401, bad/revoked key)', () => {
      const err = new RealAnthropic.AuthenticationError(401, { message: 'invalid x-api-key' }, 'invalid x-api-key', undefined);
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'authentication_error', status: 401, retryable: false });
    });

    test('PermissionDeniedError (403)', () => {
      const err = new RealAnthropic.PermissionDeniedError(403, { message: 'forbidden' }, 'forbidden', undefined);
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'permission_error', status: 403, retryable: false });
    });

    test('NotFoundError (404, e.g. an invalid/stale model ID)', () => {
      const err = new RealAnthropic.NotFoundError(404, { message: 'model: claude-sonnet-5-not-real' }, 'model: claude-sonnet-5-not-real', undefined);
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'not_found_error', status: 404, retryable: false });
    });

    test('RateLimitError (429) is retryable', () => {
      const err = new RealAnthropic.RateLimitError(429, { message: 'rate limited' }, 'rate limited', undefined);
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'rate_limit_error', status: 429, retryable: true });
    });

    test('BadRequestError (400, malformed request)', () => {
      const err = new RealAnthropic.BadRequestError(400, { message: 'bad request' }, 'bad request', undefined);
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'invalid_request_error', status: 400, retryable: false });
    });

    test('InternalServerError (500/overloaded) is retryable', () => {
      const err = new RealAnthropic.InternalServerError(500, { message: 'internal error' }, 'internal error', undefined);
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'api_error', status: 500, retryable: true });
    });

    test('APIConnectionTimeoutError is its own distinct, retryable type', () => {
      const err = new RealAnthropic.APIConnectionTimeoutError({ message: 'Request timed out.' });
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'timeout_error', retryable: true });
    });

    test('a plain network failure (APIConnectionError) is retryable', () => {
      const err = new RealAnthropic.APIConnectionError({ message: 'Connection error.' });
      const described = client.describeError(err);
      expect(described).toMatchObject({ type: 'connection_error', retryable: true });
    });

    test('an unrecognized APIError subclass still classifies by status, never crashes on a missing .name', () => {
      const err = new RealAnthropic.UnprocessableEntityError(422, { message: 'unprocessable' }, 'unprocessable', undefined);
      const described = client.describeError(err);
      expect(described.type).toBe('api_error_422');
      expect(described.status).toBe(422);
    });

    test('a completely unrelated thrown value never crashes describeError', () => {
      const described = client.describeError(new Error('something unrelated blew up'));
      expect(described).toMatchObject({ type: 'unknown_error', retryable: false });
      expect(described.message).toMatch(/unrelated/);
    });

    test('describeError never includes a `body`/`payload`/`request` field — only type/status/message/retryable', () => {
      const err = new RealAnthropic.RateLimitError(429, { message: 'rate limited' }, 'rate limited', undefined);
      const described = client.describeError(err);
      expect(described.type).toBe('rate_limit_error');
      expect(Object.keys(described).sort()).toEqual(['message', 'retryable', 'status', 'type']);
    });
  });

  describe('ping — the admin health check\'s underlying call', () => {
    test('reports not_configured without ever calling the SDK, when no key is set', async () => {
      const client = require('../../src/server/services/ai/anthropicClient');
      const result = await client.ping();
      expect(result).toEqual({ ok: false, error: { type: 'not_configured', status: null, message: 'ANTHROPIC_API_KEY is not set', retryable: false } });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('reports ok:true on a successful tiny call, without ever logging the response body', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      mockCreate.mockResolvedValue({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Ok' }] });
      const client = require('../../src/server/services/ai/anthropicClient');
      const result = await client.ping();
      expect(result).toEqual({ ok: true, model: 'claude-sonnet-5-5', repliedOk: true });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test('reports a classified error on failure, via the exact same describeError path', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      mockCreate.mockRejectedValue(new RealAnthropic.AuthenticationError(401, { message: 'invalid x-api-key' }, 'invalid x-api-key', undefined));
      const client = require('../../src/server/services/ai/anthropicClient');
      const result = await client.ping();
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({ type: 'authentication_error', status: 401 });
    });
  });
});

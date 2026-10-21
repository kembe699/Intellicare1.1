/**
 * The Analytics Assistant's dedicated read-only Postgres role — a second,
 * independent layer of defense alongside the application-level permission
 * checks in llmTools.js. Entirely opt-in via DB_READONLY_PASSWORD; both the
 * role/grant DDL (ensureAnalyticsReadOnlyRole.js) and the connection
 * factory (tenantDb.js's getReadOnlyTenantConnection) must no-op cleanly
 * when it isn't set, since this feature is never required for the
 * assistant to work. No real Postgres connection is made in this file —
 * `sequelize.query` is a mock throughout.
 */
describe('ensureAnalyticsReadOnlyRole', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('isConfigured reflects DB_READONLY_PASSWORD presence', () => {
    delete process.env.DB_READONLY_PASSWORD;
    const mod1 = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    expect(mod1.isConfigured()).toBe(false);

    jest.resetModules();
    process.env.DB_READONLY_PASSWORD = 'a-real-password';
    const mod2 = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    expect(mod2.isConfigured()).toBe(true);
  });

  test('ensureReadOnlyRole never touches the database when unconfigured', async () => {
    delete process.env.DB_READONLY_PASSWORD;
    const { ensureReadOnlyRole } = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    const query = jest.fn();
    await ensureReadOnlyRole({ query });
    expect(query).not.toHaveBeenCalled();
  });

  test('ensureReadOnlyRole runs idempotent CREATE ROLE DDL naming the fixed role when configured', async () => {
    process.env.DB_READONLY_PASSWORD = 'a-real-password';
    const { ensureReadOnlyRole, READONLY_ROLE } = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    const query = jest.fn().mockResolvedValue(undefined);
    await ensureReadOnlyRole({ query });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain(READONLY_ROLE);
    expect(sql).toContain('CREATE ROLE');
    expect(sql).toContain('pg_roles'); // the existence check, confirming this is idempotent
  });

  test('ensureReadOnlyRole escapes a single quote in the password rather than breaking the DDL', async () => {
    process.env.DB_READONLY_PASSWORD = "it's a password";
    const { ensureReadOnlyRole } = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    const query = jest.fn().mockResolvedValue(undefined);
    await ensureReadOnlyRole({ query });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("it''s a password"); // doubled, the standard SQL escape
    expect(sql).not.toMatch(/[^']it's a password/); // the raw unescaped form never appears
  });

  test('ensureReadOnlyRole only runs once per process even across multiple calls', async () => {
    process.env.DB_READONLY_PASSWORD = 'a-real-password';
    const { ensureReadOnlyRole } = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    const query = jest.fn().mockResolvedValue(undefined);
    await ensureReadOnlyRole({ query });
    await ensureReadOnlyRole({ query });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('grantReadOnlySelect never touches the database when unconfigured', async () => {
    delete process.env.DB_READONLY_PASSWORD;
    const { grantReadOnlySelect } = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    const query = jest.fn();
    await grantReadOnlySelect({ query }, 'some_tenant_schema');
    expect(query).not.toHaveBeenCalled();
  });

  test('grantReadOnlySelect grants USAGE, SELECT on all tables, and a default-privileges rule, all naming the given schema', async () => {
    process.env.DB_READONLY_PASSWORD = 'a-real-password';
    const { grantReadOnlySelect, READONLY_ROLE } = require('../../src/server/config/ensureAnalyticsReadOnlyRole');
    const query = jest.fn().mockResolvedValue(undefined);
    await grantReadOnlySelect({ query }, 'hospital_abc');
    // First call is the idempotent role check (ensureReadOnlyRole runs first), then the 3 grants.
    const sqls = query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes('GRANT USAGE ON SCHEMA "hospital_abc"') && s.includes(READONLY_ROLE))).toBe(true);
    expect(sqls.some((s) => s.includes('GRANT SELECT ON ALL TABLES IN SCHEMA "hospital_abc"') && s.includes(READONLY_ROLE))).toBe(true);
    expect(sqls.some((s) => s.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA "hospital_abc"') && s.includes(READONLY_ROLE))).toBe(true);
  });
});

describe('tenantDb.getReadOnlyTenantConnection', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns null without ever attempting a real connection when DB_READONLY_PASSWORD is unset', async () => {
    delete process.env.DB_READONLY_PASSWORD;
    const { getReadOnlyTenantConnection } = require('../../src/server/tenantDb');
    const result = await getReadOnlyTenantConnection('some_tenant_schema');
    expect(result).toBeNull();
  });
});

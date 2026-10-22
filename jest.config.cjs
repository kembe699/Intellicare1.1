/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  transform: {},
  // Was "setupFilesAfterSetup" — not a real Jest option (triggered the
  // "Unknown option" validation warning on every single test run). Now
  // actually wires in per-file tenant-connection cleanup — see
  // tests/setup/closeTenantConnections.js.
  setupFilesAfterEnv: ['<rootDir>/tests/setup/closeTenantConnections.js'],
  maxWorkers: 1,
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  reporters: [
    'default',
    ['./tests/reporters/jsonReporter.cjs', {}],
  ],
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      testEnvironment: 'node',
      // The server (src/server) and the repo root each install their own
      // independent copy of @anthropic-ai/sdk (no npm workspace ties them
      // together) — without this mapping, a test's jest.mock('@anthropic-ai/sdk')
      // registers against the root copy while src/server/services/ai/
      // anthropicClient.js resolves the server's own copy, so the mock
      // silently never applies and `instanceof` checks against the SDK's
      // error classes never match across the two separate class objects.
      // Pinning both to the one physical install the server actually runs
      // keeps class identity — and the mock — consistent.
      moduleNameMapper: {
        '^@anthropic-ai/sdk$': '<rootDir>/src/server/node_modules/@anthropic-ai/sdk',
      },
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
      // See tests/setup/allowDbEnvOverride.js — a true no-op for a normal
      // run against the configured tenant_test database; it only matters
      // when DB_* env vars are already set before jest starts (e.g.
      // pointing a one-off local run at a different Postgres instance).
      setupFiles: ['<rootDir>/tests/setup/allowDbEnvOverride.js'],
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/tests/e2e/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integrity',
      testMatch: ['<rootDir>/tests/integrity/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'performance',
      testMatch: ['<rootDir>/tests/performance/**/*.test.js'],
      testEnvironment: 'node',
    },
  ],
};

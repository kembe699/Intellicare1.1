/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  transform: {},
  setupFilesAfterSetup: [],
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
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
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

// Registered via jest.config.cjs's setupFilesAfterEnv — runs once per test
// FILE (Jest gives every file its own fresh module registry, so this file's
// own `require` of tenantDb.js sees the SAME cached `connections` Map that
// file's own tests populated via getTenantConnection). Closes every tenant
// connection pool that file opened as soon as its tests finish, instead of
// leaving it to the pool's own 10s idle timeout — see tenantDb.js's
// closeAllConnections for why that timeout alone isn't fast enough across a
// 60+ file suite and lets open connections accumulate past Postgres's
// max_connections well before the full run completes.
afterAll(async () => {
  try {
    const { closeAllConnections } = require('../../src/server/tenantDb');
    await closeAllConnections();
  } catch (e) {
    // Best-effort — a cleanup failure must never fail the test file itself.
  }
});

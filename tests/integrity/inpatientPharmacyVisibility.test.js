/**
 * An inpatient prescription for an admitted patient was not showing up on
 * /pharmacy-prescriptions for branch-scoped pharmacists, and even for
 * unscoped admins it could take up to 60s to appear. Two independent causes:
 *
 * 1. bustPharmacyCache()/bustInventoryCache() passed delPattern() a pattern
 *    ('|pharmacy' / '|inventory') that never occurs in a real cache key
 *    (`ic|${schema}|${userId}|${branchId}|${originalUrl}` — the URL segment
 *    is "/api/pharmacy-module/..." / "/api/inventory/...", never containing
 *    the literal substring "|pharmacy" or "|inventory"). Writes never
 *    invalidated the 60s response cache.
 * 2. mirrorPrescriptionToPharmacy() (inpatient.js) inserted pharmacy_prescriptions
 *    rows with no branch_id at all. GET /pharmacy-module/prescriptions
 *    branch-scopes with `AND pp.branch_id = :branchId` for any non-admin —
 *    a NULL branch_id never matches, so a branch-scoped pharmacist never saw
 *    the row, regardless of caching.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('RedisCache.delPattern matches the real cache key shape', () => {
  const redisCache = require('../../src/server/services/RedisCache');

  // Exercise the in-memory fallback directly (REDIS_ENABLED is not set in
  // the test environment), which uses the exact same k.includes(pattern)
  // logic the Redis-glob branch also derives from.
  const realKey = 'ic|tenant_demo|user-123|branch-456|/api/pharmacy-module/prescriptions?admission_id=abc';

  test('the fixed whole-tenant-flush pattern matches a real key', async () => {
    redisCache.fallback.set(realKey, { data: 1, exp: Date.now() + 60000 });
    await redisCache.delPattern('ic|tenant_demo|');
    expect(redisCache.fallback.has(realKey)).toBe(false);
  });

  test('the old broken "|pharmacy" pattern never matches a real key', async () => {
    redisCache.fallback.set(realKey, { data: 1, exp: Date.now() + 60000 });
    await redisCache.delPattern('|pharmacy');
    expect(redisCache.fallback.has(realKey)).toBe(true);
    redisCache.fallback.delete(realKey);
  });

  test('the old broken "|inventory" pattern never matches a real key', async () => {
    const invKey = 'ic|tenant_demo|user-123|branch-456|/api/inventory/items';
    redisCache.fallback.set(invKey, { data: 1, exp: Date.now() + 60000 });
    await redisCache.delPattern('|inventory');
    expect(redisCache.fallback.has(invKey)).toBe(true);
    redisCache.fallback.delete(invKey);
  });
});

describe('pharmacyModule.js cache invalidation is actually wired up', () => {
  const src = read('src/server/routes/pharmacyModule.js');

  test('bustPharmacyCache uses the whole-tenant-flush pattern, not the broken one', () => {
    const fnSrc = src.slice(src.indexOf('function bustPharmacyCache'), src.indexOf('function bustPharmacyCache') + 300);
    expect(fnSrc).toMatch(/delPattern\(`ic\|\$\{req\.tenantSchema\}\|`\)/);
    expect(fnSrc).not.toMatch(/delPattern\('\|pharmacy'\)/);
  });

  test('bustPharmacyCache is actually called after POST /prescriptions succeeds', () => {
    const postRx = src.slice(src.indexOf("router.post('/prescriptions'"), src.indexOf("router.put('/prescriptions/:id'"));
    expect(postRx).toMatch(/bustPharmacyCache\(req\)/);
  });

  test('bustPharmacyCache is actually called after POST /dispensing commits', () => {
    const postDispense = src.slice(src.indexOf("router.post('/dispensing'"), src.indexOf("router.get('/returns'"));
    expect(postDispense).toMatch(/await t\.commit\(\);[\s\S]{0,500}bustPharmacyCache\(req\)/);
  });
});

describe('inventory.js cache invalidation uses the fixed pattern', () => {
  const src = read('src/server/routes/inventory.js');

  test('bustInventoryCache uses the whole-tenant-flush pattern, not the broken one', () => {
    const fnSrc = src.slice(src.indexOf('function bustInventoryCache'), src.indexOf('function bustInventoryCache') + 300);
    expect(fnSrc).toMatch(/delPattern\(`ic\|\$\{req\.tenantSchema\}\|`\)/);
    expect(fnSrc).not.toMatch(/delPattern\('\|inventory'\)/);
  });
});

describe('inpatient.js prescription mirror and visibility', () => {
  const src = read('src/server/routes/inpatient.js');

  test('mirrorPrescriptionToPharmacy takes a branchId parameter', () => {
    const sig = src.slice(src.indexOf('async function mirrorPrescriptionToPharmacy'), src.indexOf('async function mirrorPrescriptionToPharmacy') + 200);
    expect(sig).toMatch(/branchId\s*\)\s*\{/);
  });

  test("the pharmacy_prescriptions INSERT inside the mirror includes branch_id", () => {
    const fnBody = src.slice(src.indexOf('async function mirrorPrescriptionToPharmacy'), src.indexOf('async function mirrorPrescriptionToPharmacy') + 3000);
    const insertStmt = fnBody.slice(fnBody.indexOf('INSERT INTO pharmacy_prescriptions'), fnBody.indexOf('INSERT INTO prescription_lines'));
    expect(insertStmt).toMatch(/branch_id/);
    expect(insertStmt).toMatch(/:branchId/);
  });

  test("POST /prescriptions passes branchId through to the mirror call", () => {
    const postRx = src.slice(src.indexOf("router.post('/prescriptions'"), src.indexOf("router.put('/prescriptions/:id'"));
    expect(postRx).toMatch(/mirrorPrescriptionToPharmacy\(\s*[\s\S]*?,\s*branchId\s*\)/);
  });

  test("POST /prescriptions busts the tenant cache after success", () => {
    const postRx = src.slice(src.indexOf("router.post('/prescriptions'"), src.indexOf("router.put('/prescriptions/:id'"));
    expect(postRx).toMatch(/redisCache\.delPattern\(`ic\|\$\{req\.tenantSchema\}\|`\)/);
  });

  test("POST /prescriptions response includes pharmacy_line_id", () => {
    const postRx = src.slice(src.indexOf("router.post('/prescriptions'"), src.indexOf("router.put('/prescriptions/:id'"));
    expect(postRx).toMatch(/pharmacy_line_id:\s*pharmacyLineId/);
  });
});

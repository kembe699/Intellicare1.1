/**
 * DPOC-only Radiology module: a standalone request/report queue for the LIS
 * (outpatient) flow, plus a Radiology picker and Request Admission button
 * added to the LIS "Place Order" screen — both gated to dpoc via
 * user.tenantCode, not touching Visit Summary at all.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('radiology.js route gates', () => {
  const src = read('src/server/routes/radiology.js');

  test('exam-types is gated on radiology.read', () => {
    expect(src).toMatch(/router\.get\('\/exam-types',\s*authorize\('radiology\.read'\)/);
  });

  test('request creation rides on lis.clinical.write (the same privilege placing an LIS order requires), not radiology.write', () => {
    const postSection = src.slice(src.indexOf("router.post('/requests'"), src.indexOf("router.get('/requests'"));
    expect(postSection).toMatch(/authorize\('lis\.clinical\.write'\)/);
  });

  test('confirm and report actions are gated on radiology.write', () => {
    expect(src).toMatch(/router\.put\('\/requests\/:id\/confirm',\s*authorize\('radiology\.write'\)/);
    expect(src).toMatch(/router\.put\('\/requests\/:id\/report',\s*authorize\('radiology\.write'\)/);
  });

  test('confirm only transitions from pending, never re-confirms an already-confirmed request', () => {
    const confirmSection = src.slice(src.indexOf("/requests/:id/confirm"), src.indexOf("/requests/:id/report"));
    expect(confirmSection).toMatch(/WHERE id = :id AND status = 'pending'/);
  });

  test("report save only proceeds once a request has been confirmed (in_progress or completed), never straight from pending", () => {
    const reportSection = src.slice(src.indexOf("/requests/:id/report"), src.length);
    expect(reportSection).toMatch(/WHERE id = :id AND status IN \('in_progress', 'completed'\)/);
  });
});

describe('privilege catalog carries the new radiology keys', () => {
  const { PRIVILEGES, DEFAULT_ROLE_PRIVILEGES } = require('../../src/server/config/permissionsCatalog');

  test('radiology.read and radiology.write are registered', () => {
    const keys = PRIVILEGES.map((p) => p.privilege_key);
    expect(keys).toContain('radiology.read');
    expect(keys).toContain('radiology.write');
  });

  test('both default to admin/doctor/lab — dpoc has no dedicated radiographer role today', () => {
    expect(DEFAULT_ROLE_PRIVILEGES['radiology.read'].sort()).toEqual(['admin', 'doctor', 'lab'].sort());
    expect(DEFAULT_ROLE_PRIVILEGES['radiology.write'].sort()).toEqual(['admin', 'doctor', 'lab'].sort());
  });
});

describe('radiology_requests migration is registered like every other module migration', () => {
  test('is included in the background migration runner, wrapped in migrateAcrossTenants', () => {
    // A performance/correctness audit found this (and 12 other migrations)
    // called with no connection argument, meaning it only ever reached the
    // default tenant_template connection — same bug class already fixed for
    // addPerformanceIndexes.js/migrateTheatreTables.js/etc. Now wrapped the
    // same way, via migrateAcrossTenants.
    const src = read('src/server/index.js');
    expect(src).toMatch(/\['Radiology',\s*\(\) => require\('\.\/scripts\/migrateAcrossTenants'\)\.migrateAcrossTenants\(\s*\n\s*require\('\.\/scripts\/migrateRadiologyModule'\)\.migrateRadiologyModule,\s*'Radiology'\s*\n\s*\)\]/);
  });

  test('is included in the manual runAllMigrations script', () => {
    const src = read('src/server/scripts/runAllMigrations.js');
    expect(src).toMatch(/\['Radiology',\s*\(\) => require\('\.\/migrateRadiologyModule'\)\.migrateRadiologyModule\(\)\]/);
  });

  test('the table is created idempotently (IF NOT EXISTS), one row per exam not per order', () => {
    const src = read('src/server/scripts/migrateRadiologyModule.js');
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS radiology_requests/);
    expect(src).toMatch(/request_number VARCHAR\(50\) NOT NULL/);
  });
});

describe('radiology seed data lands in services under its own category', () => {
  test('seedRadiologyServices tags rows category=Radiology (kept out of the generic services list)', () => {
    const src = read('src/server/scripts/seedRadiologyServices.js');
    expect(src).toMatch(/category: 'Radiology'/);
  });

  test('the curated list covers both X-Ray and Ultrasound exam types', () => {
    const { radiologyServices } = require('../../src/server/scripts/radiologyServicesData');
    expect(radiologyServices.some((s) => s.sub === 'X-Ray')).toBe(true);
    expect(radiologyServices.some((s) => s.sub === 'Ultrasound')).toBe(true);
    expect(radiologyServices.length).toBeGreaterThan(20);
  });

  test('the seed endpoint is registered next to seed-lab-services under the same privilege', () => {
    const src = read('src/server/routes/services.js');
    const section = src.slice(src.indexOf("'/seed-radiology-services'"), src.indexOf("'/seed-radiology-services'") + 300);
    expect(section).toMatch(/authorize\('setup\.services\.manage'\)/);
  });
});

describe('LIS "Place Order" screen: radiology is available to every tenant, admission-request consolidation stays dpoc-only', () => {
  const src = read('src/pages/lis/LISTestOrders.tsx');

  test('a DPOC_TENANT constant still exists, now scoped to just the Request Admission button', () => {
    expect(src).toMatch(/const DPOC_TENANT = 'dpoc';/);
  });

  test('the radiology picker renders unconditionally — no tenant gate left on it', () => {
    const pickerStart = src.indexOf('Radiology — kept as its own picker');
    expect(pickerStart).toBeGreaterThan(-1);
    const pickerSection = src.slice(pickerStart, pickerStart + 400);
    expect(pickerSection).not.toMatch(/user\?\.tenantCode === DPOC_TENANT/);
  });

  test('the exam-types fetch runs for every tenant, not just dpoc', () => {
    const effectSrc = src.slice(src.indexOf("if (activeMode === 'order')"), src.indexOf("if (activeMode === 'order')") + 500);
    expect(effectSrc).toMatch(/fetchRadiologyExamTypes\(\);/);
    expect(effectSrc).not.toMatch(/if \(user\?\.tenantCode === DPOC_TENANT\) fetchRadiologyExamTypes/);
  });

  test('the Request Admission button in order mode only renders for user.tenantCode === DPOC_TENANT', () => {
    const btnIndex = src.indexOf('Request Admission');
    expect(btnIndex).toBeGreaterThan(-1);
    const section = src.slice(Math.max(0, btnIndex - 300), btnIndex);
    expect(section).toMatch(/user\?\.tenantCode === DPOC_TENANT/);
  });

  test('fetchServices excludes category=Radiology so items are not offered twice', () => {
    const fnSrc = src.slice(src.indexOf('const fetchServices = async'), src.indexOf('const fetchServices = async') + 700);
    expect(fnSrc).toMatch(/radiology/i);
  });

  test('handleRequestAdmission supports both Visit Summary and order-mode (selectedParticipant), not just selectedSummary', () => {
    const fnSrc = src.slice(src.indexOf('const handleRequestAdmission'), src.indexOf('const handleRequestAdmission') + 800);
    expect(fnSrc).toMatch(/activeMode === 'summary'/);
    expect(fnSrc).toMatch(/selectedParticipant/);
  });

  test('radiology requests are created after order submission, not billed alongside tests/services', () => {
    const fnSrc = src.slice(src.indexOf('const handleOrder = async'), src.indexOf('const handleOrder = async') + 4000);
    expect(fnSrc).toMatch(/\/api\/radiology\/requests/);
    // Must not be folded into the billed service id list
    expect(fnSrc).not.toMatch(/selectedServiceIds\.concat\(selectedRadiologyIds\)/);
  });

  test('Visit Summary\'s own admission trigger and request-another-service flow are untouched', () => {
    // handleRequestService (Visit Summary's "Request Another Service") must
    // still exist, unmodified in spirit — still gated on selectedSummary.
    const fnSrc = src.slice(src.indexOf('const handleRequestService'), src.indexOf('const handleRequestService') + 400);
    expect(fnSrc).toMatch(/selectedSummary/);
  });
});

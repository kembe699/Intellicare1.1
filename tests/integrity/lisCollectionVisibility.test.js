/**
 * GET /api/lis/specimens/pending was gated on lis.specimen.write (admin/lab
 * only), even though it's a pure read — the page that calls it, /lis/collection,
 * only requires lis.results.read at the route level (App.tsx), which also
 * covers doctors. A doctor opening the page to check their own just-ordered
 * test got a silent 403 here, which LISCollection.tsx's fetch swallowed into
 * an empty array with no error shown — "No pending collections" looked
 * identical to "the test was never created", for any doctor checking their
 * own order. Reported in production on the "demo" tenant.
 */
const fs = require('fs');
const path = require('path');

const lisModuleSrc = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/lisModule.js'), 'utf8');
const lisCollectionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/pages/lis/LISCollection.tsx'), 'utf8');
const { DEFAULT_ROLE_PRIVILEGES } = require('../../src/server/config/permissionsCatalog');

describe('GET /api/lis/specimens/pending is reachable by anyone who can open /lis/collection', () => {
  test('is gated on lis.results.read, not the stricter lis.specimen.write', () => {
    expect(lisModuleSrc).toMatch(/router\.get\('\/specimens\/pending',\s*authorize\('lis\.results\.read'\)/);
    expect(lisModuleSrc).not.toMatch(/router\.get\('\/specimens\/pending',\s*authorize\('lis\.specimen\.write'\)/);
  });

  test('every mutating /specimens/:id/... route still requires lis.specimen.write', () => {
    // The fix only touched the two read (GET) endpoints — collect/dispatch/qc/
    // route/simulate/results must still require the stricter write privilege.
    for (const action of ['collect', 'dispatch', 'qc', 'route', 'simulate']) {
      const re = new RegExp(`router\\.post\\('\\/specimens\\/:id\\/${action}',\\s*authorize\\('lis\\.specimen\\.write'\\)`);
      expect(lisModuleSrc).toMatch(re);
    }
  });

  test('doctor has lis.results.read (the privilege /lis/collection\'s route and this endpoint now share)', () => {
    expect(DEFAULT_ROLE_PRIVILEGES['lis.results.read']).toContain('doctor');
  });

  test('doctor does NOT have lis.specimen.write — confirms this was a real, reachable gap, not a hypothetical one', () => {
    expect(DEFAULT_ROLE_PRIVILEGES['lis.specimen.write']).not.toContain('doctor');
  });
});

describe('LISCollection.tsx surfaces a failed fetch instead of silently rendering an empty queue', () => {
  test('toasts an error when the pending-queue fetch fails', () => {
    const fnStart = lisCollectionSrc.indexOf('const fetchSpecimens');
    const fnSrc = lisCollectionSrc.slice(fnStart, fnStart + 1200);
    expect(fnSrc).toMatch(/if \(!resPending\.ok\) toast\.error\(/);
  });

  test('toasts an error when the history fetch fails', () => {
    const fnStart = lisCollectionSrc.indexOf('const fetchSpecimens');
    const fnSrc = lisCollectionSrc.slice(fnStart, fnStart + 1200);
    expect(fnSrc).toMatch(/if \(!resHistory\.ok\) toast\.error\(/);
  });
});

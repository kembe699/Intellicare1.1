/**
 * Two separate bugs, both reported against the same production case (demo
 * tenant, patient John Korsuk Lasuba / PTN-20261001-6560, a "Urine General"
 * test that showed as pending-collection in the Visit Summary panel but never
 * appeared in /lis/collection's Active Queue):
 *
 * 1. GET /api/lis/specimens/pending was gated on lis.specimen.write (admin/lab
 *    only), even though it's a pure read — the page that calls it,
 *    /lis/collection, only requires lis.results.read at the route level
 *    (App.tsx), which also covers doctors. A doctor opening the page to check
 *    their own just-ordered test got a silent 403 here, which
 *    LISCollection.tsx's fetch swallowed into an empty array with no error
 *    shown — "No pending collections" looked identical to "the test was
 *    never created".
 *
 * 2. Fixing (1) alone didn't fix the reported case: GET /api/lis/visit-summaries
 *    (which renders the Visit Summary panel, including per-test status) and
 *    GET /api/lis/specimens/pending (the Active Queue) use two different,
 *    independently hand-rolled branch-filtering helpers with inconsistent
 *    admin-exemption rules. getBranchConditionSQL (the shared one, used by
 *    specimens/pending) only exempts an admin who hasn't picked a branch via
 *    the TopBar switcher. getBranchConditionNamed (a local duplicate in this
 *    file, used by visit-summaries and lab-dashboard) exempted EVERY admin
 *    unconditionally — so once an admin had ever selected a branch, the same
 *    specimen could show in the Visit Summary (always unfiltered for admins)
 *    while being filtered out of the Active Queue (correctly scoped to the
 *    switcher's branch) — same admin, same page load, same patient.
 */
const fs = require('fs');
const path = require('path');

const lisModuleSrc = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/lisModule.js'), 'utf8');
const lisCollectionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/pages/lis/LISCollection.tsx'), 'utf8');
const { DEFAULT_ROLE_PRIVILEGES } = require('../../src/server/config/permissionsCatalog');
const { getBranchConditionNamed } = require('../../src/server/routes/lisModule');

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

describe('getBranchConditionNamed (visit-summaries, lab-dashboard) matches getBranchConditionSQL (specimens/pending)', () => {
  test('an admin who has NOT picked a branch (adminScoped false) is unfiltered — same as the shared helper', () => {
    const req = { user: { role: 'admin' }, branchContext: { branchId: 5, adminScoped: false } };
    expect(getBranchConditionNamed(req, 'o')).toEqual({ sql: '', replacements: {} });
  });

  test('an admin who HAS picked a branch via the switcher (adminScoped true) IS filtered to it — this was the bug', () => {
    const req = { user: { role: 'admin' }, branchContext: { branchId: 5, adminScoped: true } };
    const result = getBranchConditionNamed(req, 'o');
    expect(result.sql).toMatch(/AND o\.branch_id = :branchId/);
    expect(result.replacements).toEqual({ branchId: 5 });
  });

  test('a non-admin is always filtered to their own branch, same as before', () => {
    const req = { user: { role: 'doctor', branchId: 3 }, branchContext: {} };
    const result = getBranchConditionNamed(req, 'o');
    expect(result.sql).toMatch(/AND o\.branch_id = :branchId/);
    expect(result.replacements).toEqual({ branchId: 3 });
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

/**
 * A specimen's approved lab results were invisible on its own visit summary
 * ("No results recorded") despite genuinely existing — confirmed live on
 * tenant_dpoc: the specimen/order were branch_id=2, but POST
 * /specimens/:id/results had stamped its 3 rows branch_id=1 (whoever was
 * logged in when results were entered), and getBranchConditionSQL's strict
 * equality filter on GET /specimens/:id/results hid them from anyone
 * actually scoped to the specimen's real branch.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('lis_results inherits its specimen\'s branch_id, not the requester\'s', () => {
  const src = read('src/server/routes/lisModule.js');

  test('POST /specimens/:id/results looks up the specimen\'s own branch_id before inserting', () => {
    const start = src.indexOf("router.post('/specimens/:id/results'");
    expect(start).toBeGreaterThan(-1);
    const section = src.slice(start, start + 1500);
    expect(section).toMatch(/SELECT branch_id FROM lis_specimens WHERE id = \?/);
    expect(section).toMatch(/const branchId = specimen\?\.branch_id \?\? getCreateBranchId\(req\);/);
    // Must not fall straight to the requester's own branch unconditionally
    expect(section).not.toMatch(/const branchId = getCreateBranchId\(req\);\s*\n\s*\n\s*const t = await db\.transaction/);
  });

  test('POST /specimens/:id/simulate (mock/dev results) gets the same inheritance rule', () => {
    const start = src.indexOf("router.post('/specimens/:id/simulate'");
    const end = src.indexOf("router.post('/specimens/:id/results'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = src.slice(start, end);
    expect(section).toMatch(/SELECT branch_id FROM lis_specimens WHERE id = \?/);
    expect(section).toMatch(/const branchId = specimen\?\.branch_id \?\? getCreateBranchId\(req\);/);
  });
});

/**
 * A prescription with every line dispensed must be marked 'dispensed', not
 * stuck at 'partial_dispensed'.
 *
 * COUNT(*) comes back from Postgres as the string "0", not the number 0.
 * `("0" || 0) === 0` is false — a non-empty string is truthy, so the left
 * side stays "0", and "0" === 0 is false under strict equality. That made
 * the "no pending lines left" check always fail, so every prescription
 * dispensed through this endpoint stayed 'partial_dispensed' forever, no
 * matter how many of its lines were actually done — confirmed live: seven
 * fully-dispensed prescriptions on tenant_nation were stuck this way.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

test("prescription status check coerces the SQL count to a number before comparing", () => {
  const src = read('src/server/routes/pharmacyModule.js');
  const site = src.slice(
    src.indexOf('// 8. Update prescription status'),
    src.indexOf("await sequelize.query('UPDATE pharmacy_prescriptions")
  );
  expect(site).toMatch(/const rxStatus = /);
  // Must not compare the raw driver value straight against the number 0 —
  // that's the exact form of the bug ("0" === 0 is always false).
  expect(site).not.toMatch(/pendingLines\[0\]\?\.cnt \|\| 0\) === 0/);
  expect(site).toMatch(/parseInt\(pendingLines\[0\]\?\.cnt, 10\) === 0/);
});

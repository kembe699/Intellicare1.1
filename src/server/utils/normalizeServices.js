// `patient_bills.services` is a genuine Sequelize DataTypes.JSON column. Sequelize
// serializes whatever value you assign it exactly once when saving. Code that calls
// JSON.stringify() on the array *before* assigning it causes Sequelize to stringify that
// string again, adding one more layer of encoding on top of whatever a row already has.
// Reads that only unwrap a fixed number of layers ("double-stringified case") eventually
// hand back a raw JSON string instead of an array once a row has accumulated enough writes
// — and spreading a string (`[...aString, ...newItems]`) spreads its individual
// characters, producing dozens of garbage "empty" line items with the real new item(s)
// appended after them.
//
// Fix: never JSON.stringify() a services array before assigning it to a PatientBill
// instance/`.create()`/`.update()` call — always pass a real array — and always read
// through this helper first, which unwraps however many layers of encoding a row has
// accumulated so far, self-healing it the next time it's written back.
//
// Always returns a fresh array — never the same reference as `value` when it's already
// an array. Without this, a caller doing `const services = normalizeServices(bill.services);
// services.push(x); bill.update({ services })` mutates bill.services in place before
// passing it back, so the "new" value is reference-identical to what Sequelize already has
// cached as current — its dirty-checking sees no change and silently drops the field from
// the UPDATE. Confirmed live: a bed charge's total_amount updated correctly but the
// services array itself never got the new line item, because the merge helper mutated the
// same array reference it read. A void/refund call site had the identical bug. Every
// caller across this file relies on this helper never handing back a live reference to the
// bill's own in-memory array, so the fix belongs here, once, rather than at each call site.
function normalizeServices(value) {
  let v = value;
  let guard = 0;
  while (typeof v === 'string' && guard < 8) {
    try { v = JSON.parse(v); } catch { return []; }
    guard++;
  }
  return Array.isArray(v) ? [...v] : [];
}

// B1: a bill's services array has no stable identity of its own — every
// caller (void-item, payment) used to identify "which line" by array
// position. Voiding an unpaid line does services.splice(index, 1), which
// shifts every later index; a payment submitted from a page that fetched the
// bill a moment before someone else voided/added a line would then mark the
// WRONG line as paid, silently, because "index 3" no longer means the same
// item. line_id is assigned once, here, and never regenerated for a line
// that already has one — callers must persist whatever this returns (it does
// not mutate the array Sequelize already has cached, same rule as
// normalizeServices itself) so the id sticks across every future read.
function ensureLineIds(services) {
  const { randomUUID } = require('crypto');
  return services.map((s) => (s && s.line_id) ? s : { ...s, line_id: randomUUID() });
}

module.exports = { normalizeServices, ensureLineIds };

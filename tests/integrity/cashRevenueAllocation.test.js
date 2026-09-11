/**
 * Splitting a payment across a bill's revenue lines must never invent cents.
 *
 * The previous allocation multiplied each payment by "this line's share of the
 * bill" — col.amount * (br.amount / bt.total). That is exact only when the
 * payment equals the whole bill; any part-payment produces a ratio that rarely
 * divides evenly, so a bill split into whole-number lines (20,000 / 76,000 /
 * 93,500) paid 81,000 of came out as 20,321.72 / 7,733.30-odd / ... — real
 * money, reported as a number matching no real price. Rolled up across a day's
 * receipts, nation's Consultation Revenue read SSP 248,548.81 for a service
 * that costs 20,000 or 50,000, which reads as the books being wrong rather than
 * as a rounding artefact.
 *
 * Waterfall allocation — fill one line, then the next — only ever subtracts a
 * whole amount from a whole amount, so it cannot introduce a fraction that was
 * not already in the bill's own prices.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/server/routes/reportIncomeStatement.js'),
  'utf8'
);

// Extracted rather than required: the file also opens a live DB connection at
// module load, which a unit test must not depend on.
function loadWaterfallAllocate() {
  const start = src.indexOf('function waterfallAllocate');
  const end = src.indexOf('\nasync function fetchCashRevenue');
  const body = src.slice(src.indexOf('function round2'), end);
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${body}\nreturn waterfallAllocate;`);
  return factory();
}

describe('the ratio split is gone', () => {
  test('fetchCashRevenue no longer multiplies a payment by a share', () => {
    expect(src).not.toMatch(/col\.amount \* \(br\.amount \/ bt\.total\)/);
  });

  test('allocation is a waterfall over each bill\'s own lines', () => {
    expect(src).toMatch(/function waterfallAllocate/);
    expect(src).toMatch(/waterfallAllocate\(Number\(c\.amount\)/);
  });
});

describe('waterfallAllocate', () => {
  const waterfallAllocate = loadWaterfallAllocate();
  const sum = (allocated) => allocated.reduce((s, a) => s + a.amount, 0);

  test('a part-payment on whole-number lines produces only whole numbers', () => {
    // The exact case that produced 248,548.81: a 189,500 bill (20,000 / 76,000 /
    // 93,500) with 81,000 paid.
    const lines = [
      { key: 'consult', capacity: 20000 },
      { key: 'lab', capacity: 76000 },
      { key: 'pharmacy', capacity: 93500 },
    ];
    const allocated = waterfallAllocate(81000, lines);
    for (const a of allocated) expect(Number.isInteger(a.amount)).toBe(true);
    expect(sum(allocated)).toBe(81000);
  });

  test('fills lines in order — the first line is paid before the second', () => {
    const lines = [{ key: 'a', capacity: 20000 }, { key: 'b', capacity: 76000 }, { key: 'c', capacity: 93500 }];
    const allocated = waterfallAllocate(81000, lines);
    const byKey = Object.fromEntries(allocated.map((a) => [a.key, a.amount]));
    expect(byKey.a).toBe(20000);   // fully covered first
    expect(byKey.b).toBe(61000);   // remainder after the first line
    expect(byKey.c ?? 0).toBe(0);  // untouched — nothing was left
  });

  test('a full payment allocates to exactly what the bill says', () => {
    const lines = [{ key: 'a', capacity: 20000 }, { key: 'b', capacity: 76000 }, { key: 'c', capacity: 93500 }];
    const allocated = waterfallAllocate(189500, lines);
    expect(allocated.map((a) => a.amount)).toEqual([20000, 76000, 93500]);
  });

  test('an overpayment is not lost — it lands on the largest line', () => {
    const lines = [{ key: 'a', capacity: 20000 }, { key: 'b', capacity: 76000 }];
    const allocated = waterfallAllocate(200000, lines);
    expect(sum(allocated)).toBe(200000);
    const byKey = Object.fromEntries(allocated.map((a) => [a.key, a.amount]));
    expect(byKey.b).toBe(180000); // 76000 + the 104000 that had nowhere else to go
  });

  test('a genuinely fractional price stays exact, not rounded away', () => {
    // Scheme pricing and currency conversion produce real cents; the fix must
    // not manufacture round numbers where the bill itself was not round.
    const lines = [{ key: 'a', capacity: 831.60 }, { key: 'b', capacity: 12000 }];
    const allocated = waterfallAllocate(831.60, lines);
    expect(allocated.find((a) => a.key === 'a').amount).toBe(831.60);
  });

  test('a refund with no negative-capacity line to take it from still nets out', () => {
    // The forward pass skips 'a' — its capacity is the opposite sign to the
    // refund — but the amount cannot be dropped, or the reported total would
    // no longer match what actually left the drawer. It falls to the only line
    // there is, the same "give it to the biggest line" rule used when a
    // payment overshoots every line above.
    const lines = [{ key: 'a', capacity: 20000 }];
    const allocated = waterfallAllocate(-5000, lines);
    expect(allocated.find((a) => a.key === 'a').amount).toBe(-5000);
  });

  test('no lines is not an error', () => {
    expect(waterfallAllocate(1000, [])).toEqual([]);
  });
});

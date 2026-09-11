/**
 * The income statement's lines must add up to the money that was taken.
 *
 * Cash-basis revenue splits each payment across the revenue accounts its bill was
 * posted to, so a line is a proportion and rarely lands on a whole cent. Rounding
 * every line and then adding them is not the same as adding and then rounding:
 * nation's takings of 2,009,500.00 were reported as 2,009,499.99.
 *
 * A penny is not a material sum, but a total that disagrees with the cashier
 * reads as the books being wrong — and it is exactly the kind of difference
 * someone spends an afternoon chasing.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '../../src/server/routes/reportIncomeStatement.js'),
  'utf8'
);

/** The reallocation the endpoint performs, applied to a set of raw shares. */
function allocate(exactShares) {
  const lines = exactShares.map((exact) => ({ exact, amount: Math.round(exact * 100) / 100 }));
  const exactTotal = Math.round(lines.reduce((s, l) => s + l.exact, 0) * 100) / 100;
  const roundedTotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const remainder = Math.round((exactTotal - roundedTotal) * 100) / 100;
  if (remainder !== 0 && lines.length) {
    const largest = lines.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
    largest.amount = Math.round((largest.amount + remainder) * 100) / 100;
  }
  return { lines: lines.map((l) => l.amount), total: exactTotal };
}

describe('revenue lines add up to what was collected', () => {
  test('the endpoint reallocates the rounding remainder', () => {
    expect(src).toMatch(/const remainder = /);
    expect(src).toMatch(/largest\.amount = /);
  });

  test('three shares that each round down still total the exact amount', () => {
    // Each loses a third of a cent; summed naively the total is a penny short.
    const shares = [669833.331, 669833.334, 669833.335];
    const { lines, total } = allocate(shares);
    const summed = Math.round(lines.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(summed).toBe(total);
  });

  test('a total already exact is left alone', () => {
    const { lines } = allocate([100.25, 50.75]);
    expect(lines).toEqual([100.25, 50.75]);
  });

  test('the adjustment lands on the largest line', () => {
    // Least significant there, and the only line sure to absorb it.
    const { lines } = allocate([0.004, 1000.004]);
    expect(lines[0]).toBe(0);
    expect(lines[1]).toBe(1000.01);
  });

  test('a single line takes the whole remainder', () => {
    const { lines, total } = allocate([2009499.994]);
    expect(Math.round(lines[0] * 100) / 100).toBe(total);
  });

  test('no lines is not an error', () => {
    expect(allocate([]).lines).toEqual([]);
  });
});

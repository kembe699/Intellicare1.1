/**
 * Cash that was handed back must leave the shift total.
 *
 * A bill refund is written as its own receipt with a negative payment_amount and
 * status 'refunded', while the original payment receipt stays 'active'. The shift
 * only counted 'active' receipts, so the refund reduced nothing: the day read
 * gross, and expected cash read gross with it, meaning the cashier came up short
 * at reconciliation for money they had correctly paid out.
 *
 * On nation this put the shift 198,000 above the income statement — the reports
 * were right and the shift was wrong, which is the harder way round to notice.
 */
const { refundedOut } = require('../../src/server/routes/cashier');

const receipt = (amount, method = 'cash') => ({ payment_amount: amount, payment_method: method });

describe('refunds paid out reduce what the shift is holding', () => {
  test('negative refund receipts are counted as cash out', () => {
    const refunded = [receipt(-20000), receipt(-3000), receipt(-175000)];
    expect(refundedOut(refunded)).toBe(198000);
  });

  test('a refund recorded by flipping the original receipt is not subtracted twice', () => {
    // Positive amount means the original payment was reversed in place; it is
    // already absent from the active list, so subtracting it again would
    // understate the drawer by the same amount it was meant to correct.
    expect(refundedOut([receipt(50000)])).toBe(0);
    expect(refundedOut([receipt(50000), receipt(-1500)])).toBe(1500);
  });

  test('it can be narrowed to one payment method, so expected cash excludes card', () => {
    const refunded = [receipt(-1000, 'cash'), receipt(-4000, 'card')];
    expect(refundedOut(refunded, (r) => r.payment_method === 'cash')).toBe(1000);
    expect(refundedOut(refunded)).toBe(5000);
  });

  test('nothing refunded changes nothing', () => {
    expect(refundedOut([])).toBe(0);
  });

  // Guards the three places that must apply it: the live shift list, the
  // end-of-day report, and close-shift's expected cash.
  test('every shift total applies it', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/server/routes/cashier.js'), 'utf8');
    const uses = (src.match(/refundedOut\(/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(8);
    expect(src).toMatch(/const totalAmount =[\s\S]{0,160}refundedOutTotal/);
    expect(src).toMatch(/const cashTotal =[\s\S]{0,200}refundedOutCash/);
  });
});

describe('reported revenue is net of what was handed back', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

  // Every screen that states a revenue figure has to subtract refunds, or they
  // disagree with each other and with the drawer. The cashier shift had this
  // fault; so did the reports dashboard, which summed only status='active' and
  // so reported gross takings for money already returned over the counter.
  test('the dashboard overview counts refunds against revenue', () => {
    const src = read('src/server/routes/reportOverview.js');

    // Two things have to be true together, and checking either alone passes while
    // the figure is still gross: the query has to READ refund rows, and it has to
    // SUBTRACT them. Filtering to status='active' excludes them however carefully
    // the SUM is written.
    const readsRefunds = (src.match(/status IN \('active', 'refunded'\)/g) || []).length;
    const subtractsThem = (src.match(/status = 'refunded' AND payment_amount < 0/g) || []).length
      + (src.match(/r\.status = 'refunded' AND r\.payment_amount < 0/g) || []).length;

    expect(readsRefunds).toBeGreaterThanOrEqual(3);
    expect(subtractsThem).toBeGreaterThanOrEqual(4);

    // And no revenue sum may still be scoped to active receipts alone.
    const activeOnly = (src.match(/status = 'active'\s*\n\s*AND payment_date/g) || []).length;
    expect(activeOnly).toBe(0);
  });

  test('voided receipts are still excluded — they never moved money', () => {
    const src = read('src/server/routes/reportOverview.js');
    // 'voided' must never appear in a revenue status filter.
    const filters = src.match(/status IN \([^)]*\)/g) || [];
    expect(filters.length).toBeGreaterThan(0);
    for (const f of filters) expect(f).not.toContain('voided');
  });

  test('the sign decides, so a refund cannot be subtracted twice', () => {
    // A refund recorded by flipping the original receipt in place is positive and
    // already outside 'active'; keying on status alone would deduct it again.
    const src = read('src/server/routes/reportOverview.js');
    expect(src).toMatch(/payment_amount < 0/);
  });
});

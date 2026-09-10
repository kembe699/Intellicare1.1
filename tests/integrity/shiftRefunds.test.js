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

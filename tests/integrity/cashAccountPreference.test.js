/**
 * Cash collections post to 1100 (Cash), not 1105 (Cash at Hand).
 *
 * This is a deliberate preference change, not a bug fix — the account this
 * looked for by name first is now "Cash" rather than "Cash at Hand". Every
 * place that decides which account a NEW cash movement lands in has to agree,
 * or collections split across two accounts with nothing announcing it, which
 * is the exact failure this project already hit once when the two accounts'
 * names stopped resolving the way the code expected.
 *
 * Reversing an OLD payment is a different question and must not follow this
 * preference: it has to credit back whatever account that specific payment
 * actually debited, whichever preference was live when it was taken, or a
 * receipt posted under the old default gets its refund wrongly booked against
 * the new one — overstating the account that was never touched and leaving
 * the one that was permanently short.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('new cash movements prefer account 1100', () => {
  test('taking a bill payment', () => {
    const src = read('src/server/routes/patientBills.js');
    const site = src.slice(src.indexOf("method === 'cash'"), src.indexOf("} else if (method === 'card')"));
    expect(site).toMatch(/account_code: '1100'/);
  });

  test("refunding cash for a voided item", () => {
    const src = read('src/server/routes/patientBills.js');
    const site = src.slice(src.indexOf('autoRefundAmount > 0'), src.indexOf('lineItems.push'));
    expect(site).toMatch(/account_code: '1100'/);
  });

  test('taking a patient deposit', () => {
    const src = read('src/server/routes/patientDeposits.js');
    const site = src.slice(src.indexOf('async function resolveCashOrBankAccount'));
    expect(site.slice(0, 600)).toMatch(/account_code: '1100'/);
  });

  test('moving cash out of the drawer (Cash Transfer)', () => {
    const src = read('src/server/routes/cashier.js');
    const site = src.slice(src.indexOf('const cashAtHandAccount = await ChartOfAccounts.findOne'));
    expect(site.slice(0, 400)).toMatch(/account_code: '1100'/);
  });
});

describe("reversing an existing receipt uses the account it actually used", () => {
  const src = read('src/server/routes/receipts.js');
  const fn = src.slice(src.indexOf('async function reversePaymentGL'));

  test('it looks up the original journal entry by the receipt\'s own reference', () => {
    expect(fn.slice(0, 1200)).toMatch(/JournalEntries\.findOne/);
    expect(fn.slice(0, 1200)).toMatch(/\breference\b/);
  });

  test('it reads the debit side of that entry — the cash/bank line, not the receivable', () => {
    expect(fn.slice(0, 1500)).toMatch(/JournalEntryLines\.findOne/);
    expect(fn.slice(0, 1500)).toMatch(/debit_amount:\s*\{\s*\[Op\.gt\]/);
  });

  test('only falls back to a default when no original entry can be found', () => {
    expect(fn).toMatch(/if \(!originalDebitAccount\)/);
    // The fallback itself should agree with the current forward preference —
    // otherwise a fallback for a truly untraceable old receipt would default
    // to the account this project is moving away from.
    const fallback = fn.slice(fn.indexOf('if (!originalDebitAccount)'));
    expect(fallback.slice(0, 500)).toMatch(/account_code: '1100'/);
  });
});

/**
 * Applying a credit note reverses revenue from the account(s) the bill's own
 * creation actually posted to — not a hardcoded 4100 (Consultation Revenue).
 *
 * A credit note against a lab or pharmacy bill used to always debit 4100
 * regardless of what the bill actually posted, matching in total but leaving
 * the category breakdown wrong: the real revenue account stayed overstated
 * and Consultation Revenue took a debit it never earned. Same bug class as
 * the fix in AccountingService.syncBillRevenueToGL (see accountingInvariants
 * test) — a plausible-looking hardcoded account instead of the one the
 * money actually lives in.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('credit note GL reversal targets the bill\'s actual revenue account(s)', () => {
  const src = read('src/server/routes/billingEnhanced.js');
  const site = src.slice(
    src.indexOf('// Create GL reversal (Cr. Revenue, Dr. AR)'),
    src.indexOf('GL entry for credit note failed')
  );

  test('looks up what the bill actually posted to account_ledger, joined on revenue accounts', () => {
    expect(site).toMatch(/account_type = 'revenue'/);
    expect(site).toMatch(/reference_module IN \('patient_billing', 'bill_item_void', 'bill_revenue_adjustment'\)/);
  });

  test('does not unconditionally debit account 4100', () => {
    expect(site).not.toMatch(/getAccountByCode\(note\.clinic_id, '4100'\)\s*;\s*\n(?:(?!fallback).)*revenueAccount\.id, debit_amount: note\.credit_amount/s);
    // The only remaining reference to 4100 must be the last-resort fallback,
    // guarded by "no posted revenue rows found at all".
    const fallbackIdx = site.indexOf("getAccountByCode(note.clinic_id, '4100')");
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(site.slice(0, fallbackIdx)).toMatch(/revenueLines\.length === 0/);
  });

  test('waterfalls the credit across posted accounts largest-first, spilling into the next', () => {
    expect(site).toMatch(/ORDER BY 2 DESC/);
    expect(site).toMatch(/Math\.min\(remaining,/);
  });

  test('debits every resolved revenue line, not just one hardcoded account', () => {
    expect(site).toMatch(/revenueLines\.map\(\(r\) => \(\{ account_id: r\.account_id, debit_amount: r\.amount/);
  });
});

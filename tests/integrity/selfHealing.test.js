/**
 * The repairs that run unattended have to actually reach what is broken.
 *
 * Both of today's near-misses were the same shape: a repair that reported
 * success while never examining the row that needed it. Neither raised an error,
 * and the only reason either was noticed is that a second check disagreed.
 *
 *   1. The ledger sweeper limited by date before comparing, so on a tenant
 *      billing more than the page size inside the lookback it re-read the oldest
 *      settled bills every pass and never reached a bill that had just drifted.
 *      It reported "nothing to repair" while the health check reported a
 *      shortfall, both looking at the same data.
 *
 *   2. Sequence numbers built from a count assume no gaps. Cancelled and deleted
 *      rows leave them, so the count lands on a number already taken and the
 *      insert dies on a unique index — surfacing as "Validation error", which
 *      says nothing about what went wrong.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('the ledger sweeper looks at the bills that are wrong', () => {
  const sweeper = read('src/server/services/ledgerSweeper.js');

  test('drifted bills are selected in SQL, not filtered after the limit', () => {
    // The comparison must be part of the query that LIMIT applies to. Done in
    // JavaScript afterwards, LIMIT has already thrown away the rows that mattered.
    const query = sweeper.slice(
      sweeper.indexOf('const UNRECONCILED_BILLS'),
      sweeper.indexOf('async function sweepCurrentTenant')
    );
    expect(query).toContain('LIMIT :limit');
    // From the outer FROM to the LIMIT: everything LIMIT is applied to.
    const selection = query.slice(query.indexOf('FROM patient_bills b'), query.indexOf('LIMIT :limit'));
    expect(selection).toMatch(/ABS\(/);
    expect(selection).toMatch(/SUM\(al\.credit_amount\)/);
  });

  test('it takes the newest bills, since those are the ones just gone wrong', () => {
    expect(sweeper).toMatch(/ORDER BY b\.created_at DESC/);
  });

  test('repairs are dated to the bill, not to the day of the repair', () => {
    // Stamping today moves an old bill's revenue onto today's income statement
    // and leaves the day it belonged to permanently short.
    const accounting = read('src/server/services/AccountingService.js');
    expect(accounting).toMatch(/const billDay = bill\.bill_date/);
    expect(accounting).toMatch(/transaction_date: billDay/);
  });
});

describe('generated sequence numbers survive gaps and collisions', () => {
  test('GL numbers are taken from the highest issued, not from a count', () => {
    const accounting = read('src/server/services/AccountingService.js');
    const fn = accounting.slice(accounting.indexOf('async generateGLNumber'));
    expect(fn.slice(0, 900)).toMatch(/order: \[\['gl_number', 'DESC'\]\]/);
    expect(fn.slice(0, 900)).not.toMatch(/COUNT\(\*\)/i);
  });

  test('a taken GL number is retried rather than losing the entry', () => {
    const accounting = read('src/server/services/AccountingService.js');
    expect(accounting).toMatch(/isUniqueViolation\(err\)/);
    expect(accounting).toMatch(/NUMBER_ATTEMPTS/);
  });

  test('dispensing numbers are taken from the highest issued too', () => {
    // Same fault, different table: the count landed on an existing number and
    // the dispense died on the inventory movement's unique transaction number.
    for (const file of [
      'src/server/services/autoDispense.js',
      'src/server/routes/pharmacyModule.js',
    ]) {
      const src = read(file);
      const idx = src.indexOf('dispensing_number LIKE');
      expect(idx).toBeGreaterThan(-1);
      const generator = src.slice(Math.max(0, idx - 400), idx);
      expect(generator).toMatch(/MAX\(/);
      expect(generator).not.toMatch(/COUNT\(\*\)\s+AS\s+cnt\s+FROM\s+dispensing_records/i);
    }
  });
});

describe('every repair agrees on what "already posted" means', () => {
  // The reconciler, the sweeper and the health check all answer "how much of this
  // bill has reached the ledger?". They must answer it identically. The reconciler
  // once left bill_revenue_adjustment out of that sum, so it could not see its own
  // previous corrections: a bill it had already repaired looked equally short on
  // the next run and the same adjustment went on again. It over-posted a bill by
  // 24,000 that way, and would have again on every run.
  const MODULES = ['patient_billing', 'bill_item_void', 'bill_revenue_adjustment'];

  const sources = {
    'the ledger sweeper': 'src/server/services/ledgerSweeper.js',
    'the health check': 'src/server/scripts/accountingHealthCheck.js',
    'the reconciler': 'src/server/scripts/reconcileBillRevenue.js',
    'syncBillRevenueToGL': 'src/server/services/AccountingService.js',
  };

  for (const [label, file] of Object.entries(sources)) {
    test(`${label} counts adjustments as posted revenue`, () => {
      const src = read(file);
      // Only the clauses that total a bill's revenue. A file may filter on
      // reference_module for unrelated reasons — which entries post
      // automatically, say — and those lists are their own concern.
      const revenueClauses = (src.match(/reference_module IN \(([^)]*)\)/g) || [])
        .filter((clause) => {
          const at = src.indexOf(clause);
          const statement = src.slice(Math.max(0, at - 700), at);
          return /account_type\s*=\s*'revenue'/.test(statement);
        });
      expect(revenueClauses.length).toBeGreaterThan(0);
      for (const clause of revenueClauses) {
        for (const mod of MODULES) {
          expect(clause).toContain(mod);
        }
      }
    });
  }

  test('re-running a repair cannot post the same adjustment twice', () => {
    // Numbering every adjustment for a bill the same way meant a second, genuine
    // correction collided with the first and was reported as a failure.
    const reconciler = read('src/server/scripts/reconcileBillRevenue.js');
    expect(reconciler).toMatch(/GL-ADJ-\$\{b\.bill_number\}-\$\{taken\.length \+ 1\}/);
  });
});

describe('dispensing reduces the batches as well as the item', () => {
  // Stock lives in two places that must fall together: the item's on-hand, which
  // every dispensing gate reads, and the batch it came out of, which is the record
  // of what arrived. Reducing only the item leaves the batches showing stock that
  // has gone — and the on-hand reconciler, which treats batches as the truth of
  // what was received, reads that gap as stock never posted and puts it back,
  // quietly undoing a real dispense.
  test('the automatic path consumes a batch', () => {
    const src = read('src/server/services/autoDispense.js');
    expect(src).toMatch(/UPDATE inventory_items[\s\S]{0,120}quantity_on_hand/);
    expect(src).toMatch(/UPDATE inventory_batches[\s\S]{0,160}quantity_used/);
  });

  test('it takes short-dated stock first, as the counter does', () => {
    const src = read('src/server/services/autoDispense.js');
    expect(src).toMatch(/ORDER BY expiry_date ASC/);
  });

  test('a quantity larger than one batch is spread across several', () => {
    // Taking only from the first batch would leave the remainder unaccounted.
    const src = read('src/server/services/autoDispense.js');
    expect(src).toMatch(/for \(const batch of batches\)/);
    expect(src).toMatch(/Math\.min\(toTake/);
  });
});

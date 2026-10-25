/**
 * Make "every bill reaches the ledger" true by repair, not just by hope.
 *
 * A bill is committed before its ledger entry is written — deliberately, so a
 * bookkeeping fault can never cost a clinic the record of what a patient owes.
 * The cost of that order is that any failure in between leaves a bill with no
 * entry, and nothing about the day looks wrong: the bill saved, the receipt
 * printed, the cashier's takings were right, and only the income statement was
 * short. Nobody finds that by looking.
 *
 * It has happened for real — a leaked connection starved the pool, ledger
 * posting timed out, and 28 bills across several days went unrecorded before
 * anyone noticed the totals disagreeing. The leak is fixed, but the shape of
 * the risk is permanent: bills commit first, so some failure will eventually
 * land in that gap again.
 *
 * So the ledger repairs itself. Every few minutes each tenant is checked for
 * bills whose posted revenue does not match what the bill is worth, and the
 * difference is posted — dated to the bill's own day, so a late repair still
 * leaves every day's total correct rather than dragging old money onto today.
 *
 * The work is idempotent: it posts the delta between what is on the ledger and
 * what the bill is worth, so a bill already correct produces nothing, and a
 * sweep that overlaps another does no harm.
 */
const tenantContext = require('../tenantContext');

// How far back to look. Long enough to cover an outage that spans a weekend,
// short enough that the query stays cheap on a large tenant.
const LOOKBACK_DAYS = parseInt(process.env.LEDGER_SWEEP_DAYS || '30', 10);

// Bills repaired per tenant per pass. A cap keeps one bad tenant from
// monopolising the pool; whatever is left is picked up on the next sweep.
const MAX_PER_PASS = parseInt(process.env.LEDGER_SWEEP_LIMIT || '100', 10);

/**
 * Bills in the current tenant whose ledger does not match the bill. Covers both
 * "no entry at all" and "posted, but for the wrong amount" — a partial post is
 * as wrong as a missing one, and only the second is visible in the entry count.
 */
const { REVENUE_OR_TAX_ACCOUNT_SQL } = require('../utils/billTax');
// Revenue plus tax posted (a taxed bill's total includes its tax lines).
const UNRECONCILED_BILLS = `
  SELECT b.id,
         b.bill_number,
         COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount) AS worth,
         COALESCE((
           SELECT SUM(al.credit_amount) - SUM(al.debit_amount)
             FROM account_ledger al
             JOIN chart_of_accounts c ON c.id = al.account_id AND ${REVENUE_OR_TAX_ACCOUNT_SQL}
             JOIN general_ledger gl ON gl.id = al.transaction_id
            WHERE gl.reference_id = b.id::text
              AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
         ), 0) AS posted
    FROM patient_bills b
   WHERE b.created_at > NOW() - (:days * INTERVAL '1 day')
     AND COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount) > 0
     -- Select on the drift itself, not on date.
     --
     -- Comparing in JavaScript after a LIMIT means the limit lands on the oldest
     -- hundred bills in the window rather than on the hundred that are wrong. Once
     -- a tenant bills more than that in the lookback — which nation does in days —
     -- the sweep examines the same settled bills every pass and never reaches the
     -- recent one that actually needs repairing. It reports "nothing to do" while
     -- the health check reports a shortfall, and both are looking at the same data.
     AND ABS(
           COALESCE(NULLIF(b.base_currency_total, 0), b.total_amount)
           - COALESCE((
               SELECT SUM(al.credit_amount) - SUM(al.debit_amount)
                 FROM account_ledger al
                 JOIN chart_of_accounts c ON c.id = al.account_id AND ${REVENUE_OR_TAX_ACCOUNT_SQL}
                 JOIN general_ledger gl ON gl.id = al.transaction_id
                WHERE gl.reference_id = b.id::text
                  AND gl.reference_module IN ('patient_billing', 'bill_item_void', 'bill_revenue_adjustment')
             ), 0)
         ) >= 0.01
   -- Newest first: a bill that has just gone wrong is the one someone is looking at.
   ORDER BY b.created_at DESC
   LIMIT :limit
`;

async function sweepCurrentTenant() {
  const { sequelize } = require('../models');
  const AccountingService = require('./AccountingService');

  const [rows] = await sequelize.query(UNRECONCILED_BILLS, {
    replacements: { days: LOOKBACK_DAYS, limit: MAX_PER_PASS },
  });

  const drifted = rows.filter(
    (r) => Math.abs((parseFloat(r.worth) || 0) - (parseFloat(r.posted) || 0)) >= 0.01
  );

  let repaired = 0;
  let corrected = 0;
  for (const bill of drifted) {
    try {
      const delta = await AccountingService.syncBillRevenueToGL(bill.id, 'ledger-sweeper');
      if (delta) {
        repaired += 1;
        corrected += delta;
      }
    } catch (err) {
      // One unrepairable bill must not stop the rest. It stays on the list and
      // is retried next pass; if it never clears, the health check reports it.
      console.error(`Ledger sweep: could not repair bill ${bill.bill_number}: ${err.message}`);
    }
  }

  return { checked: rows.length, drifted: drifted.length, repaired, corrected };
}

/**
 * Sweep every tenant. Each runs inside its own tenant context so the shared
 * model layer resolves to that tenant's schema.
 */
async function sweepAllTenants() {
  const { Client } = require('../models/platform');
  const { getTenantConnection } = require('../tenantDb');

  const clients = await Client.findAll();
  const summary = { tenants: 0, repaired: 0, corrected: 0, failed: 0 };

  for (const client of clients) {
    if (!client.schema_name) continue;
    try {
      const connection = await getTenantConnection(client.schema_name);
      const result = await tenantContext.run(connection, sweepCurrentTenant);
      summary.tenants += 1;
      summary.repaired += result.repaired;
      summary.corrected += result.corrected;
      if (result.repaired > 0) {
        console.log(
          `🧾 Ledger sweep [${client.schema_name}]: repaired ${result.repaired} bill(s), ${result.corrected.toFixed(2)} adjusted.`
        );
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`Ledger sweep failed for ${client.schema_name}: ${err.message}`);
    }
  }

  return summary;
}

module.exports = { sweepAllTenants, sweepCurrentTenant };

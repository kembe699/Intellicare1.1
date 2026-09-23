/**
 * Marks any clinical_insights row still 'pending' after 3 minutes as 'failed'
 * — a safety net for a generation whose fire-and-forget async function never
 * reached its own catch block (e.g. the process restarted mid-call), so a
 * doctor is never left staring at an infinite "Generating..." spinner.
 *
 * Same shape as visitAutoCloser.js: run once at startup, then on a timer,
 * once per tenant, each inside its own tenant context.
 */
const tenantContext = require('../tenantContext');

const STUCK_MINUTES = 3;

// Rows swept per tenant per pass — bounds one tenant's backlog the same way
// visitAutoCloser.js's own MAX_PER_PASS does; anything left over is picked up
// on the next timer tick.
const MAX_PER_PASS = 200;

const STUCK_ROWS = `
  SELECT id FROM clinical_insights
   WHERE status = 'pending'
     AND created_at < NOW() - (:minutes * INTERVAL '1 minute')
   ORDER BY created_at ASC
   LIMIT :limit
`;

async function sweepStuckInsightsCurrentTenant() {
  const { sequelize } = require('../models');

  const [stuck] = await sequelize.query(STUCK_ROWS, { replacements: { minutes: STUCK_MINUTES, limit: MAX_PER_PASS } });

  let failed = 0;
  for (const row of stuck) {
    try {
      await sequelize.query(
        `UPDATE clinical_insights SET status = 'failed', error_message = 'Timed out', updated_at = NOW() WHERE id = ? AND status = 'pending'`,
        { replacements: [row.id] }
      );
      failed += 1;
    } catch (err) {
      console.error(`Clinical Insights sweep: could not fail row ${row.id}: ${err.message}`);
    }
  }

  return { checked: stuck.length, failed };
}

async function sweepStuckInsightsAllTenants() {
  const { Client } = require('../models/platform');
  const { getTenantConnection } = require('../tenantDb');

  const clients = await Client.findAll();
  const summary = { tenants: 0, failed: 0, errored: 0 };

  for (const client of clients) {
    if (!client.schema_name) continue;
    try {
      const connection = await getTenantConnection(client.schema_name);
      const result = await tenantContext.run(connection, sweepStuckInsightsCurrentTenant);
      summary.tenants += 1;
      summary.failed += result.failed;
    } catch (err) {
      summary.errored += 1;
      console.error(`Clinical Insights sweep failed for ${client.schema_name}: ${err.message}`);
    }
  }

  return summary;
}

module.exports = { sweepStuckInsightsAllTenants, sweepStuckInsightsCurrentTenant };

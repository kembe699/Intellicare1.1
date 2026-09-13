/**
 * Auto-close visits a doctor never closed.
 *
 * A "visit" is a lis_test_orders row — it starts 'waiting' when a patient is
 * queued and should end up 'closed' once the doctor finishes with them. If a
 * doctor forgets (or the browser tab just gets closed), the row sits open
 * forever: it keeps showing as an active visit in LIS registration's
 * duplicate-patient lookup, keeps blocking a genuine follow-up visit's
 * "already has an active order" checks, and clutters the queue/history views
 * with episodes that are, in reality, long over. Closing anything still open
 * 24 hours after it started makes "open" mean "actually in progress today",
 * not "nobody remembered to click Close".
 *
 * Same shape as ledgerSweeper.js: run once at startup, then on a timer, once
 * per tenant, each inside its own tenant context.
 */
const tenantContext = require('../tenantContext');

const AUTO_CLOSE_HOURS = parseInt(process.env.VISIT_AUTO_CLOSE_HOURS || '24', 10);

// Rows closed per tenant per pass. Caps how much one tenant's backlog (e.g. the
// first run after this feature ships, against months of never-closed demo-data
// visits) can do in one pass; anything left over is picked up on the next timer
// tick rather than blocking everything else.
const MAX_PER_PASS = parseInt(process.env.VISIT_AUTO_CLOSE_LIMIT || '200', 10);

const STALE_VISITS = `
  SELECT o.id, p.first_name, p.last_name, p.participant_number
    FROM lis_test_orders o
    JOIN lis_participants p ON p.id = o.participant_id
   WHERE o.status != 'closed'
     AND o.created_at < NOW() - (:hours * INTERVAL '1 hour')
   ORDER BY o.created_at ASC
   LIMIT :limit
`;

async function closeStaleVisitsCurrentTenant() {
  const { sequelize } = require('../models');

  const [stale] = await sequelize.query(STALE_VISITS, {
    replacements: { hours: AUTO_CLOSE_HOURS, limit: MAX_PER_PASS },
  });

  let closed = 0;
  for (const visit of stale) {
    try {
      await sequelize.query(
        `UPDATE lis_test_orders SET status = 'closed', updated_at = NOW() WHERE id = ? AND status != 'closed'`,
        { replacements: [visit.id] }
      );
      closed += 1;

      try {
        const rr = require('../routes/reports');
        await rr.logAudit({
          module: 'Clinical', action: 'VISIT_AUTO_CLOSED', entity_type: 'LisTestOrder', entity_id: visit.id,
          user_name: 'System', user_role: 'system',
          description: `Visit auto-closed after ${AUTO_CLOSE_HOURS}h with no action (${visit.first_name} ${visit.last_name}, ${visit.participant_number})`,
        });
      } catch (e) { /* audit failure must never block the close itself */ }
    } catch (err) {
      console.error(`Visit auto-close: could not close order ${visit.id}: ${err.message}`);
    }
  }

  return { checked: stale.length, closed };
}

async function closeStaleVisitsAllTenants() {
  const { Client } = require('../models/platform');
  const { getTenantConnection } = require('../tenantDb');

  const clients = await Client.findAll();
  const summary = { tenants: 0, closed: 0, failed: 0 };

  for (const client of clients) {
    if (!client.schema_name) continue;
    try {
      const connection = await getTenantConnection(client.schema_name);
      const result = await tenantContext.run(connection, closeStaleVisitsCurrentTenant);
      summary.tenants += 1;
      summary.closed += result.closed;
      if (result.closed > 0) {
        console.log(`🕐 Visit auto-close [${client.schema_name}]: closed ${result.closed} stale visit(s).`);
      }
    } catch (err) {
      summary.failed += 1;
      console.error(`Visit auto-close failed for ${client.schema_name}: ${err.message}`);
    }
  }

  return summary;
}

module.exports = { closeStaleVisitsAllTenants, closeStaleVisitsCurrentTenant };

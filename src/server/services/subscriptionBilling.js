// Shared subscription-billing logic used by both the platform admin routes
// (manual invoice creation / mark-paid) and the automatic overdue sweep —
// one place for "how long does a plan's period last" and "what does it mean
// for a client to be currently covered" so the two paths can't drift apart.
const { Op } = require('sequelize');
const { Client, Invoice } = require('../models/platform');

function periodEnd(start, billingPeriod) {
  const end = new Date(start);
  if (billingPeriod === 'monthly') end.setMonth(end.getMonth() + 1);
  else if (billingPeriod === 'quarterly') end.setMonth(end.getMonth() + 3);
  else end.setFullYear(end.getFullYear() + 1); // annual
  end.setDate(end.getDate() - 1);
  return end;
}

async function createInvoiceForClient(client, plan, periodStart) {
  const start = periodStart ? new Date(periodStart) : new Date();
  const end = periodEnd(start, plan.billing_period);
  return Invoice.create({
    client_id: client.id,
    plan_id: plan.id,
    plan_name: plan.name,
    billing_period: plan.billing_period,
    amount: plan.amount,
    period_start: start,
    period_end: end,
    status: 'pending',
  });
}

// A client is "covered" if they have a paid invoice whose period includes
// today. Suspension/reactivation both key off this, not off status flags
// alone, so a client is never suspended while a paid, still-current invoice
// exists, and always suspended the moment their last paid period lapses with
// nothing renewed.
async function isCurrentlyCovered(clientId) {
  const coverage = await getClientCoverage(clientId);
  return coverage.isCovered;
}

// Same lookup as isCurrentlyCovered, but returns the full picture (used by
// the clients list/detail and the dashboard's "expiring soon" widget) instead
// of collapsing it to a boolean. daysUntilExpiry is negative once lapsed —
// callers decide what to do with that (badge color, sort order, etc.).
async function getClientCoverage(clientId) {
  const now = new Date();
  const covering = await Invoice.findOne({
    where: { client_id: clientId, status: 'paid' },
    order: [['period_end', 'DESC']],
  });

  if (!covering) {
    return { periodEnd: null, daysUntilExpiry: null, isCovered: false };
  }

  const periodEnd = new Date(covering.period_end);
  const daysUntilExpiry = Math.ceil((periodEnd - now) / (24 * 60 * 60 * 1000));
  return { periodEnd, daysUntilExpiry, isCovered: daysUntilExpiry >= 0 };
}

// Runs periodically (see index.js) and once at boot. For every active client
// with at least one invoice, checks whether their coverage has lapsed and
// suspends them if so — the automatic-dunning behavior a real SaaS has.
// Clients with zero invoices are left alone (manually-managed, no billing
// cycle to enforce).
async function checkAndSuspendOverdueClients() {
  const now = new Date();

  // Mark any pending invoice whose period has ended as overdue, so the
  // billing UI reflects reality even before/without a paid renewal existing.
  await Invoice.update(
    { status: 'overdue' },
    { where: { status: 'pending', period_end: { [Op.lt]: now } } }
  );

  const activeClients = await Client.findAll({ where: { status: 'active' } });
  let suspendedCount = 0;

  for (const client of activeClients) {
    const hasAnyInvoice = await Invoice.count({ where: { client_id: client.id } });
    if (!hasAnyInvoice) continue; // never billed — not subject to auto-suspension

    const covered = await isCurrentlyCovered(client.id);
    if (!covered) {
      client.status = 'suspended';
      client.suspended_at = now;
      await client.save();
      suspendedCount += 1;
    }
  }

  return { checkedAt: now, suspendedCount };
}

// Marks an invoice paid. If its period had already lapsed (a late payment on
// an overdue invoice, not a renewal paid ahead of time), the period is
// shifted to start from today instead of staying stuck in the past — same
// as real subscription billing, where paying late still buys you a full
// fresh period from the payment date, not from the original due date. Without
// this, a late-paid invoice's period_end would still be in the past and the
// very next overdue sweep would immediately re-suspend the client.
async function markInvoicePaid(invoice, admin) {
  const now = new Date();

  if (new Date(invoice.period_end) < now) {
    invoice.period_start = now;
    invoice.period_end = periodEnd(now, invoice.billing_period);
  }

  invoice.status = 'paid';
  invoice.paid_at = now;
  invoice.marked_paid_by_admin_id = admin.id;
  invoice.marked_paid_by_name = admin.name;
  await invoice.save();

  const client = await Client.findByPk(invoice.client_id);
  if (client && client.status === 'suspended') {
    client.status = 'active';
    client.suspended_at = null;
    await client.save();
  }

  return invoice;
}

module.exports = {
  periodEnd,
  createInvoiceForClient,
  isCurrentlyCovered,
  getClientCoverage,
  checkAndSuspendOverdueClients,
  markInvoicePaid,
};

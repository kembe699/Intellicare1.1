const express = require('express');
const { Client, SubscriptionPlan, Invoice } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');
const { createInvoiceForClient, markInvoicePaid, checkAndSuspendOverdueClients } = require('../../services/subscriptionBilling');

const router = express.Router();
router.use(authenticatePlatformAdmin);

// Create an invoice for a client against one of the subscription plans.
router.post('/invoices', async (req, res) => {
  try {
    const { client_id, plan_id, period_start } = req.body;
    if (!client_id || !plan_id) {
      return res.status(400).json({ error: 'client_id and plan_id are required' });
    }

    const client = await Client.findByPk(client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const plan = await SubscriptionPlan.findByPk(plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const invoice = await createInvoiceForClient(client, plan, period_start);
    res.status(201).json(invoice);
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

router.post('/invoices/:id/mark-paid', async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === 'paid') return res.status(409).json({ error: 'Invoice is already marked paid' });

    await markInvoicePaid(invoice, req.platformAdmin);

    res.json(invoice);
  } catch (error) {
    console.error('Mark invoice paid error:', error);
    res.status(500).json({ error: 'Failed to mark invoice paid' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const where = req.query.client_id ? { client_id: req.query.client_id } : {};
    const invoices = await Invoice.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [{ model: Client, as: 'client', attributes: ['id', 'name', 'code'] }],
    });
    res.json(invoices);
  } catch (error) {
    console.error('List invoices error:', error);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

// Manual trigger for the same sweep the background timer runs — lets the
// admin (or a test) force an immediate re-check instead of waiting for the
// next scheduled pass.
router.post('/check-overdue', async (req, res) => {
  try {
    const result = await checkAndSuspendOverdueClients();
    res.json(result);
  } catch (error) {
    console.error('Check overdue error:', error);
    res.status(500).json({ error: 'Failed to check overdue clients' });
  }
});

module.exports = router;

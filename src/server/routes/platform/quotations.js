const express = require('express');
const { Customer, Quotation, QuotationInvoice, sequelize } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

// Same MAX+1-of-numeric-suffix pattern used for PO numbers in
// routes/procurement.js — year-scoped so numbering resets each year without
// ever colliding with a previous year's sequence.
async function generateQuoteNumber() {
  const year = new Date().getFullYear();
  const [[row]] = await sequelize.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(quote_number, '^.*-', ''), '')::int), 0) AS last
     FROM quotations WHERE quote_number LIKE :prefix AND quote_number ~ '-[0-9]+$'`,
    { replacements: { prefix: `QUO-${year}-%` } }
  );
  const next = (parseInt(row?.last, 10) || 0) + 1;
  return `QUO-${year}-${String(next).padStart(4, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.customer_id) where.customer_id = req.query.customer_id;
    if (req.query.status) where.status = req.query.status;
    const quotations = await Quotation.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'email'] }],
    });
    res.json(quotations);
  } catch (error) {
    console.error('List quotations error:', error);
    res.status(500).json({ error: 'Failed to load quotations' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customer_id, currency, total_amount, deployment_model, concurrent_users, training_hours, scope_notes } = req.body;
    if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });
    if (total_amount === undefined || total_amount === null || isNaN(Number(total_amount))) {
      return res.status(400).json({ error: 'total_amount is required' });
    }
    const customer = await Customer.findByPk(customer_id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const issueDate = new Date();
    const validUntil = new Date(issueDate);
    validUntil.setDate(validUntil.getDate() + 60);

    const quotation = await Quotation.create({
      customer_id,
      quote_number: await generateQuoteNumber(),
      issue_date: issueDate.toISOString().slice(0, 10),
      valid_until: validUntil.toISOString().slice(0, 10),
      currency: (currency || 'USD').toUpperCase(),
      total_amount: Number(total_amount),
      deployment_model: deployment_model === 'on_premise' ? 'on_premise' : 'cloud',
      concurrent_users: concurrent_users ? Number(concurrent_users) : null,
      training_hours: training_hours ? Number(training_hours) : 20,
      scope_notes: scope_notes || null,
      created_by_admin_id: req.platformAdmin?.id || null,
    });
    res.status(201).json(quotation);
  } catch (error) {
    console.error('Create quotation error:', error);
    res.status(500).json({ error: 'Failed to create quotation' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const quotation = await Quotation.findByPk(req.params.id, {
      include: [{ model: Customer, as: 'customer' }, { model: QuotationInvoice, as: 'invoice' }],
    });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    res.json(quotation);
  } catch (error) {
    console.error('Get quotation error:', error);
    res.status(500).json({ error: 'Failed to load quotation' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const quotation = await Quotation.findByPk(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.status !== 'draft') return res.status(409).json({ error: 'Only a draft quotation can be edited' });

    const { currency, total_amount, deployment_model, concurrent_users, training_hours, scope_notes } = req.body;
    await quotation.update({
      ...(currency !== undefined ? { currency: currency.toUpperCase() } : {}),
      ...(total_amount !== undefined ? { total_amount: Number(total_amount) } : {}),
      ...(deployment_model !== undefined ? { deployment_model: deployment_model === 'on_premise' ? 'on_premise' : 'cloud' } : {}),
      ...(concurrent_users !== undefined ? { concurrent_users: concurrent_users ? Number(concurrent_users) : null } : {}),
      ...(training_hours !== undefined ? { training_hours: Number(training_hours) } : {}),
      ...(scope_notes !== undefined ? { scope_notes } : {}),
    });
    res.json(quotation);
  } catch (error) {
    console.error('Update quotation error:', error);
    res.status(500).json({ error: 'Failed to update quotation' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const quotation = await Quotation.findByPk(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    const { status } = req.body;
    if (!['draft', 'sent', 'accepted', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await quotation.update({ status });
    res.json(quotation);
  } catch (error) {
    console.error('Update quotation status error:', error);
    res.status(500).json({ error: 'Failed to update quotation status' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const quotation = await Quotation.findByPk(req.params.id);
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.status !== 'draft') return res.status(409).json({ error: 'Only a draft quotation can be deleted' });
    await quotation.destroy();
    res.json({ message: 'Quotation deleted' });
  } catch (error) {
    console.error('Delete quotation error:', error);
    res.status(500).json({ error: 'Failed to delete quotation' });
  }
});

module.exports = router;

const express = require('express');
const { Customer, Quotation, QuotationInvoice, sequelize } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

// Same MAX+1-of-numeric-suffix pattern used for quote numbers (and PO
// numbers in the tenant side's procurement.js) — year-scoped so numbering
// resets each year without colliding with a previous year's sequence.
async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const [[row]] = await sequelize.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '^.*-', ''), '')::int), 0) AS last
     FROM quotation_invoices WHERE invoice_number LIKE :prefix AND invoice_number ~ '-[0-9]+$'`,
    { replacements: { prefix: `INV-${year}-%` } }
  );
  const next = (parseInt(row?.last, 10) || 0) + 1;
  return `INV-${year}-${String(next).padStart(4, '0')}`;
}

// Recomputed from amount_paid vs. total_amount on every write, rather than
// ever set directly, so "partial — here's how much and what's left" can
// never drift out of sync with a manually-toggled flag.
function deriveStatus(amountPaid, totalAmount) {
  if (amountPaid <= 0) return 'unpaid';
  if (amountPaid >= totalAmount) return 'paid';
  return 'partial';
}

router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.customer_id) where.customer_id = req.query.customer_id;
    const invoices = await QuotationInvoice.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name', 'email'] },
        { model: Quotation, as: 'quotation', attributes: ['id', 'quote_number'] },
      ],
    });
    res.json(invoices);
  } catch (error) {
    console.error('List quotation invoices error:', error);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

// Converts an accepted quotation into an invoice — snapshots currency and
// total_amount at this moment, same reasoning Invoice already uses for
// plan_name/amount, so a later change never rewrites an issued invoice.
router.post('/', async (req, res) => {
  try {
    const { quotation_id } = req.body;
    if (!quotation_id) return res.status(400).json({ error: 'quotation_id is required' });

    const quotation = await Quotation.findByPk(quotation_id, { include: [{ model: Customer, as: 'customer' }] });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.status !== 'accepted') {
      return res.status(409).json({ error: 'Only an accepted quotation can be converted to an invoice' });
    }

    const existing = await QuotationInvoice.findOne({ where: { quotation_id } });
    if (existing) return res.status(409).json({ error: `This quotation already has invoice ${existing.invoice_number}` });

    const invoice = await QuotationInvoice.create({
      quotation_id: quotation.id,
      customer_id: quotation.customer_id,
      invoice_number: await generateInvoiceNumber(),
      issue_date: new Date().toISOString().slice(0, 10),
      currency: quotation.currency,
      total_amount: quotation.total_amount,
      amount_paid: 0,
      status: 'unpaid',
      created_by_admin_id: req.platformAdmin?.id || null,
    });
    res.status(201).json(invoice);
  } catch (error) {
    console.error('Create quotation invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const invoice = await QuotationInvoice.findByPk(req.params.id, {
      include: [
        { model: Customer, as: 'customer' },
        { model: Quotation, as: 'quotation', attributes: ['id', 'quote_number', 'deployment_model'] },
      ],
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    console.error('Get quotation invoice error:', error);
    res.status(500).json({ error: 'Failed to load invoice' });
  }
});

// Records a payment against the invoice's outstanding balance — the only
// way amount_paid/status change, so they can never be set to something
// inconsistent with each other (e.g. "paid" with money still owed).
router.post('/:id/payments', async (req, res) => {
  try {
    const invoice = await QuotationInvoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a payment amount greater than zero' });

    const currentPaid = Number(invoice.amount_paid);
    const total = Number(invoice.total_amount);
    const balance = total - currentPaid;
    if (amount > balance + 0.005) { // small epsilon for decimal rounding
      return res.status(400).json({ error: `Amount exceeds the balance due (${balance.toFixed(2)})` });
    }

    const newPaid = Math.min(total, currentPaid + amount);
    await invoice.update({ amount_paid: newPaid, status: deriveStatus(newPaid, total) });
    res.json(invoice);
  } catch (error) {
    console.error('Record invoice payment error:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

module.exports = router;

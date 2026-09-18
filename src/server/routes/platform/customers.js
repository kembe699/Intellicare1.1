const express = require('express');
const { Op } = require('sequelize');
const { Customer, Quotation } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.search) {
      const q = `%${req.query.search}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: q } },
        { contact_person: { [Op.iLike]: q } },
        { email: { [Op.iLike]: q } },
      ];
    }
    const customers = await Customer.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [{ model: Quotation, as: 'quotations', attributes: ['id', 'status', 'total_amount'] }],
    });
    const withCount = customers.map((c) => {
      const json = c.toJSON();
      return { ...json, quotationCount: (json.quotations || []).length, quotations: undefined };
    });
    res.json(withCount);
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ error: 'Failed to load customers' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Customer name is required' });
    const customer = await Customer.create({
      name: name.trim(),
      contact_person: contact_person || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      notes: notes || null,
    });
    res.status(201).json(customer);
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id, {
      include: [{ model: Quotation, as: 'quotations', order: [['created_at', 'DESC']] }],
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Failed to load customer' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const { name, contact_person, email, phone, address, notes } = req.body;
    if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'Customer name is required' });
    await customer.update({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(contact_person !== undefined ? { contact_person } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    res.json(customer);
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const quotationCount = await Quotation.count({ where: { customer_id: customer.id } });
    if (quotationCount > 0) {
      return res.status(409).json({ error: `Cannot delete — this customer has ${quotationCount} quotation(s). Delete those first.` });
    }
    await customer.destroy();
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

module.exports = router;

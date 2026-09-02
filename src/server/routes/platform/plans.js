const express = require('express');
const { SubscriptionPlan } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');

const router = express.Router();
router.use(authenticatePlatformAdmin);

router.get('/', async (req, res) => {
  try {
    const plans = await SubscriptionPlan.findAll({ order: [['amount', 'ASC']] });
    res.json(plans);
  } catch (error) {
    console.error('List plans error:', error);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, amount, billing_period } = req.body;
    if (!name || amount === undefined || amount === null) {
      return res.status(400).json({ error: 'name and amount are required' });
    }
    if (!['monthly', 'quarterly', 'annual'].includes(billing_period)) {
      return res.status(400).json({ error: "billing_period must be 'monthly', 'quarterly', or 'annual'" });
    }
    const plan = await SubscriptionPlan.create({ name, amount, billing_period });
    res.status(201).json(plan);
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { name, amount, billing_period, is_active } = req.body;
    if (billing_period && !['monthly', 'quarterly', 'annual'].includes(billing_period)) {
      return res.status(400).json({ error: "billing_period must be 'monthly', 'quarterly', or 'annual'" });
    }

    if (name !== undefined) plan.name = name;
    if (amount !== undefined) plan.amount = amount;
    if (billing_period !== undefined) plan.billing_period = billing_period;
    if (is_active !== undefined) plan.is_active = is_active;
    await plan.save();

    res.json(plan);
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

module.exports = router;

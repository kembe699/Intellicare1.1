const express = require('express');
const { Op } = require('sequelize');
const { Client, Invoice } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');
const { getClientCoverage } = require('../../services/subscriptionBilling');

const router = express.Router();
router.use(authenticatePlatformAdmin);

router.get('/', async (req, res) => {
  try {
    const [totalClients, activeClients, suspendedClients] = await Promise.all([
      Client.count(),
      Client.count({ where: { status: 'active' } }),
      Client.count({ where: { status: 'suspended' } }),
    ]);

    const paidInvoices = await Invoice.findAll({ where: { status: 'paid' }, attributes: ['amount', 'paid_at'] });
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + Number(i.amount), 0);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const revenueThisMonth = paidInvoices
      .filter((i) => i.paid_at && new Date(i.paid_at) >= startOfMonth)
      .reduce((sum, i) => sum + Number(i.amount), 0);

    // Last 6 months, oldest first, zero-filled — a bar chart needs every
    // bucket present even when no invoice was paid that month.
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('en-US', { month: 'short' }) });
    }
    const revenueByMonth = months.map(({ year, month, label }) => {
      const revenue = paidInvoices
        .filter((i) => {
          if (!i.paid_at) return false;
          const d = new Date(i.paid_at);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, i) => sum + Number(i.amount), 0);
      return { month: label, revenue };
    });

    const [outstandingCount, outstandingSum] = await Promise.all([
      Invoice.count({ where: { status: { [Op.in]: ['pending', 'overdue'] } } }),
      Invoice.sum('amount', { where: { status: { [Op.in]: ['pending', 'overdue'] } } }),
    ]);

    // Expiring soon: active clients whose current paid coverage ends within
    // 14 days (including already-lapsed ones the periodic sweep hasn't
    // caught yet), soonest first.
    const activeClientRows = await Client.findAll({ where: { status: 'active' }, order: [['name', 'ASC']] });
    const withCoverage = await Promise.all(
      activeClientRows.map(async (c) => ({ ...c.toJSON(), ...(await getClientCoverage(c.id)) }))
    );
    const expiringSoon = withCoverage
      .filter((c) => c.daysUntilExpiry !== null && c.daysUntilExpiry <= 14)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
      .slice(0, 10);

    res.json({
      totalClients,
      activeClients,
      suspendedClients,
      totalRevenue,
      revenueThisMonth,
      revenueByMonth,
      outstandingCount,
      outstandingAmount: Number(outstandingSum) || 0,
      expiringSoon,
    });
  } catch (error) {
    console.error('Platform dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;

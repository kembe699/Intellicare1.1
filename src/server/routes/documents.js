const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const PDFGenerator = require('../services/PDFGenerator');

// Helper: get company info from clinic
async function getCompanyInfo(clinicId) {
  try {
    const [rows] = await sequelize.query(`SELECT * FROM clinics WHERE id=? LIMIT 1`, { replacements: [clinicId || 1] });
    const c = rows[0] || {};
    return {
      name: c.name || 'IntelliCare Medical Center',
      address: c.address || '',
      city: c.city || '',
      phone: c.phone || '',
      email: c.email || '',
    };
  } catch { return { name: 'IntelliCare Medical Center' }; }
}

// ══════════════════════════════════════════════════════════════
// GET /invoice/:id/pdf — Generate invoice PDF
// ══════════════════════════════════════════════════════════════
router.get('/invoice/:id/pdf', async (req, res) => {
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id] });
    if (!inv.length) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = inv[0];

    const [items] = await sequelize.query(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY created_at`, { replacements: [req.params.id] });
    const [payments] = await sequelize.query(`SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY payment_date`, { replacements: [req.params.id] });

    const company = await getCompanyInfo(invoice.clinic_id);
    const subtotal = parseFloat(invoice.amount) || 0;

    const pdfData = {
      company,
      documentNumber: invoice.invoice_number,
      date: invoice.created_at,
      dueDate: invoice.due_date,
      terms: invoice.payment_terms,
      status: invoice.status,
      customerName: invoice.patient_name,
      currency: invoice.currency || 'SSP',
      items: items.map(it => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unit_price,
        amount: it.amount,
        currency: it.currency,
      })),
      subtotal,
      total: subtotal,
      amountPaid: parseFloat(invoice.amount_paid) || 0,
      balanceDue: parseFloat(invoice.balance_due) || 0,
      notes: invoice.notes || (payments.length > 0
        ? `Payment history: ${payments.map(p => `${new Date(p.payment_date).toLocaleDateString()} - ${invoice.currency || 'SSP'} ${parseFloat(p.amount).toFixed(2)} (${p.payment_method})`).join('; ')}`
        : null),
    };

    const buffer = await PDFGenerator.generate('invoice', pdfData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Invoice PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /bill/:id/pdf — Generate patient bill PDF
// ══════════════════════════════════════════════════════════════
router.get('/bill/:id/pdf', async (req, res) => {
  try {
    const [bills] = await sequelize.query(`SELECT pb.* FROM patient_bills pb WHERE pb.id=?`, { replacements: [req.params.id] });
    if (!bills.length) return res.status(404).json({ error: 'Bill not found' });
    const bill = bills[0];

    let services = [];
    try {
      services = typeof bill.services === 'string' ? JSON.parse(bill.services) : (bill.services || []);
    } catch { services = []; }

    const company = await getCompanyInfo(bill.clinic_id);
    const currency = services.find(s => s.currency && s.currency !== 'SSP')?.currency || 'SSP';

    const pdfData = {
      company,
      documentNumber: bill.bill_number || `BILL-${bill.id?.substring(0, 8)}`,
      date: bill.created_at || bill.bill_date,
      customerName: bill.patient_name || bill.patient_id,
      currency,
      items: services.map(s => ({
        description: s.serviceName || s.name || s.service_name || 'Service',
        quantity: s.quantity || 1,
        unitPrice: s.price || s.unitPrice || s.unit_price || 0,
        amount: s.totalPrice || s.total_price || ((s.price || 0) * (s.quantity || 1)),
        currency: s.currency || currency,
      })),
      subtotal: parseFloat(bill.total_amount) || 0,
      total: parseFloat(bill.total_amount) || 0,
      amountPaid: parseFloat(bill.paid_amount) || 0,
      balanceDue: parseFloat(bill.balance_amount) || 0,
      notes: bill.notes || null,
    };

    const buffer = await PDFGenerator.generate('bill', pdfData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfData.documentNumber}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Bill PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /receipt/:id/pdf — Generate receipt PDF
// ══════════════════════════════════════════════════════════════
router.get('/receipt/:id/pdf', async (req, res) => {
  try {
    const [receipts] = await sequelize.query(
      `SELECT r.*, pb.patient_name as bill_patient_name, pb.services as bill_services, pb.total_amount as bill_total
       FROM receipts r
       LEFT JOIN patient_bills pb ON r.bill_id = pb.id
       WHERE r.id=?`,
      { replacements: [req.params.id] }
    );
    if (!receipts.length) return res.status(404).json({ error: 'Receipt not found' });
    const receipt = receipts[0];

    let services = [];
    try {
      const svcData = receipt.service_details || receipt.paid_services || receipt.bill_services;
      services = typeof svcData === 'string' ? JSON.parse(svcData) : (svcData || []);
    } catch { services = []; }

    const company = await getCompanyInfo(receipt.clinic_id);
    const amount = parseFloat(receipt.amount) || 0;

    const pdfData = {
      company,
      documentNumber: receipt.receipt_number || `RCP-${receipt.id?.substring(0, 8)}`,
      date: receipt.payment_date || receipt.created_at,
      customerName: receipt.patient_name || receipt.bill_patient_name || 'Patient',
      currency: receipt.currency || 'SSP',
      items: services.length > 0 ? services.map(s => ({
        description: s.serviceName || s.name || s.service_name || 'Service',
        quantity: s.quantity || 1,
        unitPrice: s.price || s.unitPrice || s.unit_price || 0,
        amount: s.totalPrice || s.total_price || s.amount || ((s.price || 0) * (s.quantity || 1)),
        currency: s.currency || receipt.currency || 'SSP',
      })) : [{
        description: 'Payment',
        quantity: 1,
        unitPrice: amount,
        amount: amount,
      }],
      total: amount,
      amountPaid: amount,
      balanceDue: 0,
      notes: `Payment Method: ${(receipt.payment_method || 'Cash').replace('_', ' ')}${receipt.reference_number ? ` | Ref: ${receipt.reference_number}` : ''}`,
    };

    const buffer = await PDFGenerator.generate('receipt', pdfData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfData.documentNumber}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Receipt PDF error:', err);
    res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const PDFGenerator = require('../services/PDFGenerator');
const { authorize } = require('../middleware/authorize');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// None of these three routes had ANY authorize() call or branch check —
// confirmed by reading the whole file: any authenticated user, any branch,
// could fetch any invoice/bill/receipt PDF (patient name, amounts, payment
// method) by ID. Matches the privilege + branch-check pattern the records'
// own GET routes already use (patientBills.js's GET /:billId).
function assertCanAccess(req, res, record, label) {
  if (!BranchQueryFilter.canAccessRecord(record, req.branchContext || { branchId: req.user?.branchId || null, isAdmin: req.user?.role === 'admin' })) {
    res.status(403).json({ error: `Access denied to this ${label}` });
    return false;
  }
  return true;
}

// Helper: get the tenant's real facility info (tenant-wide single row —
// the `clinics` table this used to query doesn't exist in any tenant schema,
// which is why this always fell through to a hardcoded "IntelliCare" name).
async function getCompanyInfo() {
  try {
    const [rows] = await sequelize.query(`SELECT * FROM facilities ORDER BY created_at ASC LIMIT 1`);
    const c = rows[0] || {};
    return {
      name: c.name || '',
      address: c.address || '',
      city: c.city || '',
      phone: c.phone || '',
      email: c.email || '',
      logo: c.logo || null,
    };
  } catch { return { name: '' }; }
}

// Helper: resolve the display name of whoever created a record, given a raw
// `created_by` value that may be a numeric user id (invoices) or already a
// display name (patient_bills, receipts.cashier_name).
async function resolveCreatedByName(createdBy) {
  if (!createdBy) return null;
  const raw = String(createdBy).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    try {
      const [rows] = await sequelize.query(`SELECT display_name FROM users WHERE id=? LIMIT 1`, { replacements: [raw] });
      return rows[0]?.display_name || null;
    } catch { return null; }
  }
  return raw;
}

// ══════════════════════════════════════════════════════════════
// GET /invoice/:id/pdf — Generate invoice PDF
// ══════════════════════════════════════════════════════════════
router.get('/invoice/:id/pdf', authorize('bills.read'), async (req, res) => {
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id] });
    if (!inv.length) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = inv[0];
    if (!assertCanAccess(req, res, invoice, 'invoice')) return;

    const [items] = await sequelize.query(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY created_at`, { replacements: [req.params.id] });
    const [payments] = await sequelize.query(`SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY payment_date`, { replacements: [req.params.id] });

    const company = await getCompanyInfo();
    const createdByName = await resolveCreatedByName(invoice.created_by);
    const subtotal = parseFloat(invoice.amount) || 0;

    const pdfData = {
      company,
      createdByName,
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
router.get('/bill/:id/pdf', authorize('bills.read'), async (req, res) => {
  try {
    const [bills] = await sequelize.query(`SELECT pb.* FROM patient_bills pb WHERE pb.id=?`, { replacements: [req.params.id] });
    if (!bills.length) return res.status(404).json({ error: 'Bill not found' });
    const bill = bills[0];
    if (!assertCanAccess(req, res, bill, 'bill')) return;

    let services = [];
    try {
      services = typeof bill.services === 'string' ? JSON.parse(bill.services) : (bill.services || []);
    } catch { services = []; }

    const company = await getCompanyInfo();
    const createdByName = await resolveCreatedByName(bill.created_by);
    // Line items never carry their own `currency` key (confirmed across every
    // write path in patientBills.js) — the bill's real currency is
    // `patient_bills.bill_currency`, the same field every other reader in
    // this codebase uses (receipts.js, billingEnhanced.js, AccountingService.js).
    const currency = bill.bill_currency || 'SSP';

    const pdfData = {
      company,
      createdByName,
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
router.get('/receipt/:id/pdf', authorize('bills.read'), async (req, res) => {
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
    if (!assertCanAccess(req, res, receipt, 'receipt')) return;

    let services = [];
    try {
      const svcData = receipt.service_details || receipt.paid_services || receipt.bill_services;
      services = typeof svcData === 'string' ? JSON.parse(svcData) : (svcData || []);
    } catch { services = []; }

    const company = await getCompanyInfo();
    const createdByName = await resolveCreatedByName(receipt.cashier_name);
    const amount = parseFloat(receipt.amount) || 0;

    const pdfData = {
      company,
      createdByName,
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

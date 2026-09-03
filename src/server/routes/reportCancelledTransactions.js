// ══════════════════════════════════════════════════════════════════════════
// Cancelled / Refunded Transactions Report
//
// Section 1: receipts with status IN ('voided', 'refunded') — the actual
// cancelled/refunded payment records (receipts.status enum is
// 'active' | 'voided' | 'refunded'; as of 2026-07 every live row is
// 'active', so this section is expected to render empty until the first
// void/refund happens — that is the correct, honest result, not a bug).
//
// Section 2: voided line items inside patient_bills.services JSON — a
// DIFFERENT concept (a single service line marked isVoided: true on an
// otherwise-live bill, see src/pages/BillDetails.tsx). Reported separately
// so the two concepts are never blended into one table.
//
// Every query here is PostgreSQL syntax, verified against the live
// `intellicare` DB before shipping (this codebase has a documented history
// of Postgres-only SQL silently failing on MySQL).
//
// Mount as:
//   const reportCancelledTransactionsRouter = require('./routes/reportCancelledTransactions');
//   app.use('/api/reports-v2/cancelled-transactions', reportCancelledTransactionsRouter);
//
// (Mount AFTER `app.use('/api', authenticateToken)` so req.user is populated —
// this router does not add its own auth middleware.)
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');

/** Returns today's date as YYYY-MM-DD in server-local time (SQL DATE format). */
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Basic YYYY-MM-DD validator — reject anything else so we don't hand raw junk to the database. */
function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// GET /  -- cancelled/refunded receipts + voided bill line items for a date range
// Query params:
//   dateFrom, dateTo  (YYYY-MM-DD, both default to today)
//   clinic_id         (optional; scopes to a single clinic if provided)
router.get('/', async (req, res) => {
  try {
    const today = todayISO();
    const dateFrom = isValidDate(req.query.dateFrom) ? req.query.dateFrom : today;
    const dateTo = isValidDate(req.query.dateTo) ? req.query.dateTo : today;
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id, 10) : null;

    const clinicSQL = clinicId ? ' AND r.clinic_id = ?' : '';
    const clinicParams = clinicId ? [clinicId] : [];

    // ── Section 1: cancelled / refunded receipts ────────────────────────────
    const [receiptRows] = await sequelize.query(
      `SELECT
         r.id,
         r.receipt_number,
         r.patient_id,
         r.patient_name,
         r.payment_amount,
         r.payment_method,
         r.cashier_id,
         COALESCE(u.display_name, r.cashier_name, 'Unknown') AS cashier_name,
         r.status,
         r.notes,
         r.payment_date,
         r.updated_at
       FROM receipts r
       LEFT JOIN users u ON u.id = r.cashier_id
       WHERE r.status IN ('voided', 'refunded')
         AND DATE(r.payment_date) BETWEEN ? AND ?
         ${clinicSQL}
       ORDER BY r.updated_at DESC`,
      { replacements: [dateFrom, dateTo, ...clinicParams] }
    );

    const cancelledReceipts = receiptRows.map((r) => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      patientId: r.patient_id,
      patientName: r.patient_name,
      amount: parseFloat(r.payment_amount) || 0,
      paymentMethod: r.payment_method,
      cashierId: r.cashier_id ?? null,
      cashierName: r.cashier_name,
      status: r.status,
      note: r.notes || null,
      paymentDate: r.payment_date,
      updatedAt: r.updated_at,
    }));

    const receiptCount = cancelledReceipts.length;
    const receiptValue = cancelledReceipts.reduce((sum, r) => sum + r.amount, 0);
    const voidedCount = cancelledReceipts.filter((r) => r.status === 'voided').length;
    const refundedCount = cancelledReceipts.filter((r) => r.status === 'refunded').length;

    // ── Section 2: voided line items within otherwise-live bills ───────────
    // patient_bills.services is a JSON array of service line objects; a line
    // is "voided" when it carries isVoided === true. This is scanned in JS
    // (not a SQL JSON function) so the shape of legacy rows can be handled defensively.
    const clinicBillSQL = clinicId ? ' AND clinic_id = ?' : '';
    const clinicBillParams = clinicId ? [clinicId] : [];
    const [billRows] = await sequelize.query(
      `SELECT id, bill_number, patient_id, patient_name, clinic_id, services, bill_date, updated_by, updated_at
       FROM patient_bills
       WHERE DATE(bill_date) BETWEEN ? AND ?
         ${clinicBillSQL}`,
      { replacements: [dateFrom, dateTo, ...clinicBillParams] }
    );

    const voidedLineItems = [];
    for (const bill of billRows) {
      let services = bill.services;
      if (typeof services === 'string') {
        try { services = JSON.parse(services); } catch { services = []; }
      }
      if (!Array.isArray(services)) continue;
      services.forEach((svc, idx) => {
        if (svc && svc.isVoided === true) {
          voidedLineItems.push({
            billId: bill.id,
            billNumber: bill.bill_number,
            patientId: bill.patient_id,
            patientName: bill.patient_name,
            lineIndex: idx,
            serviceName: svc.serviceName || svc.name || 'Unknown service',
            amount: parseFloat(svc.totalPrice) || 0,
            billDate: bill.bill_date,
            updatedBy: bill.updated_by || null,
            updatedAt: bill.updated_at,
          });
        }
      });
    }

    const voidedLineCount = voidedLineItems.length;
    const voidedLineValue = voidedLineItems.reduce((sum, v) => sum + v.amount, 0);

    res.json({
      dateFrom,
      dateTo,
      clinicId,
      cancelledReceipts,
      voidedLineItems,
      summary: {
        cancelledCount: receiptCount,
        cancelledValue: receiptValue,
        voidedReceiptCount: voidedCount,
        refundedReceiptCount: refundedCount,
        voidedLineItemCount: voidedLineCount,
        voidedLineItemValue: voidedLineValue,
      },
    });
  } catch (err) {
    console.error('Cancelled/refunded transactions report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

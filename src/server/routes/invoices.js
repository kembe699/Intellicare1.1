const express = require('express');
const { getBaseCurrencyCode } = require('../utils/baseCurrency');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /invoices, so the API enforces what the client already assumes.
const router = express.Router();
const { sequelize, ChartOfAccounts } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { resolveCashOrBankAccount } = require('./patientDeposits');
const { postJournalEntry: sharedPostJournalEntry } = require('../services/JournalPostingService');

// Neither invoice creation nor invoice payment ever touched the general ledger — an
// insurance/credit invoice's receivable and its eventual collection were invisible to
// accounting entirely. Two distinct postings close that gap, both best-effort/non-blocking
// (mirrors every other GL block added this session — a failure here never fails the
// invoice action itself):
//
//  1. Creation (only when the invoice has no bill_id — see POST / below): the amount was
//     never billed/posted anywhere before (this is exactly the "unbilled insurance line"
//     case — billed at 0 in SSP with the real price only stashed for this claim), so this
//     is genuinely new receivable + revenue. Debit the receivable, credit revenue.
//  2. Payment (POST /:id/payments and PUT /:id/mark-paid): whatever was originally debited
//     — either here at creation, or back at the underlying bill's own creation for a
//     bill_id-linked invoice — needs to clear when the insurer/patient actually pays.
//     Debit Cash/Bank, credit the same receivable account.
//
// Both resolve 1210 Insurance Receivables for a scheme-linked invoice, 1200 Accounts
// Receivable - Patients otherwise — matching the exact same choice already wired into
// AccountingService.createGLFromPatientBill and patientBills.js's payment GL block.
async function resolveReceivableAccount(clinicId, schemeId, transaction) {
  const code = schemeId ? '1210' : '1200';
  return (await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: code, is_active: true }, transaction }))
    || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1200', is_active: true }, transaction });
}

// N2/N3: delegates to the shared helper — REQUIRES the caller's own open
// transaction (no more internal t2/best-effort swallowing). Every call site
// below now posts inside the same transaction as the invoice/payment write
// it belongs to.
async function postInvoiceJournalEntry({ clinicId, branchId, amount, currency, debitAccount, creditAccount, reference, description, userId, transaction, entryDate }) {
  if (!debitAccount || !creditAccount || !(amount > 0)) return null;
  const today = entryDate || new Date().toISOString().split('T')[0];
  return sharedPostJournalEntry({
    // C2: this used to hardcode BASE_CURRENCY and every caller below skipped
    // posting entirely for a foreign-currency invoice ("ledger is SSP-only")
    // rather than convert — a real gap, not just a silent-1:1 bug, but the
    // same underlying problem: a foreign-currency invoice never reached the
    // ledger at all. Now converts properly via the shared helper, same as
    // every other posting path.
    clinicId, branchId, transaction, entryDate: today, description, reference, currency: currency || (await getBaseCurrencyCode(transaction)),
    lines: [
      { accountId: debitAccount.id, debit: amount, description },
      { accountId: creditAccount.id, credit: amount, description },
    ],
    userId,
  });
}

// Scheme attribution for credit-payment invoices (added alongside the Patients Bill credit flow).
(async () => {
  for (const [column, def] of [
    ['scheme_id', 'VARCHAR(36) DEFAULT NULL'],
    ['scheme_name', 'VARCHAR(255) DEFAULT NULL'],
  ]) {
    try {
      await sequelize.query(`ALTER TABLE invoices ADD COLUMN ${column} ${def}`);
      console.log(`✅ Added ${column} to invoices`);
    } catch (e) {
      if (!isDuplicateColumn(e)) {
        console.log(`Note: Could not add ${column} to invoices:`, e.message);
      }
    }
  }
})();

async function generateInvoiceNumber() {
  const d = new Date();
  const prefix = `INV-${d.getFullYear().toString().slice(-2)}${String(d.getMonth()+1).padStart(2,'0')}`;
  const [rows] = await sequelize.query(`SELECT COUNT(*) as cnt FROM invoices WHERE invoice_number LIKE ?`, { replacements: [`${prefix}-%`] });
  return `${prefix}-${String((rows[0]?.cnt||0)+1).padStart(4,'0')}`;
}

// POST / — Create invoice
router.post('/', authorize('invoices.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { bill_id, patient_id, patient_name, clinic_id, amount, currency, payment_terms, due_date, notes, services, scheme_id, scheme_name } = req.body;
    if (!patient_id || !amount) { await t.rollback(); return res.status(400).json({ error: 'patient_id and amount required' }); }

    const id = uuidv4(), invoiceNumber = await generateInvoiceNumber();
    const branchId = getCreateBranchId(req);
    const terms = parseInt(payment_terms) || 30;
    const parsedAmount = parseFloat(amount) || 0;
    const invCurrency = currency || (await getBaseCurrencyCode());
    let dueD = due_date;
    if (!dueD) { const dd = new Date(); dd.setDate(dd.getDate() + terms); dueD = dd.toISOString().split('T')[0]; }

    await sequelize.query(
      `INSERT INTO invoices (id,clinic_id,branch_id,bill_id,patient_id,patient_name,invoice_number,amount,amount_paid,balance_due,currency,payment_terms,due_date,status,notes,scheme_id,scheme_name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,'unpaid',?,?,?,?,NOW(),NOW())`,
      { replacements: [id,clinic_id||1,branchId,bill_id||null,patient_id,patient_name||'Unknown',invoiceNumber,parsedAmount,parsedAmount,invCurrency,terms,dueD,notes||null,scheme_id||null,scheme_name||null,req.user?.userId||null], transaction: t }
    );

    const svcs = typeof services === 'string' ? JSON.parse(services) : (services || []);
    for (const s of svcs) {
      const qty = s.quantity||1, up = parseFloat(s.unitPrice||s.price||s.unit_price||0);
      await sequelize.query(
        `INSERT INTO invoice_items (id,invoice_id,service_id,description,quantity,unit_price,amount,currency,created_at) VALUES (?,?,?,?,?,?,?,?,NOW())`,
        { replacements: [uuidv4(),id,s.serviceId||s.service_id||null,s.serviceName||s.name||s.service_name||'Service',qty,up,parseFloat(s.totalPrice||s.total_price||(up*qty)),s.currency||invCurrency], transaction: t }
      );
    }

    if (bill_id) {
      // Ensure invoice columns exist on patient_bills
      try {
        const [cols] = await sequelize.query("SHOW COLUMNS FROM patient_bills LIKE 'invoice_id'");
        if (cols.length === 0) {
          await sequelize.query("ALTER TABLE patient_bills ADD COLUMN invoice_id CHAR(36) NULL", { transaction: t });
          await sequelize.query("ALTER TABLE patient_bills ADD COLUMN billing_type VARCHAR(20) DEFAULT 'cash'", { transaction: t });
        }
      } catch (e) { console.log('Column check note:', e.message); }
      await sequelize.query(`UPDATE patient_bills SET invoice_id=?, billing_type='credit', status='active' WHERE id=?`, { replacements: [id, bill_id], transaction: t });

      // Mark only the invoiced services as invoiced (not all services)
      try {
        const [billRows] = await sequelize.query(`SELECT services FROM patient_bills WHERE id=?`, { replacements: [bill_id], transaction: t });
        if (billRows.length && billRows[0].services) {
          let svcList = typeof billRows[0].services === 'string' ? JSON.parse(billRows[0].services) : billRows[0].services;
          if (Array.isArray(svcList)) {
            // Create a set of service IDs/names that are being invoiced
            const invoicedServiceIds = new Set(svcs.map(s => s.serviceId || s.service_id));
            const invoicedServiceNames = new Set(svcs.map(s => s.serviceName || s.name || s.service_name));
            
            // A line billed at 0 in SSP with its real price only stashed for a separate
            // insurance claim (BillDetails' isUnbilledInsuranceLine convention) was never
            // actually part of this invoice's amount, even if its name matches — flagging it
            // invoiced here would wrongly lock it out of ever being invoiced for real once its
            // price is later corrected (e.g. once the bill is folded into a scheme).
            const isUnbilledInsuranceLine = s => s.schemePrice != null && (parseFloat(s.unitPrice) || 0) === 0;

            // Only mark services that are in the invoice as invoiced. Deliberately does NOT
            // check the line's current `invoiced` value first — it used to require it not be
            // exactly `false`, but `false` is exactly what an explicitly not-yet-invoiced line
            // is set to (see BillDetails' isPayableLine convention), so that guard silently
            // stopped this exact invoice from ever being able to mark it `true` for real.
            svcList = svcList.map(s => {
              const matchesId = invoicedServiceIds.has(s.serviceId || s.service_id);
              const matchesName = invoicedServiceNames.has(s.serviceName || s.name || s.service_name);

              if ((matchesId || matchesName) && !isUnbilledInsuranceLine(s)) {
                return { ...s, invoiced: true };
              }
              return s;
            });
            
            await sequelize.query(`UPDATE patient_bills SET services=? WHERE id=?`, { replacements: [JSON.stringify(svcList), bill_id], transaction: t });
          }
        }
      } catch (e) { console.log('Mark services invoiced note:', e.message); }
    }

    // N2: posted in the SAME transaction as the invoice insert above, before
    // it commits — it used to be awaited but run AFTER t.commit(), so an
    // invoice could exist with no ledger entry if this failed.
    //
    // Only a standalone invoice (no bill_id) represents genuinely new receivable/revenue —
    // a bill_id-linked one already posted its receivable back when the bill itself was
    // created (AccountingService.createGLFromPatientBill), so posting again here would
    // double it.
    if (!bill_id) {
      const clinicIdNum = clinic_id || 1;
      const receivableAccount = await resolveReceivableAccount(clinicIdNum, scheme_id, t);
      const revenueAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicIdNum, account_code: '4100', is_active: true }, transaction: t });
      await postInvoiceJournalEntry({
        clinicId: clinicIdNum, amount: parsedAmount, currency, debitAccount: receivableAccount, creditAccount: revenueAccount,
        reference: `INV-${id}`, description: `Invoice ${invoiceNumber} — ${patient_name || patient_id}`,
        userId: req.user?.userId, branchId: getCreateBranchId(req), transaction: t,
      });
    }

    await t.commit();
    res.status(201).json({ success: true, data: { id, invoice_number: invoiceNumber, amount: parsedAmount, balance_due: parsedAmount, due_date: dueD, status: 'unpaid' } });
  } catch (err) { if (t && !t.finished) await t.rollback().catch(() => {}); console.error('Create invoice error:', err); res.status(500).json({ error: err.message }); }
});

// GET / — List invoices
router.get('/', async (req, res) => {
  try {
    const { search, status, from, to } = req.query;
    const branch = getBranchConditionSQL(req, 'i');
    let where = 'WHERE 1=1', reps = [];
    if (branch.sql) { where += branch.sql; reps.push(...branch.params); }
    if (search) { where += ` AND (i.invoice_number LIKE ? OR i.patient_name LIKE ?)`; reps.push(`%${search}%`,`%${search}%`); }
    if (status && status !== 'all') { where += ` AND i.status=?`; reps.push(status); }
    if (from) { where += ` AND i.created_at>=?`; reps.push(from); }
    if (to) { where += ` AND i.created_at<=?`; reps.push(`${to} 23:59:59`); }

    await sequelize.query(`UPDATE invoices SET status='overdue' WHERE status IN ('unpaid','partial') AND due_date < CURRENT_DATE`);

    const [invoices] = await sequelize.query(`SELECT i.*, ((CURRENT_DATE)::date - (i.due_date)::date) as days_overdue FROM invoices i ${where} ORDER BY i.created_at DESC LIMIT 500`, { replacements: reps });
    const [stats] = await sequelize.query(`SELECT COUNT(*) as total, COALESCE(SUM(balance_due),0) as outstanding, COALESCE(SUM(CASE WHEN status='overdue' THEN balance_due ELSE 0 END),0) as overdue, COALESCE(SUM(amount_paid),0) as paid, SUM(CASE WHEN status='unpaid' THEN 1 ELSE 0 END) as unpaid_count, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) as paid_count, SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) as overdue_count FROM invoices i ${where}`, { replacements: reps });

    res.json({ data: invoices, stats: stats[0] || {} });
  } catch (err) { console.error('List invoices error:', err); res.status(500).json({ error: err.message }); }
});

// GET /:id — Invoice detail
router.get('/:id', async (req, res) => {
  try {
    const [inv] = await sequelize.query(`SELECT i.*, ((CURRENT_DATE)::date - (i.due_date)::date) as days_overdue FROM invoices i WHERE i.id=?`, { replacements: [req.params.id] });
    if (!inv.length) return res.status(404).json({ error: 'Not found' });
    if (!BranchQueryFilter.canAccessRecord(inv[0], req.branchContext)) return res.status(404).json({ error: 'Not found' });
    const [items] = await sequelize.query(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY created_at`, { replacements: [req.params.id] });
    const [payments] = await sequelize.query(`SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY payment_date DESC`, { replacements: [req.params.id] });
    res.json({ data: { ...inv[0], items, payments } });
  } catch (err) { console.error('Get invoice error:', err); res.status(500).json({ error: err.message }); }
});

// POST /:id/payments — Record payment
router.post('/:id/payments', authorize('invoices.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id], transaction: t });
    if (!inv.length) { await t.rollback(); return res.status(404).json({ error: 'Not found' }); }
    if (!BranchQueryFilter.canAccessRecord(inv[0], req.branchContext)) { await t.rollback(); return res.status(404).json({ error: 'Not found' }); }
    const invoice = inv[0];
    const payAmt = parseFloat(req.body.amount);
    if (!payAmt || payAmt <= 0) { await t.rollback(); return res.status(400).json({ error: 'Invalid amount' }); }
    if (payAmt > parseFloat(invoice.balance_due) + 0.01) { await t.rollback(); return res.status(400).json({ error: 'Exceeds balance' }); }

    const pid = uuidv4();
    await sequelize.query(`INSERT INTO invoice_payments (id,invoice_id,amount,payment_date,payment_method,reference_number,notes,recorded_by,created_at) VALUES (?,?,?,?,?,?,?,?,NOW())`,
      { replacements: [pid,req.params.id,payAmt,req.body.payment_date||new Date().toISOString().split('T')[0],req.body.payment_method||'cash',req.body.reference_number||null,req.body.notes||null,req.user?.userId||null], transaction: t });

    const newPaid = parseFloat(invoice.amount_paid) + payAmt;
    const newBal = Math.max(0, parseFloat(invoice.amount) - newPaid);
    const newStatus = newBal <= 0.01 ? 'paid' : 'partial';

    await sequelize.query(`UPDATE invoices SET amount_paid=?, balance_due=?, status=?, updated_at=NOW() WHERE id=?`, { replacements: [newPaid,newBal,newStatus,req.params.id], transaction: t });

    // An invoice can cover only PART of a bill's balance (invoices are created
    // for "up to" the balance, not required to equal it). Force-marking the
    // whole bill paid here — regardless of the invoice amount — silently wrote
    // off any remaining un-invoiced/cash balance. Increment the bill's
    // paid_amount by only what was actually paid on THIS invoice.
    // (MySQL evaluates SET clauses left-to-right within one UPDATE, so a
    // later clause referencing `paid_amount` sees the value the FIRST clause
    // just wrote, not the original row — compute both new values in JS first
    // to avoid double-applying payAmt.)
    if (invoice.bill_id) {
      const [[billRow]] = await sequelize.query(
        `SELECT total_amount, paid_amount FROM patient_bills WHERE id = ?`,
        { replacements: [invoice.bill_id], transaction: t }
      );
      if (billRow) {
        const billTotal = parseFloat(billRow.total_amount);
        const billNewPaid = Math.min(billTotal, parseFloat(billRow.paid_amount) + payAmt);
        const billNewBalance = Math.max(0, billTotal - billNewPaid);
        const billNewStatus = billNewBalance <= 0.01 ? 'paid' : 'partial';
        await sequelize.query(
          `UPDATE patient_bills SET paid_amount = ?, balance_amount = ?, status = ? WHERE id = ?`,
          { replacements: [billNewPaid, billNewBalance, billNewStatus, invoice.bill_id], transaction: t }
        );
      }
    }

    // N2: posted before commit, in the same transaction as the payment/bill update.
    {
      const clinicIdNum = invoice.clinic_id || 1;
      const method = (req.body.payment_method || 'cash').toLowerCase();
      const cashOrBank = await resolveCashOrBankAccount(clinicIdNum, method, t);
      const receivableAccount = await resolveReceivableAccount(clinicIdNum, invoice.scheme_id, t);
      await postInvoiceJournalEntry({
        clinicId: clinicIdNum, amount: payAmt, currency: invoice.currency, debitAccount: cashOrBank, creditAccount: receivableAccount,
        reference: `INV-${req.params.id}`, description: `Invoice payment — ${invoice.invoice_number} (${method})`,
        userId: req.user?.userId, branchId: getCreateBranchId(req), transaction: t,
      });
    }

    await t.commit();
    res.json({ success: true, data: { payment_id: pid, amount_paid: newPaid, balance_due: newBal, status: newStatus } });
  } catch (err) { if (t && !t.finished) await t.rollback().catch(() => {}); console.error('Payment error:', err); res.status(500).json({ error: err.message }); }
});

// PUT /:id/cancel
router.put('/:id/cancel', authorize('invoices.write'), async (req, res) => {
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id] });
    if (!inv.length) return res.status(404).json({ error: 'Not found' });
    if (!BranchQueryFilter.canAccessRecord(inv[0], req.branchContext)) return res.status(404).json({ error: 'Not found' });
    if (inv[0].status === 'paid') return res.status(400).json({ error: 'Cannot cancel paid invoice' });
    await sequelize.query(`UPDATE invoices SET status='cancelled', updated_at=NOW() WHERE id=?`, { replacements: [req.params.id] });
    if (inv[0].bill_id) await sequelize.query(`UPDATE patient_bills SET invoice_id=NULL, billing_type='cash', status='pending' WHERE id=?`, { replacements: [inv[0].bill_id] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/mark-paid
// N2: this route previously ran five separate, un-transacted writes (insert
// payment, update invoice, update bill, resolve accounts, post GL) — any
// failure partway through left the invoice/bill/ledger disagreeing with no
// way to know which step it stopped at. Now one transaction.
router.put('/:id/mark-paid', authorize('invoices.write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id], transaction: t });
    if (!inv.length) { await t.rollback(); return res.status(404).json({ error: 'Not found' }); }
    if (!BranchQueryFilter.canAccessRecord(inv[0], req.branchContext)) { await t.rollback(); return res.status(404).json({ error: 'Not found' }); }
    const bal = parseFloat(inv[0].balance_due);
    if (bal > 0) {
      await sequelize.query(`INSERT INTO invoice_payments (id,invoice_id,amount,payment_date,payment_method,notes,recorded_by,created_at) VALUES (?,?,?,CURRENT_DATE,'cash','Marked as paid',?,NOW())`, { replacements: [uuidv4(),req.params.id,bal,req.user?.userId||null], transaction: t });
    }
    await sequelize.query(`UPDATE invoices SET amount_paid=amount, balance_due=0, status='paid', updated_at=NOW() WHERE id=?`, { replacements: [req.params.id], transaction: t });
    // Same fix as POST /:id/payments — only the invoice's own outstanding
    // balance (`bal`) was actually just paid off, not the bill's full total.
    if (inv[0].bill_id) {
      const [[billRow]] = await sequelize.query(
        `SELECT total_amount, paid_amount FROM patient_bills WHERE id = ?`,
        { replacements: [inv[0].bill_id], transaction: t }
      );
      if (billRow) {
        const billTotal = parseFloat(billRow.total_amount);
        const billNewPaid = Math.min(billTotal, parseFloat(billRow.paid_amount) + bal);
        const billNewBalance = Math.max(0, billTotal - billNewPaid);
        const billNewStatus = billNewBalance <= 0.01 ? 'paid' : 'partial';
        await sequelize.query(
          `UPDATE patient_bills SET paid_amount = ?, balance_amount = ?, status = ? WHERE id = ?`,
          { replacements: [billNewPaid, billNewBalance, billNewStatus, inv[0].bill_id], transaction: t }
        );
      }
    }

    if (bal > 0) {
      const clinicIdNum = inv[0].clinic_id || 1;
      const cashOrBank = await resolveCashOrBankAccount(clinicIdNum, 'cash', t);
      const receivableAccount = await resolveReceivableAccount(clinicIdNum, inv[0].scheme_id, t);
      await postInvoiceJournalEntry({
        clinicId: clinicIdNum, amount: bal, currency: inv[0].currency, debitAccount: cashOrBank, creditAccount: receivableAccount,
        reference: `INV-${req.params.id}`, description: `Invoice marked paid — ${inv[0].invoice_number}`,
        userId: req.user?.userId, branchId: getCreateBranchId(req), transaction: t,
      });
    }

    await t.commit();
    res.json({ success: true });
  } catch (err) { if (t && !t.finished) await t.rollback().catch(() => {}); res.status(500).json({ error: err.message }); }
});

module.exports = router;

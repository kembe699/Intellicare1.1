const express = require('express');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /invoices, so the API enforces what the client already assumes.
const INVOICE_WRITE = ['admin', 'reception', 'finance_manager', 'accountant'];
const router = express.Router();
const { sequelize, ChartOfAccounts, JournalEntries, JournalEntryLines, AccountLedger } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const { resolveCashOrBankAccount, generateJENumber, BASE_CURRENCY } = require('./patientDeposits');

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
async function resolveReceivableAccount(clinicId, schemeId) {
  const code = schemeId ? '1210' : '1200';
  return (await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: code, is_active: true } }))
    || await ChartOfAccounts.findOne({ where: { clinic_id: clinicId, account_code: '1200', is_active: true } });
}

async function postJournalEntry({ clinicId, amount, debitAccount, creditAccount, reference, description, userId }) {
  try {
    if (!debitAccount || !creditAccount || !(amount > 0)) return;
    const jeNumber = await generateJENumber(clinicId);
    const today = new Date().toISOString().split('T')[0];
    const t2 = await sequelize.transaction();
    try {
      const je = await JournalEntries.create({
        clinic_id: clinicId, je_number: jeNumber, entry_date: today, description,
        narration: reference, reference, transaction_currency: BASE_CURRENCY, base_currency: BASE_CURRENCY,
        exchange_rate: 1.0, total_debit: amount, total_credit: amount, base_total_debit: amount, base_total_credit: amount,
        status: 'posted', created_by: userId || 'system', posted_by: userId || 'system', posted_date: new Date(),
      }, { transaction: t2 });
      await JournalEntryLines.bulkCreate([
        { je_id: je.id, account_id: debitAccount.id, debit_amount: amount, credit_amount: 0, base_debit_amount: amount, base_credit_amount: 0, description },
        { je_id: je.id, account_id: creditAccount.id, debit_amount: 0, credit_amount: amount, base_debit_amount: 0, base_credit_amount: amount, description },
      ], { transaction: t2 });
      await AccountLedger.bulkCreate([
        { clinic_id: clinicId, account_id: debitAccount.id, transaction_date: today, debit_amount: amount, credit_amount: 0, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
        { clinic_id: clinicId, account_id: creditAccount.id, transaction_date: today, debit_amount: 0, credit_amount: amount, reference_number: jeNumber, description, is_posted: true, posted_date: new Date(), source_module: 'billing' },
      ], { transaction: t2 });
      await t2.commit();
      console.log(`Invoice GL posted: ${jeNumber} (${debitAccount.account_name} / ${creditAccount.account_name})`);
    } catch (jeErr) {
      await t2.rollback();
      console.warn('Non-fatal: failed to post invoice GL:', jeErr.message);
    }
  } catch (coaErr) {
    console.warn('Non-fatal: invoice GL posting skipped:', coaErr.message);
  }
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
router.post('/', authorize(INVOICE_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { bill_id, patient_id, patient_name, clinic_id, amount, currency, payment_terms, due_date, notes, services, scheme_id, scheme_name } = req.body;
    if (!patient_id || !amount) { await t.rollback(); return res.status(400).json({ error: 'patient_id and amount required' }); }

    const id = uuidv4(), invoiceNumber = await generateInvoiceNumber();
    const branchId = getCreateBranchId(req);
    const terms = parseInt(payment_terms) || 30;
    const parsedAmount = parseFloat(amount) || 0;
    let dueD = due_date;
    if (!dueD) { const dd = new Date(); dd.setDate(dd.getDate() + terms); dueD = dd.toISOString().split('T')[0]; }

    await sequelize.query(
      `INSERT INTO invoices (id,clinic_id,branch_id,bill_id,patient_id,patient_name,invoice_number,amount,amount_paid,balance_due,currency,payment_terms,due_date,status,notes,scheme_id,scheme_name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,'unpaid',?,?,?,?,NOW(),NOW())`,
      { replacements: [id,clinic_id||1,branchId,bill_id||null,patient_id,patient_name||'Unknown',invoiceNumber,parsedAmount,parsedAmount,currency||'SSP',terms,dueD,notes||null,scheme_id||null,scheme_name||null,req.user?.userId||null], transaction: t }
    );

    const svcs = typeof services === 'string' ? JSON.parse(services) : (services || []);
    for (const s of svcs) {
      const qty = s.quantity||1, up = parseFloat(s.unitPrice||s.price||s.unit_price||0);
      await sequelize.query(
        `INSERT INTO invoice_items (id,invoice_id,service_id,description,quantity,unit_price,amount,currency,created_at) VALUES (?,?,?,?,?,?,?,?,NOW())`,
        { replacements: [uuidv4(),id,s.serviceId||s.service_id||null,s.serviceName||s.name||s.service_name||'Service',qty,up,parseFloat(s.totalPrice||s.total_price||(up*qty)),s.currency||currency||'SSP'], transaction: t }
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

    await t.commit();
    res.status(201).json({ success: true, data: { id, invoice_number: invoiceNumber, amount: parsedAmount, balance_due: parsedAmount, due_date: dueD, status: 'unpaid' } });

    // Only a standalone invoice (no bill_id) represents genuinely new receivable/revenue —
    // a bill_id-linked one already posted its receivable back when the bill itself was
    // created (AccountingService.createGLFromPatientBill), so posting again here would
    // double it. The GL only ever posts in the base currency (SSP) — same rule this app
    // already applies everywhere else to scheme/insurance amounts, since there's no FX-rate
    // conversion step at posting time; a foreign-currency standalone claim is skipped here
    // rather than posted at the wrong magnitude.
    if (!bill_id && (currency || BASE_CURRENCY) === BASE_CURRENCY) {
      const clinicIdNum = clinic_id || 1;
      const receivableAccount = await resolveReceivableAccount(clinicIdNum, scheme_id);
      const revenueAccount = await ChartOfAccounts.findOne({ where: { clinic_id: clinicIdNum, account_code: '4100', is_active: true } });
      // Awaited. Un-awaited, the GL posting raced the response and the
      // surrounding transaction: an invoice could be answered as created while
      // its ledger entry was still being written, or written after a rollback.
      await postJournalEntry({
        clinicId: clinicIdNum, amount: parsedAmount, debitAccount: receivableAccount, creditAccount: revenueAccount,
        reference: `INV-${id}`, description: `Invoice ${invoiceNumber} — ${patient_name || patient_id}`,
        userId: req.user?.userId,
      });
    } else if (!bill_id) {
      console.log(`Note: invoice ${invoiceNumber} is in ${currency} — skipping GL posting (ledger is SSP-only)`);
    }
  } catch (err) { await t.rollback(); console.error('Create invoice error:', err); res.status(500).json({ error: err.message }); }
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
    const [items] = await sequelize.query(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY created_at`, { replacements: [req.params.id] });
    const [payments] = await sequelize.query(`SELECT * FROM invoice_payments WHERE invoice_id=? ORDER BY payment_date DESC`, { replacements: [req.params.id] });
    res.json({ data: { ...inv[0], items, payments } });
  } catch (err) { console.error('Get invoice error:', err); res.status(500).json({ error: err.message }); }
});

// POST /:id/payments — Record payment
router.post('/:id/payments', authorize(INVOICE_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id], transaction: t });
    if (!inv.length) { await t.rollback(); return res.status(404).json({ error: 'Not found' }); }
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

    await t.commit();
    res.json({ success: true, data: { payment_id: pid, amount_paid: newPaid, balance_due: newBal, status: newStatus } });

    if ((invoice.currency || BASE_CURRENCY) === BASE_CURRENCY) {
      const clinicIdNum = invoice.clinic_id || 1;
      const method = (req.body.payment_method || 'cash').toLowerCase();
      const cashOrBank = await resolveCashOrBankAccount(clinicIdNum, method);
      const receivableAccount = await resolveReceivableAccount(clinicIdNum, invoice.scheme_id);
      await postJournalEntry({
        clinicId: clinicIdNum, amount: payAmt, debitAccount: cashOrBank, creditAccount: receivableAccount,
        reference: `INV-${req.params.id}`, description: `Invoice payment — ${invoice.invoice_number} (${method})`,
        userId: req.user?.userId,
      });
    } else {
      console.log(`Note: invoice ${invoice.invoice_number} payment is in ${invoice.currency} — skipping GL posting (ledger is SSP-only)`);
    }
  } catch (err) { await t.rollback(); console.error('Payment error:', err); res.status(500).json({ error: err.message }); }
});

// PUT /:id/cancel
router.put('/:id/cancel', authorize(INVOICE_WRITE), async (req, res) => {
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id] });
    if (!inv.length) return res.status(404).json({ error: 'Not found' });
    if (inv[0].status === 'paid') return res.status(400).json({ error: 'Cannot cancel paid invoice' });
    await sequelize.query(`UPDATE invoices SET status='cancelled', updated_at=NOW() WHERE id=?`, { replacements: [req.params.id] });
    if (inv[0].bill_id) await sequelize.query(`UPDATE patient_bills SET invoice_id=NULL, billing_type='cash', status='pending' WHERE id=?`, { replacements: [inv[0].bill_id] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /:id/mark-paid
router.put('/:id/mark-paid', authorize(INVOICE_WRITE), async (req, res) => {
  try {
    const [inv] = await sequelize.query(`SELECT * FROM invoices WHERE id=?`, { replacements: [req.params.id] });
    if (!inv.length) return res.status(404).json({ error: 'Not found' });
    const bal = parseFloat(inv[0].balance_due);
    if (bal > 0) {
      await sequelize.query(`INSERT INTO invoice_payments (id,invoice_id,amount,payment_date,payment_method,notes,recorded_by,created_at) VALUES (?,?,?,CURRENT_DATE,'cash','Marked as paid',?,NOW())`, { replacements: [uuidv4(),req.params.id,bal,req.user?.userId||null] });
    }
    await sequelize.query(`UPDATE invoices SET amount_paid=amount, balance_due=0, status='paid', updated_at=NOW() WHERE id=?`, { replacements: [req.params.id] });
    // Same fix as POST /:id/payments — only the invoice's own outstanding
    // balance (`bal`) was actually just paid off, not the bill's full total.
    if (inv[0].bill_id) {
      const [[billRow]] = await sequelize.query(
        `SELECT total_amount, paid_amount FROM patient_bills WHERE id = ?`,
        { replacements: [inv[0].bill_id] }
      );
      if (billRow) {
        const billTotal = parseFloat(billRow.total_amount);
        const billNewPaid = Math.min(billTotal, parseFloat(billRow.paid_amount) + bal);
        const billNewBalance = Math.max(0, billTotal - billNewPaid);
        const billNewStatus = billNewBalance <= 0.01 ? 'paid' : 'partial';
        await sequelize.query(
          `UPDATE patient_bills SET paid_amount = ?, balance_amount = ?, status = ? WHERE id = ?`,
          { replacements: [billNewPaid, billNewBalance, billNewStatus, inv[0].bill_id] }
        );
      }
    }
    res.json({ success: true });

    if (bal > 0 && (inv[0].currency || BASE_CURRENCY) === BASE_CURRENCY) {
      const clinicIdNum = inv[0].clinic_id || 1;
      const cashOrBank = await resolveCashOrBankAccount(clinicIdNum, 'cash');
      const receivableAccount = await resolveReceivableAccount(clinicIdNum, inv[0].scheme_id);
      await postJournalEntry({
        clinicId: clinicIdNum, amount: bal, debitAccount: cashOrBank, creditAccount: receivableAccount,
        reference: `INV-${req.params.id}`, description: `Invoice marked paid — ${inv[0].invoice_number}`,
        userId: req.user?.userId,
      });
    } else if (bal > 0) {
      console.log(`Note: invoice ${inv[0].invoice_number} is in ${inv[0].currency} — skipping GL posting (ledger is SSP-only)`);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

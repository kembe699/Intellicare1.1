const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /billing-management, so the API enforces what the client already assumes.
const CLAIMS_WRITE = ['admin', 'reception', 'finance_manager', 'accountant'];
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');

// ── Helpers ──

async function generateClaimNumber() {
  const d = new Date();
  const prefix = `CLM-${d.getFullYear().toString().slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) as cnt FROM insurance_batch_claims WHERE claim_number LIKE ?`,
    { replacements: [`${prefix}-%`] }
  );
  return `${prefix}-${String((rows[0]?.cnt || 0) + 1).padStart(4, '0')}`;
}

// ══════════════════════════════════════════════════════════════
// GET /insurance-schemes — List insurance schemes
// ══════════════════════════════════════════════════════════════
router.get('/insurance-schemes', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const [rows] = await sequelize.query(`
      SELECT id, scheme_code, scheme_name, scheme_type, is_insurance,
        insurance_provider_name, insurance_provider_code,
        default_copay_percentage, contact_person, contact_email, contact_phone, currency
      FROM patient_schemes
      WHERE clinic_id = ? AND is_active = true AND is_insurance = true
      ORDER BY scheme_name
    `, { replacements: [cid] });
    res.json({ data: rows });
  } catch (err) {
    console.error('List insurance schemes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /unpaid-invoices — Fetch unpaid invoices (scheme_id optional)
// ══════════════════════════════════════════════════════════════
router.get('/unpaid-invoices', async (req, res) => {
  try {
    const { scheme_id, from, to } = req.query;
    const dateFrom = from || '2000-01-01';
    const dateTo   = to   || new Date().toISOString().split('T')[0];

    // Already-batched invoice IDs (exclude from results)
    const [batched] = await sequelize.query(`
      SELECT bci.invoice_id FROM insurance_batch_claim_items bci
      JOIN insurance_batch_claims bc ON bci.claim_id = bc.id
      WHERE bc.status NOT IN ('cancelled', 'rejected')
    `).catch(() => [[]]);
    const batchedIds = batched.map(r => r.invoice_id).filter(Boolean);
    const notInClause = batchedIds.length
      ? `AND i.id NOT IN (${batchedIds.map(() => '?').join(',')})`
      : '';

    // ── Part 1: from invoices table ──────────────────────────
    let invoiceWhere = `
      WHERE i.status IN ('unpaid', 'partial', 'overdue')
        AND i.balance_due > 0
        AND DATE(i.created_at) BETWEEN ? AND ?
        ${notInClause}
    `;
    let invoiceReps = [dateFrom, dateTo, ...batchedIds];

    if (scheme_id) {
      invoiceWhere += `
        AND (
          i.scheme_id = ?
          OR (i.scheme_id IS NULL AND i.patient_id IN (
            SELECT sm.patient_id FROM scheme_membership sm
            WHERE sm.scheme_id = ? AND sm.is_active = true
            UNION
            SELECT p.id FROM patients p WHERE p.default_scheme_id = ?
          ))
        )
      `;
      invoiceReps.push(scheme_id, scheme_id, scheme_id);
    }

    const [invoiceRows] = await sequelize.query(`
      SELECT i.id, i.invoice_number, i.patient_id, i.patient_name, i.bill_id,
        i.amount, i.amount_paid, i.balance_due, i.currency, i.status,
        i.due_date, i.created_at as invoice_date, i.scheme_id, i.scheme_name,
        COALESCE(((CURRENT_DATE)::date - (i.due_date)::date), 0) as days_overdue,
        'invoice' as source
      FROM invoices i
      ${invoiceWhere}
    `, { replacements: invoiceReps });

    // ── Part 2: patient_bills not yet linked to an invoice ───
    const invoicedBillIds = invoiceRows.map(r => r.bill_id).filter(Boolean);
    let billWhere = `
      WHERE pb.status IN ('active', 'partial', 'overdue')
        AND pb.balance_amount > 0
        AND DATE(pb.created_at) BETWEEN ? AND ?
        AND pb.invoice_id IS NULL
    `;
    let billReps = [dateFrom, dateTo];

    if (invoicedBillIds.length) {
      billWhere += ` AND pb.id NOT IN (${invoicedBillIds.map(() => '?').join(',')})`;
      billReps.push(...invoicedBillIds);
    }

    if (scheme_id) {
      billWhere += `
        AND (
          pb.scheme_id = ?
          OR pb.patient_id IN (
            SELECT sm.patient_id FROM scheme_membership sm
            WHERE sm.scheme_id = ? AND sm.is_active = true
            UNION
            SELECT p.id FROM patients p WHERE p.default_scheme_id = ?
          )
        )
      `;
      billReps.push(scheme_id, scheme_id, scheme_id);
    } else {
      // Without a scheme filter still only return bills that have scheme info
      billWhere += ` AND (pb.scheme_id IS NOT NULL OR pb.billing_type = 'credit')`;
    }

    const [billRows] = await sequelize.query(`
      SELECT pb.id, ('BILL-' || SUBSTRING(pb.id,1,8)) as invoice_number,
        pb.patient_id, pb.patient_name, pb.id as bill_id,
        pb.total_amount as amount, pb.paid_amount as amount_paid,
        pb.balance_amount as balance_due,
        COALESCE(pb.bill_currency, 'SSP') as currency,
        pb.status, pb.due_date,
        pb.created_at as invoice_date, pb.scheme_id, pb.scheme_name,
        COALESCE(((CURRENT_DATE)::date - (COALESCE(pb.due_date, pb.created_at))::date), 0) as days_overdue,
        'patient_bill' as source
      FROM patient_bills pb
      ${billWhere}
    `, { replacements: billReps }).catch(() => [[]]);

    const allInvoices = [...invoiceRows, ...billRows];
    allInvoices.sort((a, b) => new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime());

    res.json({ data: allInvoices });
  } catch (err) {
    console.error('Unpaid invoices error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST / — Create batch insurance claim
// ══════════════════════════════════════════════════════════════
router.post('/', authorize(CLAIMS_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { scheme_id, date_from, date_to, invoice_ids, claim_amount, notes, priority } = req.body;
    if (!scheme_id || !invoice_ids || !invoice_ids.length) {
      await t.rollback();
      return res.status(400).json({ error: 'scheme_id and invoice_ids required' });
    }

    // Get scheme
    const [schemes] = await sequelize.query(`SELECT * FROM patient_schemes WHERE id = ?`, { replacements: [scheme_id], transaction: t });
    if (!schemes.length) { await t.rollback(); return res.status(404).json({ error: 'Scheme not found' }); }
    const scheme = schemes[0];

    // A claim is one currency total — mixing e.g. a USD scheme invoice with an SSP one under
    // the same claim would silently sum incompatible amounts (exactly the "$2 shown as SSP 2"
    // bug this column exists to prevent). Every selected invoice (or patient_bill, for the
    // not-yet-invoiced items the picker also offers) must resolve to the same currency.
    const currencies = new Set();
    for (const invId of invoice_ids) {
      const [invRows] = await sequelize.query(`SELECT currency FROM invoices WHERE id = ?`, { replacements: [invId], transaction: t });
      if (invRows.length) { currencies.add(invRows[0].currency || 'SSP'); continue; }
      const [billRows] = await sequelize.query(`SELECT bill_currency FROM patient_bills WHERE id = ?`, { replacements: [invId], transaction: t });
      if (billRows.length) currencies.add(billRows[0].bill_currency || 'SSP');
    }
    if (currencies.size > 1) {
      await t.rollback();
      return res.status(400).json({ error: `Selected invoices are in different currencies (${Array.from(currencies).join(', ')}) — create separate claims per currency.` });
    }
    const claimCurrency = currencies.size === 1 ? Array.from(currencies)[0] : (scheme.currency || 'SSP');

    const claimId = uuidv4();
    const claimNumber = await generateClaimNumber();
    const branchId = getCreateBranchId(req);
    const totalAmount = parseFloat(claim_amount) || 0;

    // Create claim
    await sequelize.query(`
      INSERT INTO insurance_batch_claims
        (id, clinic_id, branch_id, claim_number, scheme_id, scheme_name, scheme_code,
         claim_amount, currency, invoice_count, status, priority, date_from, date_to, notes,
         contact_person, contact_email, contact_phone, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
    `, {
      replacements: [
        claimId, scheme.clinic_id || 1, branchId, claimNumber,
        scheme_id, scheme.scheme_name, scheme.scheme_code,
        totalAmount, claimCurrency, invoice_ids.length, 'pending', priority || 'normal',
        date_from || null, date_to || null, notes || null,
        scheme.contact_person || null, scheme.contact_email || null, scheme.contact_phone || null,
        req.user?.userId || null
      ],
      transaction: t
    });

    // Insert claim items (invoices)
    for (const invId of invoice_ids) {
      const [invs] = await sequelize.query(
        `SELECT id, invoice_number, patient_id, patient_name, bill_id, balance_due, created_at FROM invoices WHERE id = ?`,
        { replacements: [invId], transaction: t }
      );
      if (invs.length) {
        const inv = invs[0];
        await sequelize.query(`
          INSERT INTO insurance_batch_claim_items (id, claim_id, invoice_id, bill_id, patient_id, patient_name, invoice_number, invoice_date, amount, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,NOW())
        `, {
          replacements: [
            uuidv4(), claimId, inv.id, inv.bill_id || null,
            inv.patient_id, inv.patient_name, inv.invoice_number,
            inv.created_at ? new Date(inv.created_at).toISOString().split('T')[0] : null,
            parseFloat(inv.balance_due) || 0
          ],
          transaction: t
        });
      }
    }

    // Status history
    await sequelize.query(`
      INSERT INTO insurance_batch_claim_status_history (id, claim_id, old_status, new_status, notes, created_by, created_by_name, created_at)
      VALUES (?,?,NULL,'pending','Claim created',?,?,NOW())
    `, { replacements: [uuidv4(), claimId, req.user?.userId || null, req.user?.displayName || 'System'], transaction: t });

    await t.commit();
    res.status(201).json({ success: true, data: { id: claimId, claim_number: claimNumber, claim_amount: totalAmount, currency: claimCurrency, invoice_count: invoice_ids.length, status: 'pending' } });
  } catch (err) {
    await t.rollback();
    console.error('Create batch claim error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET / — List batch claims
// ══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { search, status, scheme_id, from, to } = req.query;
    let where = 'WHERE 1=1', reps = [];

    if (search) { where += ` AND (bc.claim_number LIKE ? OR bc.scheme_name LIKE ?)`; reps.push(`%${search}%`, `%${search}%`); }
    if (status && status !== 'all') { where += ` AND bc.status = ?`; reps.push(status); }
    if (scheme_id) { where += ` AND bc.scheme_id = ?`; reps.push(scheme_id); }
    if (from) { where += ` AND bc.created_at >= ?`; reps.push(from); }
    if (to) { where += ` AND bc.created_at <= ?`; reps.push(`${to} 23:59:59`); }

    const [claims] = await sequelize.query(`
      SELECT bc.*,
        ((CURRENT_DATE)::date - (bc.created_at)::date) as days_pending
      FROM insurance_batch_claims bc
      ${where}
      ORDER BY bc.created_at DESC
      LIMIT 500
    `, { replacements: reps });

    // Counts are currency-agnostic, but every amount here is not — claims can be batched in
    // different currencies (a scheme priced in USD vs. one in SSP), so summing them into one
    // number and slapping a single currency label on it is exactly the bug that put "SSP 2.00"
    // on a $2.00 claim. Amounts are grouped per currency instead; counts stay a flat total.
    const [counts] = await sequelize.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
      FROM insurance_batch_claims
    `);
    const [byCurrency] = await sequelize.query(`
      SELECT
        COALESCE(currency, 'SSP') as currency,
        COALESCE(SUM(claim_amount), 0) as total_amount,
        COALESCE(SUM(CASE WHEN status IN ('pending','submitted') THEN claim_amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN paid_amount ELSE 0 END), 0) as paid_amount,
        COALESCE(SUM(CASE WHEN status = 'submitted' THEN claim_amount ELSE 0 END), 0) as submitted_amount
      FROM insurance_batch_claims
      GROUP BY COALESCE(currency, 'SSP')
    `);

    res.json({ data: claims, stats: { ...(counts[0] || {}), by_currency: byCurrency } });
  } catch (err) {
    console.error('List batch claims error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /:id — Claim detail
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const [claims] = await sequelize.query(`
      SELECT bc.*, ((CURRENT_DATE)::date - (bc.created_at)::date) as days_pending,
        ps.currency as scheme_currency
      FROM insurance_batch_claims bc
      LEFT JOIN patient_schemes ps ON bc.scheme_id = ps.id
      WHERE bc.id = ?
    `, { replacements: [req.params.id] });

    if (!claims.length) return res.status(404).json({ error: 'Claim not found' });
    const claim = claims[0];

    // Get invoices in claim with bill services
    const [items] = await sequelize.query(`
      SELECT bci.*, i.status as invoice_status, i.balance_due as current_balance, i.due_date, i.currency as invoice_currency,
        pb.services as bill_services
      FROM insurance_batch_claim_items bci
      LEFT JOIN invoices i ON bci.invoice_id = i.id
      LEFT JOIN patient_bills pb ON i.bill_id = pb.id
      WHERE bci.claim_id = ?
      ORDER BY bci.created_at
    `, { replacements: [req.params.id] });

    // Invoices created without a bill (e.g. an insurance claim invoiced straight from
    // Dispensing/Bill Details, deliberately not linked to the patient's SSP bill) have no
    // pb.services to fall back on — their line items only ever exist in invoice_items.
    const invoiceIds = items.map(i => i.invoice_id).filter(Boolean);
    let invoiceItemsByInvoice = {};
    if (invoiceIds.length) {
      const [invoiceItems] = await sequelize.query(`
        SELECT invoice_id, description, quantity, unit_price, amount, currency
        FROM invoice_items WHERE invoice_id IN (${invoiceIds.map(() => '?').join(',')})
      `, { replacements: invoiceIds });
      invoiceItemsByInvoice = invoiceItems.reduce((acc, row) => {
        (acc[row.invoice_id] = acc[row.invoice_id] || []).push({
          serviceName: row.description, quantity: row.quantity,
          unitPrice: row.unit_price, totalPrice: row.amount, currency: row.currency,
        });
        return acc;
      }, {});
    }

    // Parse bill_services JSON for each invoice, falling back to invoice_items
    const invoicesWithServices = items.map(item => {
      let services = [];
      if (item.bill_services) {
        try {
          services = typeof item.bill_services === 'string' ? JSON.parse(item.bill_services) : item.bill_services;
        } catch (e) { services = []; }
      }
      if (services.length === 0) services = invoiceItemsByInvoice[item.invoice_id] || [];
      return { ...item, services, bill_services: undefined };
    });

    // Get status history
    const [history] = await sequelize.query(`
      SELECT * FROM insurance_batch_claim_status_history
      WHERE claim_id = ?
      ORDER BY created_at DESC
    `, { replacements: [req.params.id] });

    res.json({ data: { ...claim, invoices: invoicesWithServices, status_history: history } });
  } catch (err) {
    console.error('Get claim detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /:id/status — Update claim status
// ══════════════════════════════════════════════════════════════
router.put('/:id/status', authorize(CLAIMS_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { status, notes, paid_amount, rejected_reason } = req.body;
    const [claims] = await sequelize.query(`SELECT * FROM insurance_batch_claims WHERE id = ?`, { replacements: [req.params.id], transaction: t });
    if (!claims.length) { await t.rollback(); return res.status(404).json({ error: 'Claim not found' }); }
    const oldStatus = claims[0].status;

    // The insurer may pay less than the full claim_amount (partial acceptance,
    // line-item rejections, etc). Trust the actual paid_amount sent, not the
    // status label — a caller marking this 'paid' while only paying part of the
    // claim gets corrected to 'partially_paid' so the record (and everything
    // computed from it below) reflects what was actually received, not what was
    // claimed.
    const claimAmount = parseFloat(claims[0].claim_amount) || 0;
    let actualPaidAmount = 0;
    let effectiveStatus = status;
    if (status === 'paid' || status === 'partially_paid') {
      actualPaidAmount = paid_amount !== undefined && paid_amount !== null
        ? parseFloat(paid_amount)
        : (status === 'paid' ? claimAmount : 0);
      if (actualPaidAmount < claimAmount - 0.01) {
        effectiveStatus = 'partially_paid';
      }
    }

    let updateFields = 'status = ?, updated_at = NOW()';
    let updateReps = [effectiveStatus];

    if (status === 'submitted') { updateFields += ', submitted_at = NOW()'; }
    if (status === 'accepted') { updateFields += ', accepted_at = NOW()'; }
    if (status === 'paid' || status === 'partially_paid') {
      updateFields += ', paid_at = NOW(), paid_amount = COALESCE(paid_amount, 0) + ?';
      updateReps.push(actualPaidAmount);
    }
    if (status === 'rejected' && rejected_reason) { updateFields += ', rejected_reason = ?'; updateReps.push(rejected_reason); }

    updateReps.push(req.params.id);
    await sequelize.query(`UPDATE insurance_batch_claims SET ${updateFields} WHERE id = ?`, { replacements: updateReps, transaction: t });

    // Status history
    await sequelize.query(`
      INSERT INTO insurance_batch_claim_status_history (id, claim_id, old_status, new_status, notes, created_by, created_by_name, created_at)
      VALUES (?,?,?,?,?,?,?,NOW())
    `, { replacements: [uuidv4(), req.params.id, oldStatus, effectiveStatus, notes || null, req.user?.userId || null, req.user?.displayName || 'System'], transaction: t });

    // If the insurer actually paid something, update invoices AND the underlying
    // patient_bills, and — critically — post it to the ledger. This used to only
    // update `invoices`/`patient_bills` straight to fully-paid regardless of the
    // real amount received, and never posted anything to the GL at all: the
    // Insurance Receivable booked when the bill was created never cleared, and
    // there was no record of the cash/bank side of the payment either.
    if ((status === 'paid' || status === 'partially_paid') && actualPaidAmount > 0) {
      const [items] = await sequelize.query(`SELECT invoice_id, bill_id FROM insurance_batch_claim_items WHERE claim_id = ?`, { replacements: [req.params.id], transaction: t });

      // Distribute the actual amount received across the claim's linked invoices in
      // order, each capped at its own outstanding balance — a partial insurer
      // payment doesn't clear every linked invoice, and never fabricates payment
      // beyond what was actually received.
      let remaining = actualPaidAmount;
      for (const item of items) {
        if (remaining <= 0.01) break;
        const [invRows] = await sequelize.query(`SELECT amount, amount_paid, balance_due FROM invoices WHERE id = ?`, { replacements: [item.invoice_id], transaction: t });
        const inv = invRows[0];
        const invoiceBalance = parseFloat(inv?.balance_due || 0);
        if (invoiceBalance <= 0) continue;
        const applied = Math.min(remaining, invoiceBalance);
        remaining -= applied;

        const newInvPaid = parseFloat(inv.amount_paid || 0) + applied;
        const newInvBalance = Math.max(0, invoiceBalance - applied);
        await sequelize.query(
          `UPDATE invoices SET status = ?, amount_paid = ?, balance_due = ?, updated_at = NOW() WHERE id = ?`,
          { replacements: [newInvBalance <= 0.01 ? 'paid' : 'partial', newInvPaid, newInvBalance, item.invoice_id], transaction: t }
        );

        if (item.bill_id && applied > 0) {
          // Compute in JS, not a single multi-clause UPDATE — MySQL evaluates
          // SET clauses left-to-right, so a later clause referencing
          // `paid_amount` would see the value the first clause just wrote.
          const [billRows] = await sequelize.query(
            `SELECT total_amount, paid_amount FROM patient_bills WHERE id = ?`,
            { replacements: [item.bill_id], transaction: t }
          );
          const billRow = billRows[0];
          if (billRow) {
            const billTotal = parseFloat(billRow.total_amount);
            const billNewPaid = Math.min(billTotal, parseFloat(billRow.paid_amount) + applied);
            const billNewBalance = Math.max(0, billTotal - billNewPaid);
            const billNewStatus = billNewBalance <= 0.01 ? 'paid' : 'partial';
            await sequelize.query(
              `UPDATE patient_bills SET paid_amount = ?, balance_amount = ?, status = ? WHERE id = ?`,
              { replacements: [billNewPaid, billNewBalance, billNewStatus, item.bill_id], transaction: t }
            );
          }
        }
      }

      // Post the actual cash/bank receipt against the Insurance Receivable this
      // claim's bills were originally booked to (see AccountingService.createGLFromPatientBill).
      try {
        const AccountingService = require('../services/AccountingService');
        const clinicId = claims[0].clinic_id;
        const bankAccount = await AccountingService.getAccountByCode(clinicId, '1110')
          || await AccountingService.getAccountByCode(clinicId, '1100');
        const receivableAccount = await AccountingService.getReceivableAccount(clinicId, claims[0].scheme_id);

        if (bankAccount && receivableAccount) {
          const glEntry = await AccountingService.createGLEntry({
            clinic_id: clinicId,
            transaction_date: new Date(),
            transaction_type: 'insurance_claim_payment',
            description: `Insurance claim payment - ${claims[0].claim_number}`,
            reference_id: req.params.id,
            reference_module: 'insurance_claims',
            // The claim (and actualPaidAmount) is in whatever currency the scheme bills in —
            // "New Sudan" and others bill in USD — not necessarily the base currency (SSP).
            // Without this, createGLEntry defaults to base currency and posts the raw USD
            // number straight into the SSP ledger with no conversion at all (e.g. a real
            // $175 payment landing as "175.00 SSP" instead of ~1.3M SSP at the going rate).
            transaction_currency: claims[0].currency,
          }, [
            { account_id: bankAccount.id, debit_amount: actualPaidAmount, credit_amount: 0, description: `Insurer payment received - claim ${claims[0].claim_number}` },
            { account_id: receivableAccount.id, debit_amount: 0, credit_amount: actualPaidAmount, description: `Insurance receivable cleared - claim ${claims[0].claim_number}` }
          ], req.user?.userId || 'system');
          await AccountingService.postGLEntry(glEntry.id, req.user?.userId || 'system');
        } else {
          console.error(`Insurance claim ${claims[0].claim_number}: could not post GL entry — missing bank or receivable account for clinic ${clinicId}`);
        }
      } catch (glErr) {
        // Don't let a GL posting failure undo the claim/invoice status update that
        // already committed — but this must not vanish silently either, since it
        // means real money moved with nothing recorded in the ledger for it.
        console.error(`Insurance claim ${claims[0].claim_number}: GL posting failed after status update:`, glErr.message);
      }
    }

    await t.commit();
    const [updated] = await sequelize.query(`SELECT * FROM insurance_batch_claims WHERE id = ?`, { replacements: [req.params.id] });
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    await t.rollback();
    console.error('Update claim status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /:id — Edit claim (before submission)
// ══════════════════════════════════════════════════════════════
router.put('/:id', authorize(CLAIMS_WRITE), async (req, res) => {
  try {
    const [claims] = await sequelize.query(`SELECT * FROM insurance_batch_claims WHERE id = ?`, { replacements: [req.params.id] });
    if (!claims.length) return res.status(404).json({ error: 'Claim not found' });
    if (!['draft', 'pending', 'rejected'].includes(claims[0].status)) {
      return res.status(400).json({ error: 'Can only edit draft, pending, or rejected claims' });
    }

    const { notes, priority } = req.body;
    const fields = [], reps = [];
    if (notes !== undefined) { fields.push('notes = ?'); reps.push(notes); }
    if (priority) { fields.push('priority = ?'); reps.push(priority); }
    if (fields.length) {
      fields.push('updated_at = NOW()');
      reps.push(req.params.id);
      await sequelize.query(`UPDATE insurance_batch_claims SET ${fields.join(', ')} WHERE id = ?`, { replacements: reps });
    }
    const [updated] = await sequelize.query(`SELECT * FROM insurance_batch_claims WHERE id = ?`, { replacements: [req.params.id] });
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    console.error('Edit claim error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /:id/pdf — Generate claim PDF
// ══════════════════════════════════════════════════════════════
router.get('/:id/pdf', async (req, res) => {
  try {
    const tmpl = require('../services/documentTemplate');
    const [claims] = await sequelize.query(`
      SELECT bc.*, ps.currency as scheme_currency
      FROM insurance_batch_claims bc
      LEFT JOIN patient_schemes ps ON bc.scheme_id = ps.id
      WHERE bc.id = ?
    `, { replacements: [req.params.id] });
    if (!claims.length) return res.status(404).json({ error: 'Claim not found' });
    const claim = claims[0];

    const [items] = await sequelize.query(`
      SELECT bci.*, i.due_date, i.currency, pb.services as bill_services
      FROM insurance_batch_claim_items bci
      LEFT JOIN invoices i ON bci.invoice_id = i.id
      LEFT JOIN patient_bills pb ON i.bill_id = pb.id
      WHERE bci.claim_id = ?
      ORDER BY bci.invoice_number
    `, { replacements: [req.params.id] });

    // Invoices created without a linked bill (e.g. an insurance claim invoiced straight from
    // Dispensing/Bill Details) have no pb.services to read — their line items only exist in
    // invoice_items, same gap the on-screen claim detail view had.
    const invoiceIds = items.map(i => i.invoice_id).filter(Boolean);
    let invoiceItemsByInvoice = {};
    if (invoiceIds.length) {
      const [invoiceItems] = await sequelize.query(`
        SELECT invoice_id, description, quantity, amount
        FROM invoice_items WHERE invoice_id IN (${invoiceIds.map(() => '?').join(',')})
      `, { replacements: invoiceIds });
      invoiceItemsByInvoice = invoiceItems.reduce((acc, row) => {
        (acc[row.invoice_id] = acc[row.invoice_id] || []).push({ serviceName: row.description, quantity: row.quantity, totalPrice: row.amount });
        return acc;
      }, {});
    }

    const currency = claim.currency || claim.scheme_currency || items[0]?.currency || 'SSP';

    // Build table rows with sub-rows for services
    const tableRows = [];
    items.forEach((it, idx) => {
      tableRows.push({ bold: true, cells: [
        idx + 1,
        it.invoice_number || '-',
        it.patient_name || '-',
        it.invoice_date ? new Date(it.invoice_date).toLocaleDateString() : '-',
        tmpl.formatCurrency(it.amount, currency),
      ]});
      let services = [];
      if (it.bill_services) {
        try { services = typeof it.bill_services === 'string' ? JSON.parse(it.bill_services) : it.bill_services; } catch (e) {}
      }
      if (services.length === 0) services = invoiceItemsByInvoice[it.invoice_id] || [];
      services.forEach(s => {
        tableRows.push({ isSubRow: true, cells: [
          '',
          `\u21B3 ${s.service_name || s.serviceName || s.name || '-'}`,
          s.department || '-',
          s.quantity || 1,
          tmpl.formatCurrency(s.totalPrice || s.total_price || s.price || 0, currency),
        ]});
      });
    });

    const bodyHTML = [
      tmpl.buildInfoGrid(
        { title: 'Claim Details', rows: [
          { label: 'Claim Number', value: claim.claim_number, bold: true },
          { label: 'Date Range', value: `${claim.date_from ? new Date(claim.date_from).toLocaleDateString() : '-'} to ${claim.date_to ? new Date(claim.date_to).toLocaleDateString() : '-'}` },
          { label: 'Priority', value: (claim.priority || 'normal').toUpperCase() },
          { label: 'Invoices', value: claim.invoice_count },
          { label: 'Total Amount', value: tmpl.formatCurrency(claim.claim_amount, currency), bold: true },
        ]},
        { title: 'Insurance Provider', rows: [
          { label: 'Scheme', value: claim.scheme_name || '-', bold: true },
          { label: 'Scheme Code', value: claim.scheme_code || '-' },
          { label: 'Contact', value: claim.contact_person || '-' },
          { label: 'Email', value: claim.contact_email || '-' },
          { label: 'Phone', value: claim.contact_phone || '-' },
        ]}
      ),
      `<div class="ic-section-title">Itemized Invoices</div>`,
      tmpl.buildTable({
        columns: [
          { label: '#', align: 'center', width: '40px' },
          { label: 'Invoice #' },
          { label: 'Patient Name' },
          { label: 'Date', align: 'center' },
          { label: 'Amount', align: 'right' },
        ],
        rows: tableRows,
      }),
      tmpl.buildSummary([
        { label: 'Total Invoices', value: items.length },
        { label: `Total Claim`, value: tmpl.formatCurrency(claim.claim_amount, currency), isTotal: true },
      ]),
      tmpl.buildNotes(claim.notes),
    ].join('\n');

    const html = tmpl.buildDocument({
      title: `Insurance Claim - ${claim.claim_number}`,
      docType: 'Insurance Claim Document',
      docNumber: claim.claim_number,
      status: claim.status,
      date: claim.created_at,
      bodyHTML,
    });

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="${claim.claim_number}.html"`);
    res.send(html);
  } catch (err) {
    console.error('Claim PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// DELETE /:id — Cancel claim
// ══════════════════════════════════════════════════════════════
router.delete('/:id', authorize(CLAIMS_WRITE), async (req, res) => {
  try {
    const [claims] = await sequelize.query(`SELECT * FROM insurance_batch_claims WHERE id = ?`, { replacements: [req.params.id] });
    if (!claims.length) return res.status(404).json({ error: 'Claim not found' });
    if (['paid', 'accepted'].includes(claims[0].status)) {
      return res.status(400).json({ error: 'Cannot cancel paid or accepted claims' });
    }
    await sequelize.query(`UPDATE insurance_batch_claims SET status = 'cancelled', updated_at = NOW() WHERE id = ?`, { replacements: [req.params.id] });
    await sequelize.query(`
      INSERT INTO insurance_batch_claim_status_history (id, claim_id, old_status, new_status, notes, created_by, created_by_name, created_at)
      VALUES (?,?,?,'cancelled','Claim cancelled',?,?,NOW())
    `, { replacements: [uuidv4(), req.params.id, claims[0].status, req.user?.userId || null, req.user?.displayName || 'System'] });
    res.json({ success: true });
  } catch (err) {
    console.error('Cancel claim error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

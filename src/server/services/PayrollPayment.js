/**
 * Shared payroll-payment logic — one balanced GL entry per employee (debit
 * gross pay to Salaries & Wages/Doctor Fees, credit each deduction to its
 * mapped account, credit the payment account for net pay), used by both:
 *  - the authenticated per-employee/pay-all routes in hr.js, and
 *  - the public QR-code employee-signing flow (routes/publicPayroll.js),
 *    which resolves its own tenant connection from a URL-embedded client
 *    code (no JWT, no ambient tenant context) and so cannot rely on hr.js's
 *    module-level `sequelize` import — every function here takes its
 *    `sequelize` explicitly instead of closing over one.
 */
const AccountingService = require('./AccountingService');
const { v4: uuidv4 } = require('uuid');

async function resolvePayrollAccounts(clinicId) {
  const [salariesAccount, doctorFeesAccount, payrollLiabilitiesAccount] = await Promise.all([
    AccountingService.getAccountByCode(clinicId, '5100'),
    AccountingService.getAccountByCode(clinicId, '5110'),
    AccountingService.getAccountByCode(clinicId, '2200'),
  ]);
  return { salariesAccount, doctorFeesAccount, payrollLiabilitiesAccount };
}

// Pays exactly one employee's line: one balanced GL entry, then marks that
// line paid. Each employee gets their own GL entry — deliberately not
// combined into one run-wide entry — so paying can happen one person at a
// time (including via the public signing flow) and "who's been paid" is the
// line's own real status, not implied by the run's.
async function payOnePayrollLine(sequelize, clinicId, run, line, accounts, baseCurrency, paymentAccountId, userId) {
  const { salariesAccount, doctorFeesAccount, payrollLiabilitiesAccount } = accounts;
  const cur = line.currency || baseCurrency;
  // Never 1:1 — paying a USD salary as the same number of SSP (or the reverse)
  // misstates every account in the entry. Refuse with the exact rate to add.
  const rate = await AccountingService.requireExchangeRate(
    clinicId, cur, baseCurrency, run.run_date, `pay ${line.first_name} ${line.last_name} (${line.employee_number})`
  );
  const conv = (amt) => AccountingService.convertAmount(parseFloat(amt) || 0, rate);
  const baseGross = conv(line.gross_pay);
  const baseNet = conv(line.net_pay);
  const employeeLabel = `${line.first_name} ${line.last_name} (${line.employee_number})`;

  const lineItems = [];
  const expenseAccount = line.employment_type === 'consultant' ? doctorFeesAccount : salariesAccount;
  lineItems.push({ account_id: expenseAccount.id, debit_amount: baseGross, credit_amount: 0, description: `Payroll ${run.run_number} — ${employeeLabel} gross pay` });

  const [components] = await sequelize.query(
    `SELECT * FROM payroll_run_line_components WHERE payroll_run_line_id = :id AND component_type = 'deduction'`,
    { replacements: { id: line.id } }
  );
  for (const d of components) {
    const baseDeduction = conv(d.amount);
    if (baseDeduction <= 0) continue;
    let deductionAccount = payrollLiabilitiesAccount;
    if (d.account_code) {
      const mapped = await AccountingService.getAccountByCode(clinicId, d.account_code);
      if (mapped) deductionAccount = mapped;
    }
    lineItems.push({ account_id: deductionAccount.id, debit_amount: 0, credit_amount: baseDeduction, description: `Payroll ${run.run_number} — ${employeeLabel} ${d.name}` });
  }

  lineItems.push({ account_id: paymentAccountId, debit_amount: 0, credit_amount: baseNet, description: `Payroll ${run.run_number} — ${employeeLabel} net pay` });

  // general_ledger.created_by is NOT NULL, but payroll_run_lines.paid_by is
  // a nullable INTEGER — the two can't share one value when this was paid
  // via the public QR self-signing flow (no admin user id at all, userId is
  // null there deliberately, since nobody administratively executed this
  // payment). paid_by stays null in that case; the GL entry gets a
  // descriptive marker instead of failing its NOT NULL constraint.
  const glUserId = userId || 'employee-self-service';

  // Audit finding: this used to check line.status === 'paid' in the CALLER,
  // then post a GL entry here, then update the line's status — no row lock
  // and no transaction spanned the gap, so two near-simultaneous calls for
  // the same line (an admin clicking Pay while the employee submits their
  // own QR signing link, or a double-click/retry) could both pass the
  // status check before either write landed, producing two GL entries and
  // two postings for the same payroll line. FOR UPDATE here serializes a
  // concurrent call against the same line; the status re-check immediately
  // after is what actually rejects the loser once it's their turn. The GL
  // entry and the status flip now share one transaction, so a GL failure
  // still leaves the line un-paid exactly as before (nothing to roll back
  // forward) — postGLEntry runs AFTER commit, deliberately outside the
  // lock-holding transaction, matching postGLEntry's own documented reason
  // for never being called while a transaction holds a connection open.
  const transaction = await sequelize.transaction();
  let glEntry;
  try {
    const [[locked]] = await sequelize.query(
      `SELECT status FROM payroll_run_lines WHERE id = :id FOR UPDATE`,
      { replacements: { id: line.id }, transaction }
    );
    if (!locked || locked.status === 'paid') {
      throw Object.assign(new Error('This employee has already been paid'), { statusCode: 409 });
    }

    glEntry = await AccountingService.createGLEntry({
      clinic_id: clinicId,
      branch_id: run.branch_id,
      transaction_date: run.run_date,
      transaction_type: 'payroll_payment',
      description: `Payroll ${run.run_number} — ${employeeLabel}`,
      reference_id: line.id,
      reference_module: 'payroll_run_line',
    }, lineItems, glUserId, transaction);

    await sequelize.query(
      `UPDATE payroll_run_lines SET gl_entry_id = :glId, exchange_rate = :rate, base_currency_net = :baseNet, status = 'paid', paid_by = :userId, paid_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: line.id, glId: glEntry.id, rate, baseNet, userId: userId || null }, transaction }
    );

    // Salary-advance-sourced deductions (hr.js's payroll-run generation
    // tags these with source_type/source_id — see
    // ensureLeaveAdvanceWorkflowColumns.js) only actually reduce the
    // advance's balance now, at the moment the line is really paid — not
    // when the draft run was generated, same principle salaryAdvances.js's
    // own manual /repay already follows. No second GL entry: the line item
    // above already credited account 1250 for this exact amount as part of
    // the one balanced payroll entry.
    for (const d of components) {
      if (d.source_type !== 'salary_advance' || !d.source_id) continue;
      const [[advance]] = await sequelize.query(
        `SELECT balance_remaining, currency FROM salary_advances WHERE id = :id FOR UPDATE`,
        { replacements: { id: d.source_id }, transaction }
      );
      if (!advance) continue; // advance was deleted/not found — nothing to reconcile against

      const advanceCurrency = advance.currency || 'USD';
      let amountInAdvanceCurrency = parseFloat(d.amount) || 0;
      if (advanceCurrency !== cur) {
        const backRate = await AccountingService.requireExchangeRate(clinicId, cur, advanceCurrency, run.run_date, 'apply this salary-advance deduction');
        amountInAdvanceCurrency = AccountingService.convertAmount(amountInAdvanceCurrency, backRate);
      }

      const balance = parseFloat(advance.balance_remaining) || 0;
      // Staleness guard — deliberately does NOT silently clamp to whatever
      // balance is left (e.g. a manual repayment, or a different payroll
      // run, reduced it since this run was generated): paying a different
      // amount than what the payslip actually shows would be wrong, not
      // just imprecise. Fails the whole payment so HR can regenerate the
      // run with a correct, current deduction instead.
      if (amountInAdvanceCurrency > balance + 0.01) {
        throw Object.assign(
          new Error(`Salary advance ${d.source_id}'s balance changed since this payroll run was generated (was deducting ${amountInAdvanceCurrency.toFixed(2)}, only ${balance.toFixed(2)} remains) — regenerate the payroll run and try again.`),
          { statusCode: 409 },
        );
      }

      const newBalance = Math.round((balance - amountInAdvanceCurrency) * 100) / 100;
      const newStatus = newBalance <= 0.01 ? 'repaid' : 'repaying';
      await sequelize.query(
        `UPDATE salary_advances SET balance_remaining = :balance, status = :status, updated_at = NOW() WHERE id = :id`,
        { replacements: { id: d.source_id, balance: Math.max(newBalance, 0), status: newStatus }, transaction }
      );
      await sequelize.query(
        `INSERT INTO salary_advance_repayments (id, salary_advance_id, amount, payment_date, payment_account_id, gl_entry_id, recorded_by, notes)
         VALUES (:id, :advanceId, :amount, :paymentDate, :paymentAccountId, :glId, :recordedBy, :notes)`,
        {
          replacements: {
            id: uuidv4(), advanceId: d.source_id, amount: amountInAdvanceCurrency, paymentDate: run.run_date,
            paymentAccountId, glId: glEntry.id, recordedBy: userId || null,
            notes: `Automatic payroll deduction — ${run.run_number}`,
          },
          transaction,
        }
      );
    }

    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback().catch(() => {});
    throw error;
  }

  await AccountingService.postGLEntry(glEntry.id, glUserId);

  return glEntry;
}

// Shared by both ways an employee can complete their own payroll line
// without an HR user clicking "Pay": the public, unauthenticated QR kiosk
// page (routes/publicPayroll.js — re-verifies the employee number itself and
// always carries a drawn signature) and the authenticated employee-portal
// scan (routes/employeePortal.js — identity is already proven by the
// portal's own JWT, so it passes signatureData: null; a null signature on an
// otherwise-signed line is how that path is told apart from the kiosk one).
// Both callers must do their own pre-checks (expiry, lock-out, signature
// validation) BEFORE calling this — this function only does the part that's
// actually identical: pay the line and stamp the receipt.
async function completePayrollLineReceipt(sequelize, line, { signatureData = null, userId = null } = {}) {
  if (line.signed_at || line.status === 'paid') {
    throw Object.assign(new Error('This payment has already been signed for.'), { statusCode: 409 });
  }
  if (line.run_status !== 'approved') {
    throw Object.assign(new Error('This payroll run is no longer open for payment. Please contact HR.'), { statusCode: 409 });
  }
  if (!line.run_payment_account_id) {
    throw Object.assign(new Error('No payment account is set for this payroll run. Please contact HR.'), { statusCode: 400 });
  }

  const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
  const baseCurrency = baseCurrencyRow?.code || 'USD';
  const accounts = await resolvePayrollAccounts(line.clinic_id);
  if (!accounts.salariesAccount || !accounts.doctorFeesAccount || !accounts.payrollLiabilitiesAccount) {
    throw Object.assign(new Error('Payroll accounts are not set up. Please contact HR.'), { statusCode: 500 });
  }

  const run = { run_number: line.run_number, run_date: line.run_date };
  const glEntry = await payOnePayrollLine(sequelize, line.clinic_id, run, line, accounts, baseCurrency, line.run_payment_account_id, userId);
  await finalizeRunIfFullyPaid(sequelize, line.payroll_run_id, userId);

  await sequelize.query(
    `UPDATE payroll_run_lines SET signature_data = :signature, signed_at = NOW(), updated_at = NOW() WHERE id = :id`,
    { replacements: { id: line.id, signature: signatureData || null } }
  );

  return glEntry;
}

// Once every line in a run is individually paid, the run itself is "paid" —
// this just reflects that, it never pays anything by itself.
async function finalizeRunIfFullyPaid(sequelize, runId, userId) {
  const [[counts]] = await sequelize.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'paid') AS paid FROM payroll_run_lines WHERE payroll_run_id = :runId`,
    { replacements: { runId } }
  );
  const total = parseInt(counts.total, 10) || 0;
  const paid = parseInt(counts.paid, 10) || 0;
  if (total > 0 && total === paid) {
    await sequelize.query(
      `UPDATE payroll_runs SET status = 'paid', paid_by = :userId, paid_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: runId, userId: userId || null } }
    );
    return true;
  }
  return false;
}

// NOT CALLED FROM ANYWHERE YET. Undoes exactly the salary-advance side
// effect payOnePayrollLine's deduction loop above applies — restores
// balance_remaining/status on the advance and marks the repayment row
// reversed (never deletes it, so the original payment stays in the
// employee's history) — written now so it's ready the moment this
// codebase gets a real "reverse/void a paid payroll line" feature. There
// is no such feature today: no un-approve, no un-pay, no GL reversal
// anywhere in the payroll module. Whatever builds that should also post a
// reversing GL entry crediting/debiting the same accounts in the opposite
// direction — deliberately not this function's job, since it only touches
// the salary_advances side of the picture.
async function restoreSalaryAdvanceDeduction(sequelize, repaymentId, transaction) {
  const [[repayment]] = await sequelize.query(
    `SELECT * FROM salary_advance_repayments WHERE id = :id AND reversed_at IS NULL`,
    { replacements: { id: repaymentId }, transaction }
  );
  if (!repayment) return null;

  const [[advance]] = await sequelize.query(
    `SELECT balance_remaining, amount FROM salary_advances WHERE id = :id FOR UPDATE`,
    { replacements: { id: repayment.salary_advance_id }, transaction }
  );
  if (!advance) return null;

  const restoredBalance = Math.min(parseFloat(advance.balance_remaining) + parseFloat(repayment.amount), parseFloat(advance.amount));
  const newStatus = restoredBalance >= parseFloat(advance.amount) - 0.01 ? 'disbursed' : 'repaying';
  await sequelize.query(
    `UPDATE salary_advances SET balance_remaining = :balance, status = :status, updated_at = NOW() WHERE id = :id`,
    { replacements: { id: repayment.salary_advance_id, balance: restoredBalance, status: newStatus }, transaction }
  );
  await sequelize.query(
    `UPDATE salary_advance_repayments SET reversed_at = NOW() WHERE id = :id`,
    { replacements: { id: repaymentId }, transaction }
  );
  return { advanceId: repayment.salary_advance_id, restoredAmount: parseFloat(repayment.amount) };
}

module.exports = { resolvePayrollAccounts, payOnePayrollLine, finalizeRunIfFullyPaid, restoreSalaryAdvanceDeduction, completePayrollLineReceipt };

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
  let rate = 1;
  if (cur !== baseCurrency) {
    try { rate = await AccountingService.getExchangeRate(clinicId, cur, baseCurrency, run.run_date) || 1; }
    catch (e) { rate = 1; }
  }
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
  const glEntry = await AccountingService.createGLEntry({
    clinic_id: clinicId,
    transaction_date: run.run_date,
    transaction_type: 'payroll_payment',
    description: `Payroll ${run.run_number} — ${employeeLabel}`,
    reference_id: line.id,
    reference_module: 'payroll_run_line',
  }, lineItems, glUserId);
  await AccountingService.postGLEntry(glEntry.id, glUserId);

  await sequelize.query(
    `UPDATE payroll_run_lines SET gl_entry_id = :glId, exchange_rate = :rate, base_currency_net = :baseNet, status = 'paid', paid_by = :userId, paid_at = NOW(), updated_at = NOW() WHERE id = :id`,
    { replacements: { id: line.id, glId: glEntry.id, rate, baseNet, userId: userId || null } }
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

module.exports = { resolvePayrollAccounts, payOnePayrollLine, finalizeRunIfFullyPaid };

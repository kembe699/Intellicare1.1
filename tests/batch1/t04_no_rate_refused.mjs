// #4 Payroll (and other money paths) refuse to use a silent 1:1 rate when no exchange rate exists.
import { BEFORE, AFTER, call, q, done, check, summary } from './lib.mjs';

const [emp] = await q("SELECT id FROM employees WHERE first_name = 'Test' AND last_name = 'Employee'");
const [cash] = await q("SELECT id FROM chart_of_accounts WHERE account_code = '1105'");
const [supplier] = await q("SELECT id FROM suppliers WHERE name = 'Juba Medical Supplies Ltd' LIMIT 1");

async function freePeriod() {
  for (;;) {
    const y = 2040 + Math.floor(Math.random() * 50), m = 1 + Math.floor(Math.random() * 12);
    const [r] = await q("SELECT 1 FROM payroll_runs WHERE period_year = $1 AND period_month = $2 AND status != 'cancelled'", [y, m]);
    if (!r) return { y, m };
  }
}

async function payrollScenario(base) {
  const { y, m } = await freePeriod();
  const run = await call(base, 'POST', '/hr/payroll/runs', { period_month: m, period_year: y, employee_ids: [emp.id], payment_account_id: cash.id });
  if (!run.ok) return { createStatus: run.status, createError: run.body.error };
  await call(base, 'POST', `/hr/payroll/runs/${run.body.id}/approve`, {});
  const [ln] = await q('SELECT id FROM payroll_run_lines WHERE payroll_run_id = $1', [run.body.id]);
  const payRes = await call(base, 'POST', `/hr/payroll/runs/${run.body.id}/lines/${ln.id}/pay`, { payment_account_id: cash.id });
  const [line] = await q('SELECT status, base_currency_net::float AS base_net, net_pay::float AS net FROM payroll_run_lines WHERE id = $1', [ln.id]);
  return { createStatus: run.status, payStatus: payRes.status, payError: payRes.body.error, line };
}

const setRateActive = (on) => q("UPDATE exchange_rates SET is_active = $1 WHERE from_currency = 'USD' AND to_currency = 'SSP'", [on]);

try {
  await setRateActive(false);

  const before = await payrollScenario(BEFORE);
  console.log('BEFORE', JSON.stringify(before));
  check('before: USD salary paid with no USD→SSP rate, booked 1:1 (USD 1,000 → SSP 1,000)',
    before.payStatus === 200 && before.line.status === 'paid' && before.line.base_net === before.line.net, JSON.stringify(before.line));

  const after = await payrollScenario(AFTER);
  console.log('AFTER ', JSON.stringify(after));
  check('after: payment refused with 400', after.payStatus === 400, `status ${after.payStatus}`);
  check('after: message names the rate and date to add', /no USD→SSP exchange rate for \d{4}-\d{2}-\d{2}.*Add the USD→SSP rate for \d{4}-\d{2}-\d{2} in Accounting › Exchange Rates/.test(after.payError || ''), after.payError);
  check('after: line stays unpaid', after.line.status !== 'paid');

  const qb = await call(AFTER, 'POST', '/procurement/purchase-orders/quick-bill', { supplier_id: supplier.id, amount: 50, description: 'T04 USD bill', currency: 'USD' });
  check('after: USD quick supplier bill refused without a rate', qb.status === 400 && /no USD→SSP exchange rate/.test(qb.body.error || ''), qb.body.error);
} finally {
  await setRateActive(true);
}

const ok = await payrollScenario(AFTER);
check('after: with the rate restored, the same payment succeeds at 2,800', ok.payStatus === 200 && ok.line.base_net === ok.line.net * 2800, JSON.stringify(ok.line));

await done();
process.exit(summary() ? 1 : 0);

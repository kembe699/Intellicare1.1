/**
 * GET /api/accounting/reports/balance-sheet — proves a contra account (an
 * account whose balance_type is the OPPOSITE of its section's natural
 * direction, e.g. 1590 Accumulated Depreciation: an asset but
 * balance_type='credit'; 3300 Owner's Drawings: equity but
 * balance_type='debit') nets correctly into its section instead of being
 * added as if it were a normal-direction account.
 *
 * The real bug this covers: the route used to compute each row's
 * period_balance as a positive number in THAT ROW'S OWN balance_type
 * direction, then summed those straight into the section total. For a
 * contra account that ADDS the contra balance instead of subtracting it,
 * overstating the section by 2x the contra account's balance and making
 * is_balanced go false. Fixed to compute period_balance (and normalize
 * opening_balance) in the SECTION's own natural direction instead.
 *
 * Calls the real route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const SUFFIX = `BSCONTRA${Date.now()}`;

let sequelize;
let testConn;
let router;
let acctIds; // account_code -> id
let wasActive; // account_code -> original is_active
let baseline; // balance-sheet response captured before fixtures are posted

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(query) {
  return { query, user: { id: 1, role: 'admin', clinicId: 1 }, branchContext: { isAdmin: true } };
}

async function run(path, query) {
  const handler = handlerFor(path, 'get');
  const res = mockRes();
  await withTenant(() => handler(req(query), res));
  return res;
}

async function postPair(ref, date, debitAcct, creditAcct, amount, desc) {
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date, debit_amount, credit_amount, reference_number, description, is_posted, source_module)
     VALUES (:id, 1, :acct, :date, :amount, 0, :ref, :desc, true, 'test')`,
    { replacements: { id: uuid(), acct: debitAcct, date, amount, ref, desc } }
  );
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date, debit_amount, credit_amount, reference_number, description, is_posted, source_module)
     VALUES (:id, 1, :acct, :date, 0, :amount, :ref, :desc, true, 'test')`,
    { replacements: { id: uuid(), acct: creditAcct, date, amount, ref, desc } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  router = require('../../src/server/routes/accounting');

  const [accts] = await sequelize.query(`SELECT id, account_code, is_active FROM chart_of_accounts WHERE clinic_id = 1 AND account_code IN ('1100','1590','3100','3300','4100','5100')`);
  acctIds = {};
  wasActive = {};
  for (const a of accts) { acctIds[a.account_code] = a.id; wasActive[a.account_code] = a.is_active; }

  // 1590/3100/3300 are commonly left deactivated in tenant_test (the
  // recurring "lean chart of accounts" gotcha) — reactivate for the test,
  // restored exactly in afterAll.
  await sequelize.query(`UPDATE chart_of_accounts SET is_active = true WHERE clinic_id = 1 AND account_code IN ('1590', '3100', '3300')`);

  // tenant_test is a shared schema — 1590/3300 may already carry balance
  // from other tests' history, so the per-account assertions below compare
  // against this pre-fixture baseline (a delta) rather than an absolute
  // value.
  const baselineRes = await run('/reports/balance-sheet', { clinic_id: '1', as_of_date: '2026-04-30' });
  baseline = baselineRes.body;

  // A fully-balanced fixture: Dr Cash 5000 / Cr Capital 5000 (funding);
  // Dr Depreciation Expense 150 / Cr Accumulated Depreciation 150 (a
  // contra-asset gaining a credit balance); Dr Owner's Drawings 300 /
  // Cr Cash 300 (a contra-equity gaining a debit balance).
  await postPair(`${SUFFIX}-CAP`, '2026-04-01', acctIds['1100'], acctIds['3100'], 5000, `${SUFFIX} capital injection`);
  await postPair(`${SUFFIX}-DEPR`, '2026-04-02', acctIds['5100'], acctIds['1590'], 150, `${SUFFIX} depreciation`);
  await postPair(`${SUFFIX}-DRAW`, '2026-04-03', acctIds['3300'], acctIds['1100'], 300, `${SUFFIX} owner drawing`);
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM account_ledger WHERE reference_number LIKE :pfx`, { replacements: { pfx: `${SUFFIX}%` } });
    for (const code of ['1590', '3100', '3300']) {
      await sequelize.query(`UPDATE chart_of_accounts SET is_active = :active WHERE clinic_id = 1 AND account_code = :code`, { replacements: { active: wasActive[code], code } });
    }
  } catch (e) { console.warn('balanceSheetContraAccounts cleanup failed (non-fatal):', e.message); }
});

describe('Balance Sheet nets contra accounts correctly into their section', () => {
  test('Accumulated Depreciation (contra-asset, balance_type=credit) reduces total assets instead of inflating it', async () => {
    const res = await run('/reports/balance-sheet', { clinic_id: '1', as_of_date: '2026-04-30' });
    const before = baseline.assets.items.find((i) => i.account_code === '1590');
    const after = res.body.assets.items.find((i) => i.account_code === '1590');
    expect(after).toBeTruthy();
    // A credit-normal asset that just gained a 150 credit should see its
    // balance move by -150 within the (debit-normal) assets section — not +150.
    expect(after.balance - (before ? before.balance : 0)).toBe(-150);
  });

  test("Owner's Drawings (contra-equity, balance_type=debit) reduces total equity instead of inflating it", async () => {
    const res = await run('/reports/balance-sheet', { clinic_id: '1', as_of_date: '2026-04-30' });
    const before = baseline.equity.items.find((i) => i.account_code === '3300');
    const after = res.body.equity.items.find((i) => i.account_code === '3300');
    expect(after).toBeTruthy();
    expect(after.balance - (before ? before.balance : 0)).toBe(-300);
  });

  test('the balance sheet actually balances: Assets === Liabilities + Equity', async () => {
    const res = await run('/reports/balance-sheet', { clinic_id: '1', as_of_date: '2026-04-30' });
    expect(Math.abs(res.body.assets.total - res.body.total_liabilities_and_equity)).toBeLessThan(0.01);
    expect(res.body.is_balanced).toBe(true);
  });
});

/**
 * Income Statement redesign: (1) expense accounts now come back grouped into
 * real sections — Cost of Goods Sold (sub_account_type = 'cost_of_sales'),
 * Miscellaneous (account 5900, called out on its own), and Operating
 * Expenses (everything else) — instead of one flat list where a large
 * Miscellaneous balance has nothing next to it explaining what it isn't; and
 * (2) a `?daily=true` mode returns a day-by-day trend line, reusing the same
 * per-account query one day at a time rather than re-deriving the cash-basis
 * waterfall allocation to be date-bucket-aware.
 *
 * Uses accrual basis (?basis=accrual, the default for this test) since it
 * reads straight off account_ledger with no receipts/bill waterfall
 * machinery to seed — that allocation logic already has its own coverage
 * elsewhere; this file is about the NEW grouping/daily behavior.
 *
 * Calls the REAL route handler directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const TEST_CLINIC_ID = 1;

let sequelize;
let testConn;
let getHandler;
let revenueAccountId;
let cogsAccountId;
let opexAccountId;
let miscAccountId;
let ledgerIds = [];

function withTenant(fn) {
  return tenantContext.run(testConn, fn);
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function handlerFor(router, routePath, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function req(query) {
  return {
    params: {}, body: {}, query,
    user: { id: 1, displayName: 'Income Statement Tester', role: 'admin', clinicId: TEST_CLINIC_ID },
    branchContext: { isAdmin: true },
    models: testConn,
  };
}

// Mirrors supplierBillPaymentPreGrnCategorization.test.js's own helper —
// chart_of_accounts isn't tenant-bootstrapped, so tenant_test starts with
// none, and a prior test file can leave a shared clinic_id=1 row deactivated.
async function ensureAccount(code, name, type, balanceType, subAccountType) {
  const [[existing]] = await sequelize.query(
    `SELECT id FROM chart_of_accounts WHERE clinic_id = :clinicId AND account_code = :code`,
    { replacements: { clinicId: TEST_CLINIC_ID, code } }
  );
  if (existing) {
    await sequelize.query(
      `UPDATE chart_of_accounts SET is_active = true, sub_account_type = :subAccountType WHERE id = :id`,
      { replacements: { id: existing.id, subAccountType: subAccountType || null } }
    );
    return existing.id;
  }
  const id = uuid();
  await sequelize.query(
    `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, sub_account_type, is_active)
     VALUES (:id, :clinicId, :code, :name, :type, :balanceType, :subAccountType, true)`,
    { replacements: { id, clinicId: TEST_CLINIC_ID, code, name, type, balanceType, subAccountType: subAccountType || null } }
  );
  return id;
}

async function postLedgerLine(accountId, date, { debit = 0, credit = 0 }) {
  const id = uuid();
  ledgerIds.push(id);
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date, debit_amount, credit_amount, is_posted, source_module)
     VALUES (:id, :clinicId, :accountId, :date, :debit, :credit, true, 'test')`,
    { replacements: { id, clinicId: TEST_CLINIC_ID, accountId, date, debit, credit } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;

  const router = require('../../src/server/routes/reportIncomeStatement');
  getHandler = handlerFor(router, '/', 'get');

  revenueAccountId = await ensureAccount('4199', 'Test Other Revenue', 'revenue', 'credit', 'operating_revenue');
  cogsAccountId = await ensureAccount('5210', 'Pharmaceutical Cost of Sales', 'expense', 'debit', 'cost_of_sales');
  opexAccountId = await ensureAccount('5199', 'Test Operating Expense', 'expense', 'debit', 'operating_expense');
  miscAccountId = await ensureAccount('5900', 'Miscellaneous Expenses', 'expense', 'debit', 'operating_expense');

  // Day 1: revenue 10,000; COGS 2,000; opex 1,000; misc 500.
  await postLedgerLine(revenueAccountId, '2031-01-15', { credit: 10000 });
  await postLedgerLine(cogsAccountId, '2031-01-15', { debit: 2000 });
  await postLedgerLine(opexAccountId, '2031-01-15', { debit: 1000 });
  await postLedgerLine(miscAccountId, '2031-01-15', { debit: 500 });

  // Day 2: revenue 5,000; COGS 1,000; no opex/misc that day.
  await postLedgerLine(revenueAccountId, '2031-01-16', { credit: 5000 });
  await postLedgerLine(cogsAccountId, '2031-01-16', { debit: 1000 });
}, 30000);

afterAll(async () => {
  try {
    if (ledgerIds.length > 0) {
      await sequelize.query(`DELETE FROM account_ledger WHERE id IN (:ids)`, { replacements: { ids: ledgerIds } });
    }
  } catch (e) { console.warn('incomeStatementDailyAndSections cleanup failed (non-fatal):', e.message); }
});

describe('GET /api/reports-v2/income-statement — expense sections', () => {
  test('groups expenses into Cost of Goods Sold, Operating Expenses, and Miscellaneous', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: '2031-01-15', dateTo: '2031-01-16', basis: 'accrual' }), res));
    expect(res.statusCode).toBe(200);

    const { expenseSections } = res.body;
    expect(expenseSections.costOfGoodsSold.total).toBe(3000);
    expect(expenseSections.costOfGoodsSold.lines.some((l) => l.account_id === cogsAccountId)).toBe(true);
    expect(expenseSections.operatingExpenses.total).toBe(1000);
    expect(expenseSections.operatingExpenses.lines.some((l) => l.account_id === opexAccountId)).toBe(true);
    expect(expenseSections.miscellaneous.total).toBe(500);
    expect(expenseSections.miscellaneous.lines.some((l) => l.account_id === miscAccountId)).toBe(true);
    // Miscellaneous's own sub_account_type is 'operating_expense' (matches the
    // real chart of accounts seed) — it's account_code === '5900' that routes
    // it to its own section, not the sub-type, which the lines above prove.
  });

  test('revenue and expense totals still match the plain (ungrouped) totals', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: '2031-01-15', dateTo: '2031-01-16', basis: 'accrual' }), res));
    expect(res.body.totals.totalRevenue).toBe(15000);
    expect(res.body.totals.totalExpenses).toBe(4500);
    expect(res.body.totals.netIncome).toBe(10500);
  });
});

describe('GET /api/reports-v2/income-statement?daily=true', () => {
  test('returns one row per day, summing to the same totals as the whole-range report', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: '2031-01-15', dateTo: '2031-01-16', basis: 'accrual', daily: 'true' }), res));
    expect(res.statusCode).toBe(200);
    expect(res.body.dailyBreakdown).toHaveLength(2);

    const day1 = res.body.dailyBreakdown.find((d) => d.date === '2031-01-15');
    const day2 = res.body.dailyBreakdown.find((d) => d.date === '2031-01-16');
    expect(day1.totalRevenue).toBe(10000);
    expect(day1.totalCostOfGoodsSold).toBe(2000);
    expect(day1.totalOperatingExpenses).toBe(1000);
    expect(day1.totalMiscellaneous).toBe(500);
    expect(day1.netIncome).toBe(10000 - 3500);

    expect(day2.totalRevenue).toBe(5000);
    expect(day2.totalCostOfGoodsSold).toBe(1000);
    expect(day2.totalOperatingExpenses).toBe(0);
    expect(day2.totalMiscellaneous).toBe(0);

    const dailyRevenueSum = res.body.dailyBreakdown.reduce((s, d) => s + d.totalRevenue, 0);
    const dailyExpenseSum = res.body.dailyBreakdown.reduce((s, d) => s + d.totalExpenses, 0);
    expect(dailyRevenueSum).toBe(res.body.totals.totalRevenue);
    expect(dailyExpenseSum).toBe(res.body.totals.totalExpenses);
  });

  test('omits dailyBreakdown entirely when ?daily is not set, to keep the normal request cheap', async () => {
    const res = mockRes();
    await withTenant(() => getHandler(req({ dateFrom: '2031-01-15', dateTo: '2031-01-16', basis: 'accrual' }), res));
    expect(res.body.dailyBreakdown).toBeNull();
  });
});

/**
 * Accounting Reports' new endpoints (Cash Flow, General Ledger, Account/
 * Sub-Account History, Journal Vouchers, Expenses, Statement of Changes in
 * Equity) — proves each pulls from account_ledger (the single shared sink
 * both GL posting pipelines write to) correctly, against real seeded data
 * with known expected values.
 *
 * Covers a real bug caught during manual verification: the equity
 * statement's "period activity" was hardcoded as credit-debit for every
 * equity account, which is correct for Capital/Retained Earnings but
 * silently inverts Owner's Drawings — the one equity account that's
 * debit-normal (a contra-equity account). Fixed to use each account's own
 * balance_type, same convention AccountingService.getTrialBalance already
 * uses.
 *
 * Calls the REAL route handlers directly (see receiptStatusTerminal.test.js
 * for why — no HTTP test harness in this app), against tenant_test.
 */
const { uuid } = require('../setup/testDb');
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';
const SUFFIX = `ACCTREG${Date.now()}`;
// A separate, non-nested prefix for the opening-balance fan-out fixture
// below — it must NOT start with SUFFIX, since several other tests filter
// "my rows" by referenceNumber.startsWith(SUFFIX) and expect an exact count.
const BANK_SUFFIX = `ACCTBANK${Date.now()}`;

let sequelize;
let testConn;
let router;
let branchId;
let acctIds; // account_code -> id
let wasActive; // account_code -> original is_active, so we restore it exactly
let cashFlowOpeningBaseline; // cash-flow openingBalance, captured before any fixture rows are posted
let tempBankAcctId; // a dedicated temp account with a non-zero opening_balance — see below
let tempOffsetAcctId; // balances the temp bank account's postings without touching 3100 (which other tests assert exact values on)

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

async function postPair(ref, date, debitAcct, creditAcct, amount, sourceModule, desc) {
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date, debit_amount, credit_amount, reference_number, description, is_posted, source_module, branch_id)
     VALUES (:id, 1, :acct, :date, :amount, 0, :ref, :desc, true, :src, :branchId)`,
    { replacements: { id: uuid(), acct: debitAcct, date, amount, ref, desc, src: sourceModule, branchId } }
  );
  await sequelize.query(
    `INSERT INTO account_ledger (id, clinic_id, account_id, transaction_date, debit_amount, credit_amount, reference_number, description, is_posted, source_module, branch_id)
     VALUES (:id, 1, :acct, :date, 0, :amount, :ref, :desc, true, :src, :branchId)`,
    { replacements: { id: uuid(), acct: creditAcct, date, amount, ref, desc, src: sourceModule, branchId } }
  );
}

beforeAll(async () => {
  testConn = await getTenantConnection(TEST_SCHEMA);
  sequelize = testConn.sequelize;
  sequelize.options.logging = false;
  router = require('../../src/server/routes/reportAccounting');

  const [[branch]] = await sequelize.query(`INSERT INTO branches (facility_id, name, is_active) VALUES (1, :name, true) RETURNING id`, { replacements: { name: `${SUFFIX} Branch` } });
  branchId = branch.id;

  const [accts] = await sequelize.query(`SELECT id, account_code, is_active FROM chart_of_accounts WHERE clinic_id = 1 AND account_code IN ('1100','4100','5210','3100','3300')`);
  acctIds = {};
  wasActive = {};
  for (const a of accts) { acctIds[a.account_code] = a.id; wasActive[a.account_code] = a.is_active; }

  // 3100 (Capital) / 3300 (Drawings) are commonly left deactivated in this
  // tenant_test schema (the recurring "lean chart of accounts" gotcha) —
  // reactivate for the test, restored in afterAll.
  await sequelize.query(`UPDATE chart_of_accounts SET is_active = true WHERE clinic_id = 1 AND account_code IN ('3100', '3300')`);

  // Captured before any fixture rows exist, so the opening-balance fan-out
  // regression test below can assert an exact delta instead of an absolute
  // value — tenant_test is a shared schema and already carries history from
  // other tests.
  const cashFlowBaselineRes = await run('/cash-flow', { dateFrom: '2026-01-01', dateTo: '2026-12-31', clinic_id: '1', allBranches: 'true', detail: 'false' });
  cashFlowOpeningBaseline = cashFlowBaselineRes.body.openingBalance;

  // A dedicated temp bank account with a NON-zero opening_balance (1100
  // Cash's is 0.00 in tenant_test, which would mask the fan-out bug below:
  // 0 multiplied by any number of joined ledger rows is still 0).
  tempBankAcctId = uuid();
  await sequelize.query(
    `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, is_bank_account, is_active, opening_balance)
     VALUES (:id, 1, :code, :name, 'asset', 'debit', true, true, 1234.56)`,
    { replacements: { id: tempBankAcctId, code: `${BANK_SUFFIX}-ACCT`, name: `${BANK_SUFFIX} Test Bank` } }
  );
  // A separate temp offset account for the bank postings below — using an
  // existing account like 3100 would also move ITS opening balance and
  // break the equity-statement test's exact-value assertion on it.
  tempOffsetAcctId = uuid();
  await sequelize.query(
    `INSERT INTO chart_of_accounts (id, clinic_id, account_code, account_name, account_type, balance_type, is_active, opening_balance)
     VALUES (:id, 1, :code, :name, 'equity', 'credit', true, 0)`,
    { replacements: { id: tempOffsetAcctId, code: `${BANK_SUFFIX}-OFFSET`, name: `${BANK_SUFFIX} Test Offset` } }
  );

  // Prior entry, before the test's date range — proves opening-balance math.
  await postPair(`${SUFFIX}-PRIOR`, '2024-01-01', acctIds['1100'], acctIds['3100'], 5000, 'opening_capital', `${SUFFIX} prior capital injection`);

  // Two more ledger rows on the temp bank account — one before dateFrom (100,
  // should move openingBalance), one within the period (50, must NOT move
  // openingBalance). Two rows on the same is_bank_account account is exactly
  // the shape that triggered the old fan-out bug (SUM(coa.opening_balance)
  // joined against account_ledger with no GROUP BY counted 1234.56 once per
  // matched row instead of once total).
  await postPair(`${BANK_SUFFIX}-PRIOR`, '2024-01-02', tempBankAcctId, tempOffsetAcctId, 100, 'test_fixture_bank', `${BANK_SUFFIX} temp bank prior`);
  await postPair(`${BANK_SUFFIX}-PERIOD`, '2026-03-04', tempBankAcctId, tempOffsetAcctId, 50, 'test_fixture_bank', `${BANK_SUFFIX} temp bank period`);

  // Period entries.
  await postPair(`${SUFFIX}-REV`, '2026-03-01', acctIds['1100'], acctIds['4100'], 2000, 'patient_billing', `${SUFFIX} revenue receipt`);
  await postPair(`${SUFFIX}-COGS`, '2026-03-02', acctIds['5210'], acctIds['1100'], 800, 'pharmacy_dispensing', `${SUFFIX} pharmacy cogs payment`);
  await postPair(`${SUFFIX}-DRAW`, '2026-03-03', acctIds['3300'], acctIds['1100'], 300, 'owner_drawing', `${SUFFIX} owner drawing`);
}, 30000);

afterAll(async () => {
  try {
    await sequelize.query(`DELETE FROM account_ledger WHERE reference_number LIKE :pfx OR reference_number LIKE :pfx2`, { replacements: { pfx: `${SUFFIX}%`, pfx2: `${BANK_SUFFIX}%` } });
    await sequelize.query(`DELETE FROM chart_of_accounts WHERE id IN (:ids)`, { replacements: { ids: [tempBankAcctId, tempOffsetAcctId] } });
    await sequelize.query(`DELETE FROM branches WHERE id = :branchId`, { replacements: { branchId } });
    for (const code of ['3100', '3300']) {
      await sequelize.query(`UPDATE chart_of_accounts SET is_active = :active WHERE clinic_id = 1 AND account_code = :code`, { replacements: { active: wasActive[code], code } });
    }
  } catch (e) { console.warn('reportAccountingRegisters cleanup failed (non-fatal):', e.message); }
});

const range = { dateFrom: '2026-01-01', dateTo: '2026-12-31', clinic_id: '1' };

describe('Accounting Reports pull from account_ledger — the shared sink for both GL pipelines', () => {
  test('cash-flow opening balance is not inflated by an account having multiple ledger rows', async () => {
    // Real bug this covers: the opening-balance query used to LEFT JOIN
    // chart_of_accounts to account_ledger with no date restriction in the ON
    // clause, then SUM(coa.opening_balance) across that join — fanning the
    // opening balance out once per matched ledger row instead of once per
    // account. The temp bank account (opening_balance 1234.56) gets two
    // ledger rows in this fixture; under the old query its opening_balance
    // would have been counted twice (an extra +1234.56 the correct answer
    // doesn't have). Expected delta: 5000 (Cash's PRIOR entry) + 1234.56
    // (temp account's own opening_balance, counted exactly once) + 100
    // (temp account's one pre-dateFrom ledger row) — the in-period 50 row
    // must NOT appear here at all.
    const res = await run('/cash-flow', { ...range, allBranches: 'true', detail: 'false' });
    expect(res.body.openingBalance - cashFlowOpeningBaseline).toBeCloseTo(5000 + 1234.56 + 100, 2);
  });

  test('cash-flow groups by source_module with correct debit=in / credit=out amounts', async () => {
    const res = await run('/cash-flow', { ...range, allBranches: 'true', detail: 'false' });
    const rev = res.body.rows.find((r) => r.sourceModule === 'patient_billing');
    const cogs = res.body.rows.find((r) => r.sourceModule === 'pharmacy_dispensing');
    const draw = res.body.rows.find((r) => r.sourceModule === 'owner_drawing');
    expect(rev.cashIn).toBe(2000);
    expect(cogs.cashOut).toBe(800);
    expect(draw.cashOut).toBe(300);
  });

  test('general-ledger excludes the prior-period entry and includes exactly the 3 period entries (6 lines)', async () => {
    const res = await run('/general-ledger', { ...range, allBranches: 'true' });
    const mine = res.body.rows.filter((r) => r.referenceNumber && r.referenceNumber.startsWith(SUFFIX));
    expect(mine.length).toBe(6);
    expect(mine.some((r) => r.referenceNumber === `${SUFFIX}-PRIOR`)).toBe(false);
  });

  test('account-history for Cash shows exact debit/credit per line with a correctly accumulating running balance', async () => {
    const res = await run('/account-history', { ...range, accountId: acctIds['1100'] });
    const mine = res.body.rows.filter((r) => r.description && r.description.startsWith(SUFFIX));
    expect(mine.map((r) => [r.debitAmount, r.creditAmount])).toEqual([[2000, 0], [0, 800], [0, 300]]);
    // Running balance must step by exactly +2000, -800, -300 regardless of
    // whatever baseline pre-existing tenant_test activity contributes.
    expect(mine[1].runningBalance - mine[0].runningBalance).toBe(-800);
    expect(mine[2].runningBalance - mine[1].runningBalance).toBe(-300);
  });

  test('sub-account-history for cost_of_sales isolates only the 5210 line, not its paired Cash credit', async () => {
    const res = await run('/sub-account-history', { ...range, subAccountType: 'cost_of_sales' });
    const mine = res.body.rows.filter((r) => r.description && r.description.startsWith(SUFFIX));
    expect(mine.length).toBe(1);
    expect(mine[0].accountCode).toBe('5210');
    expect(mine[0].debitAmount).toBe(800);
  });

  test('journal-vouchers groups each reference_number into one balanced row', async () => {
    const res = await run('/journal-vouchers', { ...range, allBranches: 'true' });
    const mine = res.body.rows.filter((r) => r.referenceNumber && r.referenceNumber.startsWith(SUFFIX) && r.referenceNumber !== `${SUFFIX}-PRIOR`);
    expect(mine.length).toBe(3);
    for (const v of mine) {
      expect(v.totalDebit).toBe(v.totalCredit);
      expect(v.lineCount).toBe(2);
    }
  });

  test('income-statement-by-branch computes revenue/expenses/net income correctly for the branch', async () => {
    const res = await run('/income-statement-by-branch', range);
    const row = res.body.rows.find((r) => r.branchName === `${SUFFIX} Branch`);
    expect(row.totalRevenue).toBe(2000);
    expect(row.totalExpenses).toBe(800);
    expect(row.netIncome).toBe(1200);
  });

  test('equity-statement signs Drawings correctly (debit-normal, not inverted like a credit-normal account)', async () => {
    const res = await run('/equity-statement', range);
    const capital = res.body.rows.find((r) => r.accountCode === '3100');
    const drawings = res.body.rows.find((r) => r.accountCode === '3300');
    expect(capital.openingBalance).toBe(5000);
    expect(capital.periodActivity).toBe(0);
    // The actual bug: without the balance_type-aware fix, this came back -300.
    expect(drawings.periodActivity).toBe(300);
    expect(drawings.closingBalance).toBe(300);
  });
});

const { query, uuid } = require('./testDb');

/**
 * Seed data factories for tests.
 * All IDs are prefixed with 'test-' for easy cleanup.
 *
 * Column names match actual DB schema as of Mar 2026.
 */

const TEST_CLINIC_ID = 1;
const TEST_PREFIX = 't-';
const NOW = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const TODAY = () => new Date().toISOString().split('T')[0];

function testId() {
  // CHAR(36) columns — prefix 't-' (2) + short id (max 34) = 36 chars
  return TEST_PREFIX + uuid().replace(/-/g, '').slice(0, 34);
}

// ─── Cleanup ───────────────────────────────────────────────
async function cleanupTestData() {
  const tables = [
    'currency_conversion_log',
    'exchange_adjustments',
    'account_currency_balances',
    'multicurrency_report_settings',
    'insurance_batch_claim_items',
    'insurance_batch_claim_status_history',
    'insurance_batch_claims',
    'invoice_payments',
    'invoice_items',
    'invoices',
    'gl_line_items',
    'journal_entry_lines',
    'journal_entries',
    'general_ledger',
  ];

  for (const table of tables) {
    try {
      await query(`DELETE FROM \`${table}\` WHERE id LIKE 't-%'`);
    } catch (e) { /* skip */ }
  }

  try {
    await query(`DELETE FROM patient_bills WHERE id LIKE 't-%'`);
  } catch (e) { /* skip */ }

  try {
    await query(`DELETE FROM exchange_rates WHERE source = 'test'`);
  } catch (e) { /* skip */ }
}

// ─── Currencies ────────────────────────────────────────────
async function ensureBaseCurrencies() {
  const existing = await query(`SELECT code FROM currencies WHERE code IN ('SSP','USD')`);
  const codes = existing.map(r => r.code);
  if (!codes.includes('SSP')) {
    await query(`INSERT INTO currencies (code, name, symbol, is_base_currency, decimal_places, is_active)
                 VALUES ('SSP','South Sudanese Pound','SSP',1,2,1)`);
  }
  if (!codes.includes('USD')) {
    await query(`INSERT INTO currencies (code, name, symbol, is_base_currency, decimal_places, is_active)
                 VALUES ('USD','US Dollar','$',0,2,1)`);
  }
}

// ─── Exchange Rates ────────────────────────────────────────
async function createTestExchangeRate(overrides = {}) {
  const id = testId();
  const now = NOW();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    from_currency: 'USD',
    to_currency: 'SSP',
    rate: 5700.00,
    buy_rate: 5680.00,
    sell_rate: 5720.00,
    spot_rate: null,
    effective_date: TODAY(),
    source: 'test',
    is_active: 1,
    notes: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await query(
    `INSERT INTO exchange_rates (id, clinic_id, from_currency, to_currency, rate, buy_rate, sell_rate, spot_rate, effective_date, source, is_active, notes, created_by, created_at, updated_at)
     VALUES (:id, :clinic_id, :from_currency, :to_currency, :rate, :buy_rate, :sell_rate, :spot_rate, :effective_date, :source, :is_active, :notes, :created_by, :created_at, :updated_at)`,
    data
  );
  return data;
}

// ─── Bills (patient_bills) ─────────────────────────────────
// Schema: id, bill_number, patient_id, patient_name(NOT NULL), clinic_id,
//   total_amount, paid_amount, balance_amount, status, bill_date(NOT NULL),
//   created_by(NOT NULL), created_at(NOT NULL), updated_at(NOT NULL), ...
async function createTestBill(overrides = {}) {
  const id = testId();
  const now = NOW();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    patient_id: testId(),
    patient_name: 'Test Patient',
    bill_number: 'TBILL-' + Date.now(),
    total_amount: 5000,
    paid_amount: 0,
    balance_amount: 5000,
    status: 'pending',
    bill_date: TODAY(),
    created_by: 'test-system',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await query(
    `INSERT INTO patient_bills (id, clinic_id, patient_id, patient_name, bill_number,
      total_amount, paid_amount, balance_amount, status, bill_date, created_by, created_at, updated_at)
     VALUES (:id, :clinic_id, :patient_id, :patient_name, :bill_number,
      :total_amount, :paid_amount, :balance_amount, :status, :bill_date, :created_by, :created_at, :updated_at)`,
    data
  );
  return data;
}

// ─── Invoices ──────────────────────────────────────────────
// Schema: id, clinic_id, patient_id, patient_name(NOT NULL), invoice_number(NOT NULL),
//   amount(NOT NULL default 0), amount_paid(NOT NULL default 0), balance_due(NOT NULL default 0),
//   due_date(NOT NULL), status, scheme_id, scheme_name, bill_id, currency(VARCHAR 3),
//   exchange_rate, amount_in_base_currency
async function createTestInvoice(overrides = {}) {
  const id = testId();
  // Map currency_code alias to actual column 'currency'
  if (overrides.currency_code && !overrides.currency) {
    overrides.currency = overrides.currency_code;
  }
  delete overrides.currency_code;
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    invoice_number: 'TINV-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    patient_id: testId(),
    patient_name: 'Test Patient',
    bill_id: null,
    scheme_id: null,
    scheme_name: null,
    amount: 5000,
    amount_paid: 0,
    balance_due: 5000,
    status: 'unpaid',
    currency: 'SSP',
    exchange_rate: 1.0,
    amount_in_base_currency: 5000,
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    ...overrides,
  };
  await query(
    `INSERT INTO invoices (id, clinic_id, invoice_number, patient_id, patient_name, bill_id,
      scheme_id, scheme_name, amount, amount_paid, balance_due, status,
      currency, exchange_rate, amount_in_base_currency, due_date)
     VALUES (:id, :clinic_id, :invoice_number, :patient_id, :patient_name, :bill_id,
      :scheme_id, :scheme_name, :amount, :amount_paid, :balance_due, :status,
      :currency, :exchange_rate, :amount_in_base_currency, :due_date)`,
    data
  );
  return data;
}

// ─── GL Entries (general_ledger) ───────────────────────────
// Schema: id, clinic_id, gl_number(NOT NULL), transaction_date(NOT NULL),
//   description(NOT NULL), total_debit, total_credit, status,
//   transaction_currency(NOT NULL default 'SSP'), base_currency(NOT NULL default 'SSP'),
//   exchange_rate(NOT NULL default 1), created_by(NOT NULL), created_at(NOT NULL), updated_at(NOT NULL)
async function createTestGLEntry(overrides = {}) {
  const id = testId();
  const now = NOW();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    gl_number: 'TGL-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    transaction_date: TODAY(),
    description: 'Test GL entry',
    reference_module: 'test',
    reference_id: testId(),
    total_debit: 5000,
    total_credit: 5000,
    status: 'posted',
    is_posted: 1,
    transaction_currency: 'SSP',
    base_currency: 'SSP',
    exchange_rate: 1.0,
    base_total_debit: 5000,
    base_total_credit: 5000,
    created_by: 'test-system',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await query(
    `INSERT INTO general_ledger (id, clinic_id, gl_number, transaction_date, description,
      reference_module, reference_id, total_debit, total_credit, status, is_posted,
      transaction_currency, base_currency, exchange_rate, base_total_debit, base_total_credit,
      created_by, created_at, updated_at)
     VALUES (:id, :clinic_id, :gl_number, :transaction_date, :description,
      :reference_module, :reference_id, :total_debit, :total_credit, :status, :is_posted,
      :transaction_currency, :base_currency, :exchange_rate, :base_total_debit, :base_total_credit,
      :created_by, :created_at, :updated_at)`,
    data
  );
  return data;
}

// ─── GL Line Items ─────────────────────────────────────────
// Schema: id, gl_id(NOT NULL), account_id(NOT NULL),
//   debit_amount, credit_amount, currency_code, amount_in_currency,
//   exchange_rate, exchange_gain_loss, created_at(NOT NULL), updated_at(NOT NULL)
let _cachedAccountId = null;
async function getDefaultAccountId() {
  if (_cachedAccountId) return _cachedAccountId;
  const rows = await query('SELECT id FROM chart_of_accounts LIMIT 1');
  _cachedAccountId = rows.length ? rows[0].id : null;
  return _cachedAccountId;
}

async function createTestGLLineItem(glId, overrides = {}) {
  const id = testId();
  const now = NOW();
  const realAccountId = await getDefaultAccountId();
  const data = {
    id,
    gl_id: glId,
    account_id: realAccountId,
    debit_amount: 0,
    credit_amount: 0,
    currency_code: 'SSP',
    amount_in_currency: 0,
    exchange_rate: 1.0,
    exchange_gain_loss: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await query(
    `INSERT INTO gl_line_items (id, gl_id, account_id,
      debit_amount, credit_amount, currency_code, amount_in_currency,
      exchange_rate, exchange_gain_loss, created_at, updated_at)
     VALUES (:id, :gl_id, :account_id,
      :debit_amount, :credit_amount, :currency_code, :amount_in_currency,
      :exchange_rate, :exchange_gain_loss, :created_at, :updated_at)`,
    data
  );
  return data;
}

// ─── Journal Entries ───────────────────────────────────────
// Schema: id, clinic_id, je_number(NOT NULL), entry_date(NOT NULL),
//   description(NOT NULL), total_debit, total_credit, status,
//   transaction_currency(NOT NULL default 'SSP'), base_currency(NOT NULL default 'SSP'),
//   exchange_rate(NOT NULL default 1), created_by(NOT NULL), created_at(NOT NULL), updated_at(NOT NULL)
async function createTestJournalEntry(overrides = {}) {
  const id = testId();
  const now = NOW();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    je_number: 'TJE-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    entry_date: TODAY(),
    description: 'Test journal entry',
    total_debit: 1000,
    total_credit: 1000,
    status: 'posted',
    transaction_currency: 'SSP',
    base_currency: 'SSP',
    exchange_rate: 1.0,
    created_by: 'test-system',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await query(
    `INSERT INTO journal_entries (id, clinic_id, je_number, entry_date, description,
      total_debit, total_credit, status, transaction_currency, base_currency, exchange_rate,
      created_by, created_at, updated_at)
     VALUES (:id, :clinic_id, :je_number, :entry_date, :description,
      :total_debit, :total_credit, :status, :transaction_currency, :base_currency, :exchange_rate,
      :created_by, :created_at, :updated_at)`,
    data
  );
  return data;
}

// ─── Insurance Claim (insurance_batch_claims) ──────────────
// Schema: id, clinic_id, claim_number(NOT NULL), scheme_id(NOT NULL),
//   scheme_name, claim_amount, status
async function createTestClaim(overrides = {}) {
  const id = testId();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    claim_number: 'TCLM-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
    scheme_id: 'test-scheme',
    scheme_name: 'Test Scheme',
    claim_amount: 5000,
    status: 'draft',
    ...overrides,
  };
  await query(
    `INSERT INTO insurance_batch_claims (id, clinic_id, claim_number, scheme_id, scheme_name, claim_amount, status)
     VALUES (:id, :clinic_id, :claim_number, :scheme_id, :scheme_name, :claim_amount, :status)`,
    data
  );
  return data;
}

// ─── Exchange Adjustment ───────────────────────────────────
async function createTestExchangeAdjustment(overrides = {}) {
  const id = testId();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    from_currency: 'USD',
    to_currency: 'SSP',
    original_amount: 100,
    original_rate: 5700,
    original_base_amount: 570000,
    settlement_rate: 5750,
    settlement_base_amount: 575000,
    realized_gain_loss: 5000,
    unrealized_gain_loss: 0,
    adjustment_type: 'receivable',
    adjustment_status: 'realized',
    reference_type: 'test',
    reference_id: testId(),
    transaction_date: TODAY(),
    notes: 'Test adjustment',
    ...overrides,
  };
  await query(
    `INSERT INTO exchange_adjustments (id, clinic_id, from_currency, to_currency, original_amount, original_rate,
      original_base_amount, settlement_rate, settlement_base_amount, realized_gain_loss, unrealized_gain_loss,
      adjustment_type, adjustment_status, reference_type, reference_id, transaction_date, notes)
     VALUES (:id, :clinic_id, :from_currency, :to_currency, :original_amount, :original_rate,
      :original_base_amount, :settlement_rate, :settlement_base_amount, :realized_gain_loss, :unrealized_gain_loss,
      :adjustment_type, :adjustment_status, :reference_type, :reference_id, :transaction_date, :notes)`,
    data
  );
  return data;
}

// ─── Conversion Log ────────────────────────────────────────
async function createTestConversionLog(overrides = {}) {
  const id = testId();
  const data = {
    id,
    clinic_id: TEST_CLINIC_ID,
    from_currency: 'USD',
    to_currency: 'SSP',
    amount_source: 100,
    rate_used: 5700,
    amount_converted: 570000,
    conversion_method: 'manual',
    source_transaction_type: 'test',
    source_transaction_id: testId(),
    conversion_date: TODAY(),
    ...overrides,
  };
  await query(
    `INSERT INTO currency_conversion_log (id, clinic_id, from_currency, to_currency, amount_source, rate_used,
      amount_converted, conversion_method, source_transaction_type, source_transaction_id, conversion_date)
     VALUES (:id, :clinic_id, :from_currency, :to_currency, :amount_source, :rate_used,
      :amount_converted, :conversion_method, :source_transaction_type, :source_transaction_id, :conversion_date)`,
    data
  );
  return data;
}

module.exports = {
  TEST_CLINIC_ID,
  TEST_PREFIX,
  testId,
  cleanupTestData,
  ensureBaseCurrencies,
  createTestExchangeRate,
  createTestBill,
  createTestInvoice,
  createTestGLEntry,
  createTestGLLineItem,
  createTestJournalEntry,
  createTestClaim,
  createTestExchangeAdjustment,
  createTestConversionLog,
};

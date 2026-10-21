/**
 * The Analytics Assistant's LLM tool-use layer: the tool schema (the
 * allowlist Claude is actually given — see llmTools.js's header for why
 * this IS the security boundary) and the orchestration loop's mechanics
 * (feature flag, mock mode, permission checks run server-side before a
 * tool's query executes). Real Anthropic API calls are never made here —
 * mock mode exercises the loop's actual code path end to end without one,
 * and analyticsFunctions/CurrencyService are mocked so no DB connection is
 * needed either.
 */
jest.mock('../../src/server/services/analyticsChatbot/analyticsFunctions');
jest.mock('../../src/server/services/CurrencyService');
jest.mock('../../src/server/services/analyticsChatbot/chatbotEngine', () => ({
  hasPrivilege: jest.fn(),
}));

const analytics = require('../../src/server/services/analyticsChatbot/analyticsFunctions');
const CurrencyService = require('../../src/server/services/CurrencyService');
const { hasPrivilege } = require('../../src/server/services/analyticsChatbot/chatbotEngine');
const { TOOLS, executeTool } = require('../../src/server/services/analyticsChatbot/llmTools');

describe('llmTools — the tool allowlist Claude is actually given', () => {
  test('every tool has a name, description, and a well-formed input schema', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(15);
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema.type).toBe('object');
    }
  });

  test('every period-scoped tool declares the period parameter — snapshot tools (no period of their own) are the deliberate exceptions', () => {
    const SNAPSHOT_TOOLS = new Set(['get_total_patients', 'get_doctor_directory', 'get_low_stock', 'get_inventory_status']);
    for (const tool of TOOLS) {
      if (SNAPSHOT_TOOLS.has(tool.name)) {
        expect(tool.input_schema.properties.period).toBeUndefined();
        continue;
      }
      expect(tool.input_schema.properties.period).toBeDefined();
      expect(tool.input_schema.required).toContain('period');
    }
  });

  test('there is no tool for revenue per doctor — the one question with no reliable data behind it', () => {
    expect(TOOLS.some((t) => t.name.includes('doctor') && t.name.includes('revenue'))).toBe(false);
  });

  test('tool names are unique', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('executeTool — permission checks run server-side, before any query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    CurrencyService.getBaseCurrency.mockResolvedValue({ code: 'SSP' });
  });

  test('a non-authorized user gets permission_denied for revenue, and the query never runs', async () => {
    hasPrivilege.mockResolvedValue(false);
    const result = await executeTool(
      'get_revenue',
      { period: { named_period: 'today' } },
      { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 },
    );
    expect(result.error).toBe('permission_denied');
    expect(analytics.getRevenueTotal).not.toHaveBeenCalled();
  });

  test('an authorized user gets the real figure from analyticsFunctions, not a guess', async () => {
    hasPrivilege.mockResolvedValue(true);
    analytics.getRevenueTotal.mockResolvedValue({ total: 42000, count: 3 });
    const result = await executeTool(
      'get_revenue',
      { period: { named_period: 'today' } },
      { sequelize: {}, req: { user: { role: 'accountant' } }, clinicId: 1 },
    );
    expect(result.total).toBe(42000);
    expect(result.currency).toBe('SSP');
    expect(result.error).toBeUndefined();
  });

  test('department breakdown is also permission-gated the same way', async () => {
    hasPrivilege.mockResolvedValue(false);
    const result = await executeTool(
      'get_department_breakdown',
      { period: { named_period: 'today' } },
      { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 },
    );
    expect(result.error).toBe('permission_denied');
    expect(analytics.getDepartmentBreakdown).not.toHaveBeenCalled();
  });

  test('get_total_patients needs no period input and no special permission', async () => {
    analytics.getTotalPatientsCount.mockResolvedValue({ count: 412 });
    const result = await executeTool('get_total_patients', {}, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 });
    expect(result.count).toBe(412);
    expect(hasPrivilege).not.toHaveBeenCalled();
  });

  test('get_doctor_directory needs no period input and no special permission', async () => {
    analytics.listDoctors.mockResolvedValue([{ id: 1, display_name: 'Dr. Sarah Johnson' }]);
    const result = await executeTool('get_doctor_directory', {}, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 });
    expect(result.doctors).toEqual([{ id: 1, name: 'Dr. Sarah Johnson' }]);
    expect(hasPrivilege).not.toHaveBeenCalled();
  });

  test('get_low_stock needs no period input and no special permission', async () => {
    analytics.getLowStockCount.mockResolvedValue({ count: 3 });
    const result = await executeTool('get_low_stock', {}, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 });
    expect(result.count).toBe(3);
    expect(hasPrivilege).not.toHaveBeenCalled();
  });

  test('get_expenses is permission-gated, and the query never runs for an unauthorized user', async () => {
    hasPrivilege.mockResolvedValue(false);
    const result = await executeTool(
      'get_expenses', { period: { named_period: 'today' } }, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 },
    );
    expect(result.error).toBe('permission_denied');
    expect(analytics.getExpensesTotal).not.toHaveBeenCalled();
  });

  test('get_income_statement pulls the real general-ledger figure (getFullIncomeStatement), not the cash shortcut, and is permission-gated', async () => {
    hasPrivilege.mockResolvedValue(true);
    CurrencyService.getBaseCurrency.mockResolvedValue({ code: 'SSP' });
    analytics.getFullIncomeStatement.mockResolvedValue({
      totalRevenue: 500, totalExpenses: 200, netIncome: 300, expenseSections: { operating: 150, costOfSales: 50, miscellaneous: 0 },
    });
    const result = await executeTool(
      'get_income_statement', { period: { named_period: 'today' } }, { sequelize: {}, req: { user: { role: 'accountant' } }, clinicId: 1 },
    );
    expect(result.revenue).toBe(500);
    expect(result.expenses).toBe(200);
    expect(result.netIncome).toBe(300);
    expect(analytics.getFullIncomeStatement).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'cash');
  });

  test('get_income_statement defaults to cash basis but honors an explicit accrual request', async () => {
    hasPrivilege.mockResolvedValue(true);
    CurrencyService.getBaseCurrency.mockResolvedValue({ code: 'SSP' });
    analytics.getFullIncomeStatement.mockResolvedValue({ totalRevenue: 900, totalExpenses: 400, netIncome: 500, expenseSections: {} });
    const result = await executeTool(
      'get_income_statement', { period: { named_period: 'today' }, basis: 'accrual' }, { sequelize: {}, req: { user: { role: 'accountant' } }, clinicId: 1 },
    );
    expect(result.basis).toBe('accrual');
    expect(analytics.getFullIncomeStatement).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'accrual');
  });

  test('get_income_statement is permission-gated the same way as get_revenue/get_expenses', async () => {
    hasPrivilege.mockResolvedValue(false);
    const result = await executeTool(
      'get_income_statement', { period: { named_period: 'today' } }, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 },
    );
    expect(result.error).toBe('permission_denied');
    expect(analytics.getFullIncomeStatement).not.toHaveBeenCalled();
  });

  test('get_purchase_orders needs no special permission and passes an optional status filter through', async () => {
    analytics.getPurchaseOrdersSummary.mockResolvedValue({ count: 4, totalValue: 12000, byStatus: [{ status: 'approved', count: 4, total: 12000 }] });
    const result = await executeTool(
      'get_purchase_orders', { period: { named_period: 'today' }, status: 'approved' }, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 },
    );
    expect(result.count).toBe(4);
    expect(result.totalValue).toBe(12000);
    expect(hasPrivilege).not.toHaveBeenCalled();
    expect(analytics.getPurchaseOrdersSummary).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'approved' }));
  });

  test('get_pharmacy_dispensing needs no special permission', async () => {
    analytics.getPharmacyDispensingTotal.mockResolvedValue({ dispensedCount: 10, dispensedQuantity: 40, dispensedValue: 5000, returnedCount: 1, patientCount: 8 });
    const result = await executeTool('get_pharmacy_dispensing', { period: { named_period: 'today' } }, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 });
    expect(result.dispensedCount).toBe(10);
    expect(result.dispensedValue).toBe(5000);
    expect(hasPrivilege).not.toHaveBeenCalled();
  });

  test('get_inventory_status needs no period input and no special permission, defaults expiring_within_days to 90', async () => {
    analytics.getOutOfStockCount.mockResolvedValue({ count: 2 });
    analytics.getExpiringStockCount.mockResolvedValue({ count: 5, days: 90 });
    const result = await executeTool('get_inventory_status', {}, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 });
    expect(result.outOfStockCount).toBe(2);
    expect(result.expiringCount).toBe(5);
    expect(result.expiringWithinDays).toBe(90);
    expect(hasPrivilege).not.toHaveBeenCalled();
    expect(analytics.getExpiringStockCount).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ days: 90 }));
  });

  test('get_lab_registry needs no special permission', async () => {
    analytics.getLabRegistryOverview.mockResolvedValue({ ordersOutstanding: 3, ordersCompleted: 12, ordersTotal: 15, managerReviewBacklog: 2 });
    const result = await executeTool('get_lab_registry', { period: { named_period: 'today' } }, { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 });
    expect(result.ordersOutstanding).toBe(3);
    expect(result.managerReviewBacklog).toBe(2);
    expect(hasPrivilege).not.toHaveBeenCalled();
  });

  test('get_hospital_summary covers every module in one call, not just registrations/visits/revenue', async () => {
    hasPrivilege.mockResolvedValue(true);
    CurrencyService.getBaseCurrency.mockResolvedValue({ code: 'SSP' });
    analytics.getRegistrationsCount.mockResolvedValue({ count: 20 });
    analytics.getVisitsCount.mockResolvedValue({ count: 35 });
    analytics.getDoctorActivity.mockResolvedValue([{ doctor: 'Dr. A', visits: 10 }]);
    analytics.getRevenueTotal.mockResolvedValue({ total: 50000, count: 12 });
    analytics.getLabRegistryOverview.mockResolvedValue({ ordersOutstanding: 3, ordersCompleted: 12, managerReviewBacklog: 1 });
    analytics.getPharmacyDispensingTotal.mockResolvedValue({ dispensedCount: 8, dispensedValue: 3000 });
    analytics.getPurchaseOrdersSummary.mockResolvedValue({ count: 2, totalValue: 9000 });
    analytics.getOutOfStockCount.mockResolvedValue({ count: 1 });
    analytics.getExpiringStockCount.mockResolvedValue({ count: 4 });
    const result = await executeTool('get_hospital_summary', { period: { named_period: 'today' } }, { sequelize: {}, req: { user: { role: 'admin' } }, clinicId: 1 });
    expect(result.registrations).toBe(20);
    expect(result.visits).toBe(35);
    expect(result.revenue.total).toBe(50000);
    expect(result.lab).toEqual({ ordersOutstanding: 3, ordersCompleted: 12, managerReviewBacklog: 1 });
    expect(result.pharmacy).toEqual({ dispensedCount: 8, dispensedValue: 3000 });
    expect(result.purchaseOrders).toEqual({ count: 2, totalValue: 9000 });
    expect(result.inventory).toEqual({ outOfStockCount: 1, expiringCount: 4 });
  });

  test('registrations and visits need no special permission', async () => {
    analytics.getRegistrationsCount.mockResolvedValue({ count: 7 });
    const result = await executeTool(
      'get_patient_registrations',
      { period: { named_period: 'today' } },
      { sequelize: {}, req: { user: { role: 'reception' } }, clinicId: 1 },
    );
    expect(result.count).toBe(7);
    expect(hasPrivilege).not.toHaveBeenCalled();
  });

  test('an unresolved doctor name comes back as a clear miss, not a silent wrong match', async () => {
    analytics.listDoctors.mockResolvedValue([{ id: 1, display_name: 'Dr. Sarah Johnson' }]);
    const result = await executeTool(
      'get_doctor_activity',
      { period: { named_period: 'today' }, doctor_name: 'Someone Completely Unrelated' },
      { sequelize: {}, req: { user: { role: 'admin' } }, clinicId: 1 },
    );
    expect(result.error).toBe('doctor_not_found');
    expect(analytics.getDoctorActivity).not.toHaveBeenCalled();
  });

  test('an unknown tool name is reported, not thrown', async () => {
    const result = await executeTool('not_a_real_tool', {}, { sequelize: {}, req: { user: {} }, clinicId: 1 });
    expect(result.error).toBe('unknown_tool');
  });
});

describe('llmEngine — feature flag, mock mode, and the tool-use loop', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('is disabled by default (no env var set)', () => {
    delete process.env.ANALYTICS_CHATBOT_LLM_ENABLED;
    const { featureEnabled } = require('../../src/server/services/analyticsChatbot/llmEngine');
    expect(featureEnabled()).toBe(false);
  });

  test('requires the exact string "true", not just any truthy value', () => {
    process.env.ANALYTICS_CHATBOT_LLM_ENABLED = 'yes';
    const { featureEnabled } = require('../../src/server/services/analyticsChatbot/llmEngine');
    expect(featureEnabled()).toBe(false);
  });

  test('mock mode never runs in production regardless of the mock env var', () => {
    process.env.NODE_ENV = 'production';
    process.env.ANALYTICS_CHATBOT_MOCK = 'true';
    const { isMockMode } = require('../../src/server/services/analyticsChatbot/llmEngine');
    expect(isMockMode()).toBe(false);
  });

  test('mock mode answers without any network call or API key, exercising the real loop code path', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ANALYTICS_CHATBOT_MOCK = 'true';
    delete process.env.ANTHROPIC_API_KEY;
    const { answerQuestion } = require('../../src/server/services/analyticsChatbot/llmEngine');
    const result = await answerQuestion({
      sequelize: {}, req: { user: { id: 1, role: 'admin' } }, question: 'hello', history: [], clinicId: 1,
    });
    expect(result.text).toMatch(/mock/i);
    expect(result.toolCalls).toEqual([]);
  });

  test('without mock mode and no API key, it throws a config error rather than silently answering', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ANALYTICS_CHATBOT_MOCK;
    delete process.env.ANTHROPIC_API_KEY;
    const { answerQuestion } = require('../../src/server/services/analyticsChatbot/llmEngine');
    await expect(
      answerQuestion({ sequelize: {}, req: { user: { id: 1, role: 'admin' } }, question: 'hello', history: [], clinicId: 1 }),
    ).rejects.toThrow(/not fully configured/i);
  });
});

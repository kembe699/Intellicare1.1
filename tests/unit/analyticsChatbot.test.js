/**
 * Pure NLU-layer logic for the Analytics Assistant — intent classification,
 * date-expression parsing, and doctor-name entity extraction. None of these
 * touch the database, so they run fast and don't need a tenant connection.
 * The DB-backed analytics functions and the route's permission/isolation
 * behavior are deliberately NOT covered here — they need a real tenant
 * schema and are better exercised as integration tests against a seeded
 * test database (see tests/integration/ for that pattern elsewhere in this
 * repo); this file covers the part that's genuinely unit-testable.
 */
const { classifyIntent } = require('../../src/server/services/analyticsChatbot/intentClassifier');
const { resolveDateExpression, splitComparisonClauses, priorPeriodOf } = require('../../src/server/services/analyticsChatbot/dateParser');
const { extractDoctor } = require('../../src/server/services/analyticsChatbot/entityExtractor');
const responseTemplates = require('../../src/server/services/analyticsChatbot/responseTemplates');

describe('analyticsChatbot intentClassifier', () => {
  test.each([
    ['How many patients were registered today?', 'registrations'],
    ['How many new patients were registered this week?', 'registrations'],
    ['Show me the number of patient registrations for each day this week.', 'registrations'],
    ['How many patient visits occurred today?', 'visits'],
    ['How many outpatient visits occurred today?', 'visits'],
    ['How much revenue was collected today?', 'revenue'],
    ['How much revenue was collected this month?', 'revenue'],
    ['Which department generated the most revenue today?', 'department_breakdown'],
    ['Which departments received the most patients today?', 'department_breakdown'],
    ['Which doctor attended to the most patients today?', 'doctor_activity'],
    ['How many patients did each doctor attend to today?', 'doctor_activity'],
    ['Give me a summary of today\'s hospital activity.', 'summary'],
    ['What are the hospital\'s key statistics for this week?', 'summary'],
    // Broadened phrasing coverage, same intents as above
    ['How many walk-ins did we have today?', 'registrations'],
    ['How many consultations did we have today?', 'visits'],
    ['How much money did we make today?', 'revenue'],
    ['What was our turnover today?', 'revenue'],
    ['Who is the busiest doctor this week?', 'doctor_activity'],
    ['Give me a daily report', 'summary'],
    // Imperative doctor-activity phrasing, not just "which doctor...?"
    ['Show me the doctors', 'doctor_activity'],
    ['Show me the doctors for last month', 'doctor_activity'],
    ['doctors visits last week', 'doctor_activity'],
    ['seen by which doctors', 'doctor_activity'],
    // New meta-intents
    ['What date range was that?', 'date_range_query'],
    ['Give me the date range', 'date_range_query'],
    ['What can you do?', 'help'],
    ['help', 'help'],
    // Total patients (all-time snapshot) vs. registrations (new, in a period)
    ['How many patients are there in the system?', 'total_patients'],
    ['How many patients do we have in total?', 'total_patients'],
    ['What is the total number of patients?', 'total_patients'],
    // Doctor directory (a static roster) vs. doctor_activity (a period-scoped count)
    ['show me all doctors registered in the system', 'doctor_directory'],
    ['List the doctors', 'doctor_directory'],
    ['who are the doctors', 'doctor_directory'],
    // New financial intents
    ['How much did we spend this month?', 'expenses'],
    ['show me income statements and expenses please', 'income_statement'],
    ['what is our net income this month?', 'income_statement'],
    // Inventory
    ['are any items low on stock?', 'low_stock'],
    ['give me an inventory report', 'low_stock'],
  ])('%s -> %s', (question, expected) => {
    const result = classifyIntent(question);
    expect(result.matched).toBe(true);
    expect(result.intent).toBe(expected);
  });

  test('doctor-revenue phrasing is not misclassified as plain revenue or doctor activity', () => {
    const result = classifyIntent('Which doctor generated the most revenue this month?');
    expect(result.matched).toBe(true);
    expect(result.intent).toBe('doctor_revenue');
    expect(result.supported).toBe(false);
  });

  test('department breakdown is a supported, computed intent (not a limitation)', () => {
    const result = classifyIntent('Which department generated the most revenue today?');
    expect(result.supported).toBe(true);
  });

  test('revenue intent requires accounting.read', () => {
    const result = classifyIntent('How much revenue was collected today?');
    expect(result.requiresPermission).toBe('accounting.read');
  });

  test('registrations intent requires no special permission', () => {
    const result = classifyIntent('How many patients were registered today?');
    expect(result.requiresPermission).toBeNull();
  });

  test('detects a comparison question', () => {
    expect(classifyIntent("Compare today's visits with yesterday's visits.").isCompare).toBe(true);
    expect(classifyIntent('How many visits occurred today?').isCompare).toBe(false);
  });

  test('gibberish or unrelated text does not match any intent', () => {
    expect(classifyIntent('asdkjfh qwer what is the weather').matched).toBe(false);
    expect(classifyIntent('').matched).toBe(false);
    expect(classifyIntent('   ').matched).toBe(false);
  });
});

describe('analyticsChatbot dateParser', () => {
  const now = new Date(2026, 9, 21, 15, 30, 0); // Wed 21 Oct 2026, 15:30 local

  test('today', () => {
    const r = resolveDateExpression('How many patients were registered today?', now);
    expect(r.matched).toBe(true);
    expect(r.start).toEqual(new Date(2026, 9, 21));
    expect(r.end).toEqual(new Date(2026, 9, 22));
  });

  test('yesterday', () => {
    const r = resolveDateExpression('What about yesterday?', now);
    expect(r.matched).toBe(true);
    expect(r.start).toEqual(new Date(2026, 9, 20));
    expect(r.end).toEqual(new Date(2026, 9, 21));
  });

  test('this week is a rolling 7-day window, matching the Dashboard filter', () => {
    const r = resolveDateExpression('revenue this week', now);
    expect(r.start).toEqual(new Date(2026, 9, 14));
    expect(r.end).toEqual(new Date(2026, 9, 22));
  });

  test('last week is the 7 days before this week', () => {
    const r = resolveDateExpression('revenue last week', now);
    expect(r.start).toEqual(new Date(2026, 9, 7));
    expect(r.end).toEqual(new Date(2026, 9, 14));
  });

  test('this month is calendar-month-to-date, matching the Dashboard filter', () => {
    const r = resolveDateExpression('revenue this month', now);
    expect(r.start).toEqual(new Date(2026, 9, 1));
    expect(r.end).toEqual(new Date(2026, 9, 22));
  });

  test('last month is the full previous calendar month', () => {
    const r = resolveDateExpression('revenue last month', now);
    expect(r.start).toEqual(new Date(2026, 8, 1));
    expect(r.end).toEqual(new Date(2026, 9, 1));
  });

  test('last N days', () => {
    const r = resolveDateExpression('revenue in the last 14 days', now);
    expect(r.start).toEqual(new Date(2026, 9, 7));
    expect(r.end).toEqual(new Date(2026, 9, 22));
  });

  test('last N months ("last 5 months")', () => {
    const r = resolveDateExpression('show me the doctors for last 5 months', now);
    expect(r.matched).toBe(true);
    expect(r.start).toEqual(new Date(2026, 4, 21));
    expect(r.end).toEqual(new Date(2026, 9, 22));
    expect(r.label).toBe('Last 5 Months');
  });

  test('"for N months" (no "last") is understood the same way — the exact phrasing a user actually typed', () => {
    const r = resolveDateExpression('show me for 5 months', now);
    expect(r.matched).toBe(true);
    expect(r.start).toEqual(new Date(2026, 4, 21));
    expect(r.label).toBe('Last 5 Months');
  });

  test('"last N months" is checked before the plain "last month" match, so it is not swallowed by it', () => {
    const r = resolveDateExpression('revenue for the last 3 months', now);
    expect(r.label).toBe('Last 3 Months');
  });

  test('all time — a fixed sentinel start, not a special no-lower-bound code path', () => {
    const r = resolveDateExpression('show me for all the all time', now);
    expect(r.matched).toBe(true);
    expect(r.start).toEqual(new Date(2000, 0, 1));
    expect(r.end).toEqual(new Date(2026, 9, 22));
    expect(r.label).toBe('All Time');
  });

  test('all time, alternate phrasing: "since the beginning"', () => {
    const r = resolveDateExpression('total revenue since the beginning', now);
    expect(r.matched).toBe(true);
    expect(r.label).toBe('All Time');
  });

  test('all time, alternate phrasing: "from the start"', () => {
    const r = resolveDateExpression('how many patients have we had from the start', now);
    expect(r.matched).toBe(true);
    expect(r.label).toBe('All Time');
  });

  test('between two explicit dates, inclusive of the end date', () => {
    const r = resolveDateExpression('revenue between 2026-10-01 and 2026-10-15', now);
    expect(r.start).toEqual(new Date('2026-10-01T00:00:00'));
    expect(r.end).toEqual(new Date('2026-10-16T00:00:00'));
  });

  test('no date phrase at all defaults to today but reports matched:false', () => {
    const r = resolveDateExpression('How much revenue was collected?', now);
    expect(r.matched).toBe(false);
    expect(r.label).toBe('Today');
  });

  test('splitComparisonClauses finds an explicit two-sided comparison', () => {
    const parts = splitComparisonClauses("Compare today's visits with yesterday's visits");
    expect(parts).not.toBeNull();
    expect(resolveDateExpression(parts[0], now).label).toBe('Today');
    expect(resolveDateExpression(parts[1], now).label).toBe('Yesterday');
  });

  test('splitComparisonClauses returns null for a one-sided comparison', () => {
    expect(splitComparisonClauses("Compare today's revenue")).toBeNull();
  });

  test('priorPeriodOf maps named periods to their natural sibling', () => {
    const today = resolveDateExpression('today', now);
    expect(priorPeriodOf(today).label).toBe('Yesterday');
    const thisMonth = resolveDateExpression('this month', now);
    expect(priorPeriodOf(thisMonth).label).toBe('Last Month');
  });
});

describe('analyticsChatbot entityExtractor', () => {
  const doctors = [
    { id: 1, display_name: 'Dr. Sarah Johnson' },
    { id: 2, display_name: 'Dr. Michael Okello' },
  ];

  test('exact name match', () => {
    const match = extractDoctor('How many patients did Dr. Sarah Johnson attend to today?', doctors);
    expect(match?.id).toBe(1);
  });

  test('match without the "Dr." title', () => {
    const match = extractDoctor('How many patients did Sarah Johnson see today?', doctors);
    expect(match?.id).toBe(1);
  });

  test('tolerates a minor spelling slip', () => {
    const match = extractDoctor('visits for Michael Okelo this week', doctors);
    expect(match?.id).toBe(2);
  });

  test('no match for an unrelated question', () => {
    expect(extractDoctor('Which doctor attended to the most patients today?', doctors)).toBeNull();
  });

  test('no match when there are no doctors to check against', () => {
    expect(extractDoctor('Sarah Johnson', [])).toBeNull();
  });
});

describe('analyticsChatbot responseTemplates', () => {
  test('never claims a number that was not passed in', () => {
    const r = responseTemplates.revenue({ total: 125000.5, count: 7 }, 'Today', 'SSP');
    expect(r.text).toContain('125,000.50');
    expect(r.text).toContain('7');
  });

  test('zero results are reported honestly, not silently', () => {
    const r = responseTemplates.registrations({ count: 0 }, 'Today');
    expect(r.text).toBe('No patients were registered today.');
  });

  test('total patients is an all-time snapshot, with no period phrase attached', () => {
    const r = responseTemplates.totalPatients({ count: 412 });
    expect(r.text).toBe('There are 412 patients in the system.');
    expect(r.text).not.toMatch(/today|this week|this month/i);
  });

  test('doctor directory lists names directly for a small roster, no table needed', () => {
    const r = responseTemplates.doctorDirectory([{ display_name: 'Dr. A' }, { display_name: 'Dr. B' }]);
    expect(r.text).toContain('Dr. A');
    expect(r.text).toContain('Dr. B');
    expect(r.table).toBeUndefined();
  });

  test('doctor directory uses a table for a large roster instead of a huge sentence', () => {
    const doctors = Array.from({ length: 8 }, (_, i) => ({ display_name: `Dr. ${i}` }));
    const r = responseTemplates.doctorDirectory(doctors);
    expect(r.table.rows).toHaveLength(8);
  });

  test('doctor directory with no doctors says so plainly', () => {
    const r = responseTemplates.doctorDirectory([]);
    expect(r.text).toMatch(/no doctors registered/i);
  });

  test('low stock is a current snapshot, not period-scoped', () => {
    const r = responseTemplates.lowStock({ count: 4 });
    expect(r.text).toContain('4');
    expect(r.text).not.toMatch(/today|this week|this month/i);
  });

  test('low stock with zero items says so plainly, not silently', () => {
    const r = responseTemplates.lowStock({ count: 0 });
    expect(r.text).toBe('No items are currently low on stock.');
  });

  test('expenses never claims a number that was not passed in, and is honest about zero', () => {
    const r = responseTemplates.expenses({ total: 50000, count: 4 }, 'Today', 'SSP');
    expect(r.text).toContain('50,000.00');
    expect(r.text).toContain('4');
    const zero = responseTemplates.expenses({ total: 0, count: 0 }, 'Today', 'SSP');
    expect(zero.text).toMatch(/no expenses/i);
  });

  test('income statement computes net from exactly the revenue/expenses it was given, and discloses it is simplified', () => {
    const r = responseTemplates.incomeStatement({ total: 1000 }, { total: 400 }, 'Today', 'SSP');
    expect(r.text).toContain('1,000.00');
    expect(r.text).toContain('400.00');
    expect(r.text).toContain('600.00'); // net = 1000 - 400
    expect(r.text).toMatch(/simplified/i);
  });

  test('income statement reports a shortfall honestly when expenses exceed revenue', () => {
    const r = responseTemplates.incomeStatement({ total: 100 }, { total: 300 }, 'Today', 'SSP');
    expect(r.text).toMatch(/shortfall/i);
    expect(r.text).toContain('200.00'); // |100 - 300|
  });

  test('a limitation intent never returns a fabricated figure', () => {
    const r = responseTemplates.limitation('doctor_revenue');
    expect(r.text).toMatch(/reliably trackable/i);
    expect(r.text).not.toMatch(/\d/); // no numbers at all
  });

  test('department breakdown reports only exactly-categorized revenue, with its own coverage disclosed', () => {
    const r = responseTemplates.departmentBreakdown(
      {
        rows: [{ category: 'Pharmacy / Inventory', amount: 500 }, { category: 'Laboratory', amount: 300 }],
        totalBilled: 1000,
        categorizedBilled: 800,
      },
      'Today',
      'SSP',
    );
    expect(r.text).toContain('Pharmacy / Inventory');
    expect(r.text).toContain('80%');
    expect(r.table.rows).toHaveLength(2);
  });

  test('department breakdown with no categorized line items at all points at the Clinic Performance report instead of guessing', () => {
    const r = responseTemplates.departmentBreakdown({ rows: [], totalBilled: 1000, categorizedBilled: 0 }, 'Today', 'SSP');
    expect(r.text).toMatch(/Clinic Performance/);
    expect(r.table).toBeUndefined();
  });

  test('department breakdown with zero billing activity says so plainly', () => {
    const r = responseTemplates.departmentBreakdown({ rows: [], totalBilled: 0, categorizedBilled: 0 }, 'Today', 'SSP');
    expect(r.text).toBe('No billing activity was recorded today.');
  });

  test('clarifying response includes suggestions, not a guessed answer', () => {
    const r = responseTemplates.clarifying();
    expect(Array.isArray(r.suggestions)).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  test('date-range query reports back the prior turn\'s actual stored range, not a re-derived one', () => {
    // Mirrors exactly what actually happens: dateParser.js builds LOCAL-midnight
    // Date objects, they get JSON-serialized into chatbot_messages.params (which
    // calls toISOString() internally, same as here), then read back later. Using
    // real local-midnight Dates (not hand-written 'Z' strings) keeps this test
    // honest about timezone, instead of silently assuming UTC==local the way the
    // code itself briefly did (see the fix this guards against: a server east of
    // UTC previously showed the day BEFORE the real local calendar date).
    const start = new Date(2026, 9, 1); // local midnight, 1 Oct
    const end = new Date(2026, 9, 16); // local midnight, 16 Oct (exclusive)
    const r = responseTemplates.dateRangeQuery({ start: start.toISOString(), end: end.toISOString(), label: 'This Month' });
    expect(r.text).toBe('That was for This Month: 2026-10-01 to 2026-10-15.');
  });

  test('date-range query with no prior turn says so instead of guessing a range', () => {
    const r = responseTemplates.dateRangeQuery(undefined);
    expect(r.text).toMatch(/haven't answered anything yet/i);
  });

  test('help lists real, currently-supported capabilities', () => {
    const r = responseTemplates.help();
    expect(r.text).toMatch(/registrations/i);
    expect(r.text).toMatch(/revenue/i);
    expect(r.text).toMatch(/doctor/i);
  });
});

describe('analyticsChatbot chatbotEngine follow-up continuity (no DB required)', () => {
  const { answerQuestion } = require('../../src/server/services/analyticsChatbot/chatbotEngine');
  const fakeReq = { user: { id: 1, role: 'admin', clinicId: 1 } };

  // These two meta-intents (date_range_query, help) are answered entirely
  // from `priorTurn` without touching the database — safe to exercise here
  // without a tenant connection, unlike the other intents.

  test('"what date range was that?" answers from the prior turn and keeps its intent/range alive for the NEXT follow-up', async () => {
    const start = new Date(2026, 9, 21); // local midnight, consistent with how dateParser.js actually builds these
    const end = new Date(2026, 9, 22);
    const priorTurn = { intent: 'revenue', params: { start: start.toISOString(), end: end.toISOString(), label: 'Today' } };
    const result = await answerQuestion({ sequelize: null, req: fakeReq, question: 'what date range was that?', priorTurn });
    expect(result.text).toContain('Today');
    expect(result.text).toContain('2026-10-21');
    // The conversation's "current topic" is still revenue/Today after this
    // meta-question — a database-touching follow-up right after it (e.g.
    // "what about yesterday?") would correctly re-run the revenue intent.
    expect(result.intentKey).toBe('revenue');
    expect(result.dateRange.label).toBe('Today');
  });

  test('"help" never breaks the conversation\'s current topic', async () => {
    const priorTurn = {
      intent: 'registrations',
      params: { start: '2026-10-21T00:00:00.000Z', end: '2026-10-22T00:00:00.000Z', label: 'Today' },
    };
    const result = await answerQuestion({ sequelize: null, req: fakeReq, question: 'what can you do?', priorTurn });
    expect(result.text).toMatch(/registrations/i);
    expect(result.intentKey).toBe('registrations');
  });

  test('a date-range question with no prior turn at all does not throw and says so', async () => {
    const result = await answerQuestion({ sequelize: null, req: fakeReq, question: 'give me the date range', priorTurn: null });
    expect(result.text).toMatch(/haven't answered anything yet/i);
    expect(result.intentKey).toBeNull();
  });

  // Regression coverage for a real bug a user hit: once a conversation had
  // one real answer, ANY unmatched text (a bare "hey", a typo'd question)
  // was unconditionally inherited as "same question again", so the bot
  // looked stuck repeating its last answer forever no matter what was
  // typed. Fixed so inheritance only happens when the new message actually
  // signals a follow-up (a date phrase, or an explicit repeat word) —
  // everything else correctly falls through to a clarifying response.
  const priorDoctorTurn = {
    intent: 'doctor_activity',
    params: { start: new Date(2026, 9, 21).toISOString(), end: new Date(2026, 9, 22).toISOString(), label: 'Today' },
  };

  test('an unrelated greeting after a real answer asks a clarifying question instead of silently repeating it', async () => {
    const result = await answerQuestion({ sequelize: null, req: fakeReq, question: 'hey', priorTurn: priorDoctorTurn });
    expect(result.intentKey).toBeNull();
    expect(result.text).toMatch(/not sure I understood/i);
  });

  test('a typo-laden but genuinely new question after a real answer switches topic correctly, not stuck on the old one', async () => {
    // "susye" (typo for "system") doesn't stop this from matching
    // total_patients — "how many patients are there" alone is enough — so
    // this one resolves to a real, different intent rather than clarifying.
    // Either way, the bug this guards against is the SAME: it must not
    // silently stay on the old doctor_activity topic.
    const fakeSequelize = { query: jest.fn().mockResolvedValue([[{ cnt: 5 }]]) };
    const result = await answerQuestion({
      sequelize: fakeSequelize, req: fakeReq, question: 'how many patients are there in the susye', priorTurn: priorDoctorTurn,
    });
    expect(result.intentKey).toBe('total_patients');
    expect(result.intentKey).not.toBe('doctor_activity');
  });

  test('truly gibberish text after a real answer asks a clarifying question, not a stale repeat', async () => {
    const result = await answerQuestion({ sequelize: null, req: fakeReq, question: 'asdkjfh qwerty nonsense', priorTurn: priorDoctorTurn });
    expect(result.intentKey).toBeNull();
    expect(result.text).toMatch(/not sure I understood/i);
  });

  test('"run that again" still correctly inherits and re-runs the prior topic', async () => {
    const fakeSequelize = { query: jest.fn().mockResolvedValue([[]]) };
    const result = await answerQuestion({ sequelize: fakeSequelize, req: fakeReq, question: 'run that again', priorTurn: priorDoctorTurn });
    expect(result.intentKey).toBe('doctor_activity');
    expect(fakeSequelize.query).toHaveBeenCalled();
  });

  test('a new date phrase alone ("what about yesterday?") still correctly inherits the prior topic', async () => {
    const fakeSequelize = { query: jest.fn().mockResolvedValue([[]]) };
    const result = await answerQuestion({ sequelize: fakeSequelize, req: fakeReq, question: 'what about yesterday?', priorTurn: priorDoctorTurn });
    expect(result.intentKey).toBe('doctor_activity');
    expect(result.dateRange.label).toBe('Yesterday');
  });

  // Snapshot intents (total_patients, doctor_directory, low_stock) have no
  // period of their own — a bare date phrase after one of them doesn't mean
  // anything, so it must NOT be treated as "continue this with a new date"
  // the way it correctly is for a period-scoped intent like doctor_activity.
  const priorDirectoryTurn = { intent: 'doctor_directory', params: null };

  test('a date-only follow-up after a snapshot intent does not get treated as a continuation', async () => {
    const result = await answerQuestion({ sequelize: null, req: fakeReq, question: 'what about yesterday?', priorTurn: priorDirectoryTurn });
    expect(result.intentKey).toBeNull();
    expect(result.text).toMatch(/not sure I understood/i);
  });

  test('an explicit repeat word still correctly re-runs a snapshot intent (there is no date to misapply)', async () => {
    const fakeSequelize = { query: jest.fn().mockResolvedValue([[]]) };
    const result = await answerQuestion({ sequelize: fakeSequelize, req: fakeReq, question: 'run that again', priorTurn: priorDirectoryTurn });
    expect(result.intentKey).toBe('doctor_directory');
  });
});

// User-facing style requirement: no em dashes in anything the chatbot
// actually says. Exercises every template with representative input so a
// future edit can't silently reintroduce one.
describe('analyticsChatbot responseTemplates never emit an em dash', () => {
  const EM_DASH = /—/;

  test.each([
    ['registrations', responseTemplates.registrations({ count: 5 }, 'Today')],
    ['registrations (zero)', responseTemplates.registrations({ count: 0 }, 'Today')],
    ['totalPatients', responseTemplates.totalPatients({ count: 10 })],
    ['totalPatients (zero)', responseTemplates.totalPatients({ count: 0 })],
    ['doctorDirectory', responseTemplates.doctorDirectory([{ display_name: 'Dr A' }])],
    ['doctorDirectory (large)', responseTemplates.doctorDirectory(Array.from({ length: 8 }, (_, i) => ({ display_name: `Dr ${i}` })))],
    ['doctorDirectory (empty)', responseTemplates.doctorDirectory([])],
    ['lowStock', responseTemplates.lowStock({ count: 2 })],
    ['lowStock (zero)', responseTemplates.lowStock({ count: 0 })],
    ['visits', responseTemplates.visits({ count: 3 }, 'Today')],
    ['revenue', responseTemplates.revenue({ total: 100, count: 2 }, 'Today', 'SSP')],
    ['expenses', responseTemplates.expenses({ total: 100, count: 2 }, 'Today', 'SSP')],
    ['expenses (zero)', responseTemplates.expenses({ total: 0, count: 0 }, 'Today', 'SSP')],
    ['incomeStatement', responseTemplates.incomeStatement({ total: 1000 }, { total: 400 }, 'Today', 'SSP')],
    ['incomeStatement (shortfall)', responseTemplates.incomeStatement({ total: 100 }, { total: 300 }, 'Today', 'SSP')],
    ['doctorActivity', responseTemplates.doctorActivity([{ displayName: 'Dr X', visits: 3 }], 'Today')],
    ['doctorActivity (empty)', responseTemplates.doctorActivity([], 'Today')],
    [
      'summary',
      responseTemplates.summary(
        { registrations: { count: 1 }, visits: { count: 1 }, revenue: { total: 1, count: 1 }, topDoctor: { displayName: 'Dr X', visits: 1 } },
        'Today', 'SSP', true,
      ),
    ],
    [
      'departmentBreakdown',
      responseTemplates.departmentBreakdown({ rows: [{ category: 'A', amount: 1 }], totalBilled: 1, categorizedBilled: 1 }, 'Today', 'SSP'),
    ],
    [
      'departmentBreakdown (partial coverage)',
      responseTemplates.departmentBreakdown({ rows: [{ category: 'A', amount: 1 }], totalBilled: 10, categorizedBilled: 1 }, 'Today', 'SSP'),
    ],
    ['departmentBreakdown (none categorized)', responseTemplates.departmentBreakdown({ rows: [], totalBilled: 1, categorizedBilled: 0 }, 'Today', 'SSP')],
    ['limitation', responseTemplates.limitation('doctor_revenue')],
    ['accessDenied', responseTemplates.accessDenied()],
    ['clarifying', responseTemplates.clarifying()],
    ['dateRangeQuery (no prior turn)', responseTemplates.dateRangeQuery(undefined)],
    [
      'dateRangeQuery',
      responseTemplates.dateRangeQuery({ start: new Date(2026, 9, 21).toISOString(), end: new Date(2026, 9, 22).toISOString(), label: 'Today' }),
    ],
    ['help', responseTemplates.help()],
    ['compare', responseTemplates.compare('Revenue', 1, 2, 'Today', 'Yesterday', 'SSP')],
  ])('%s', (_name, result) => {
    expect(result.text).not.toMatch(EM_DASH);
  });
});

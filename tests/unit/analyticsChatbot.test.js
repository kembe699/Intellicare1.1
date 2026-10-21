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

  test('a limitation intent never returns a fabricated figure', () => {
    const r = responseTemplates.limitation('department_breakdown');
    expect(r.text).toMatch(/reliably trackable/i);
    expect(r.text).not.toMatch(/\d/); // no numbers at all
  });

  test('clarifying response includes suggestions, not a guessed answer', () => {
    const r = responseTemplates.clarifying();
    expect(Array.isArray(r.suggestions)).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});

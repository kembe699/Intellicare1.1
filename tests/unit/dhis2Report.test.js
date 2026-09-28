/**
 * DHIS2 monthly report — pure-logic unit tests.
 *
 * Covers the parts of src/server/routes/reportDhis2.js that don't need a
 * database: age/sex bucketing (including missing DOB/gender), the free-text
 * diagnosis keyword matcher (including negation on both sides of the
 * keyword), lab-test-row matching/positive detection, period math, and the
 * branch-scoping helper's precedence rules. DB-backed behavior (new vs
 * re-attendance, malaria confirmed vs clinical, Section C grouping, branch
 * isolation) is covered in tests/integration/dhis2Report.test.js.
 */
const { __testHelpers } = require('../../src/server/routes/reportDhis2');
const formDefinition = require('../../src/server/config/dhis2FormDefinition');

const {
  calcAgeYears, getAgeBandId, getSexBucket, bucketInto, emptyAgeSexRow,
  extractDiagnosisSegments, isNegatedMatch, matchDiagnosisRow,
  matchLabTestRow, isPositiveResult, pad2, getPeriodBounds, defaultPeriod,
  resolveEffectiveBranchId, branchScope,
} = __testHelpers;

describe('calcAgeYears', () => {
  test('computes whole years as of the given date, not today', () => {
    expect(calcAgeYears('2000-06-15', '2031-06-14')).toBe(30);
    expect(calcAgeYears('2000-06-15', '2031-06-15')).toBe(31);
    expect(calcAgeYears('2000-06-15', '2031-06-16')).toBe(31);
  });

  test('returns null for a missing or invalid date of birth', () => {
    expect(calcAgeYears(null, '2031-06-15')).toBeNull();
    expect(calcAgeYears(undefined, '2031-06-15')).toBeNull();
    expect(calcAgeYears('not-a-date', '2031-06-15')).toBeNull();
  });

  test('never returns a negative age', () => {
    expect(calcAgeYears('2031-07-01', '2031-06-15')).toBeNull();
  });
});

describe('getAgeBandId / getSexBucket / bucketInto', () => {
  test('bands under-5 and 5-and-over per the config thresholds', () => {
    expect(getAgeBandId(0)).toBe('u5');
    expect(getAgeBandId(4)).toBe('u5');
    expect(getAgeBandId(5)).toBe('ge5');
    expect(getAgeBandId(80)).toBe('ge5');
  });

  test('getAgeBandId(null) is unbanded', () => {
    expect(getAgeBandId(null)).toBeNull();
  });

  test('recognizes both full words and single-letter gender values', () => {
    expect(getSexBucket('Male')).toBe('m');
    expect(getSexBucket('M')).toBe('m');
    expect(getSexBucket('female')).toBe('f');
    expect(getSexBucket('f')).toBe('f');
    expect(getSexBucket('')).toBeNull();
    expect(getSexBucket(null)).toBeNull();
    expect(getSexBucket('other')).toBeNull();
  });

  test('buckets a known age/sex into the right column and into total', () => {
    const row = emptyAgeSexRow();
    bucketInto(row, 3, 'F');
    expect(row).toEqual({ u5m: 0, u5f: 1, ge5m: 0, ge5f: 0, unknown: 0, total: 1 });
    bucketInto(row, 40, 'Male');
    expect(row).toEqual({ u5m: 0, u5f: 1, ge5m: 1, ge5f: 0, unknown: 0, total: 2 });
  });

  test('missing date of birth goes to "unknown", never guessed into a band', () => {
    const row = emptyAgeSexRow();
    bucketInto(row, null, 'Male');
    expect(row.unknown).toBe(1);
    expect(row.u5m).toBe(0);
    expect(row.ge5m).toBe(0);
    expect(row.total).toBe(1);
  });

  test('missing gender goes to "unknown", never guessed into a band', () => {
    const row = emptyAgeSexRow();
    bucketInto(row, 30, null);
    expect(row.unknown).toBe(1);
    expect(row.ge5m).toBe(0);
    expect(row.ge5f).toBe(0);
    expect(row.total).toBe(1);
  });

  test('missing BOTH date of birth and gender still counts once, in unknown and in total', () => {
    const row = emptyAgeSexRow();
    bucketInto(row, null, null);
    expect(row).toEqual({ u5m: 0, u5f: 0, ge5m: 0, ge5f: 0, unknown: 1, total: 1 });
  });

  test('unknown is always included in total alongside every other column', () => {
    const row = emptyAgeSexRow();
    bucketInto(row, 3, 'M');
    bucketInto(row, 40, 'F');
    bucketInto(row, null, null);
    const sumOfColumns = row.u5m + row.u5f + row.ge5m + row.ge5f + row.unknown;
    expect(sumOfColumns).toBe(row.total);
    expect(row.total).toBe(3);
  });
});

describe('extractDiagnosisSegments', () => {
  test('extracts every "Diagnosis: X" segment, trimmed', () => {
    expect(extractDiagnosisSegments('Diagnosis: Malaria\nDiagnosis: UTI')).toEqual(['Malaria', 'UTI']);
  });

  test('de-dupes case-insensitively', () => {
    expect(extractDiagnosisSegments('Diagnosis: Malaria Diagnosis: malaria')).toEqual(['Malaria']);
  });

  test('returns an empty array for notes with no diagnosis segment', () => {
    expect(extractDiagnosisSegments('Patient seen for routine checkup.')).toEqual([]);
    expect(extractDiagnosisSegments(null)).toEqual([]);
    expect(extractDiagnosisSegments('')).toEqual([]);
  });
});

describe('isNegatedMatch — negation on both sides of the keyword', () => {
  const words = formDefinition.negationWords;
  const win = formDefinition.negationWindowChars;

  test('negated when the negation word appears BEFORE the keyword', () => {
    const text = 'rule out malaria this visit';
    const idx = text.indexOf('malaria');
    expect(isNegatedMatch(text, idx, idx + 'malaria'.length, words, win)).toBe(true);
  });

  test('negated when the negation word appears AFTER the keyword', () => {
    const text = 'malaria negative on rdt';
    const idx = text.indexOf('malaria');
    expect(isNegatedMatch(text, idx, idx + 'malaria'.length, words, win)).toBe(true);
  });

  test('"ruled out" after the keyword also negates it', () => {
    const text = 'malaria ruled out';
    const idx = text.indexOf('malaria');
    expect(isNegatedMatch(text, idx, idx + 'malaria'.length, words, win)).toBe(true);
  });

  test('not negated when no negation word is nearby on either side', () => {
    const text = 'confirmed malaria, started on al';
    const idx = text.indexOf('malaria');
    expect(isNegatedMatch(text, idx, idx + 'malaria'.length, words, win)).toBe(false);
  });

  test('a negation word beyond the window on both sides does not count', () => {
    const padding = 'x'.repeat(40);
    const text = `no ${padding} malaria ${padding} negative`;
    const idx = text.indexOf('malaria');
    expect(isNegatedMatch(text, idx, idx + 'malaria'.length, words, win)).toBe(false);
  });

  test('a negation meant for an earlier, unrelated term does not bleed across a clause boundary', () => {
    // "rule out" is only 9 chars from "uti", well inside a flat window, but it
    // belongs to the malaria clause that follows the full stop — it must not
    // suppress the separate "uti" diagnosis before it.
    const text = 'uti. also rule out malaria this visit';
    const idxUti = text.indexOf('uti');
    expect(isNegatedMatch(text, idxUti, idxUti + 'uti'.length, words, win)).toBe(false);
    const idxMalaria = text.indexOf('malaria');
    expect(isNegatedMatch(text, idxMalaria, idxMalaria + 'malaria'.length, words, win)).toBe(true);
  });
});

describe('matchDiagnosisRow', () => {
  const rows = formDefinition.sections.B.rows.filter((r) => !r.isTotal && !r.isMeta && !r.isMalariaClinicalFallback);
  const words = formDefinition.negationWords;
  const win = formDefinition.negationWindowChars;

  test('matches a plain keyword to its row id', () => {
    expect(matchDiagnosisRow('severe pneumonia', rows, words, win)).toBe('pneumonia_ari');
  });

  test('returns null when negated, even though the keyword is present', () => {
    expect(matchDiagnosisRow('rule out malaria', rows, words, win)).toBeNull();
    expect(matchDiagnosisRow('malaria negative', rows, words, win)).toBeNull();
  });

  test('returns null for free text matching no configured keyword', () => {
    expect(matchDiagnosisRow('completely unrelated complaint', rows, words, win)).toBeNull();
  });
});

describe('matchLabTestRow / isPositiveResult', () => {
  const rows = formDefinition.sections.C.rows;

  test('matches a specimen test name to its configured row', () => {
    expect(matchLabTestRow('Malaria RDT', 'MRDT', rows)).toBe('malaria_rdt');
    expect(matchLabTestRow('HIV Rapid Test', 'HIV1', rows)).toBe('hiv');
  });

  test('returns null when nothing configured matches', () => {
    expect(matchLabTestRow('Random Chemistry Panel', 'CHEM', rows)).toBeNull();
  });

  test('a specimen counts positive only when an approved value matches the configured positive list', () => {
    const malariaRow = rows.find((r) => r.id === 'malaria_rdt');
    expect(isPositiveResult(['positive'], malariaRow)).toBe(true);
    expect(isPositiveResult(['negative'], malariaRow)).toBe(false);
    expect(isPositiveResult([], malariaRow)).toBe(false);
  });
});

describe('period helpers', () => {
  test('pad2 zero-pads single digits', () => {
    expect(pad2(3)).toBe('03');
    expect(pad2(12)).toBe('12');
  });

  test('getPeriodBounds computes the first and last day of the month', () => {
    expect(getPeriodBounds('2031-02')).toMatchObject({ year: 2031, month: 2, periodStart: '2031-02-01', periodEnd: '2031-02-28' });
    // Leap year
    expect(getPeriodBounds('2032-02')).toMatchObject({ periodEnd: '2032-02-29' });
  });

  test('getPeriodBounds rejects a malformed period', () => {
    expect(() => getPeriodBounds('not-a-period')).toThrow();
  });

  test('defaultPeriod is last full calendar month', () => {
    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expectedStr = `${expected.getFullYear()}-${pad2(expected.getMonth() + 1)}`;
    expect(defaultPeriod()).toBe(expectedStr);
  });
});

describe('resolveEffectiveBranchId', () => {
  test('a non-admin always resolves to their own ambient branch, ignoring any requested branch', () => {
    const req = { user: { role: 'reports', branchId: 7 }, branchContext: { branchId: 7 } };
    expect(resolveEffectiveBranchId(req, 999)).toBe(7);
  });

  test('an admin\'s explicit requested branch id wins', () => {
    const req = { user: { role: 'admin' }, branchContext: { adminScoped: false } };
    expect(resolveEffectiveBranchId(req, '12')).toBe(12);
  });

  test('an admin with no requested branch and no ambient scope gets null ("All Branches")', () => {
    const req = { user: { role: 'admin' }, branchContext: { adminScoped: false } };
    expect(resolveEffectiveBranchId(req, null)).toBeNull();
  });

  test('an admin with no requested branch falls back to their ambient TopBar scope', () => {
    const req = { user: { role: 'admin' }, branchContext: { adminScoped: true, branchId: 4 } };
    expect(resolveEffectiveBranchId(req, undefined)).toBe(4);
  });
});

describe('branchScope', () => {
  test('an explicit overrideBranchId always wins, regardless of req', () => {
    const replacements = {};
    const sql = branchScope({ user: { role: 'admin' } }, replacements, 'o', 42);
    expect(sql).toBe(' AND o.branch_id = :branchId');
    expect(replacements.branchId).toBe(42);
  });

  test('overrideBranchId of null means no branch filter at all ("All Branches")', () => {
    const replacements = {};
    const sql = branchScope({ user: { role: 'admin' } }, replacements, 'o', null);
    expect(sql).toBe('');
    expect(replacements.branchId).toBeUndefined();
  });

  test('an admin with no override and no adminScoped header sees every branch', () => {
    const replacements = {};
    const sql = branchScope({ user: { role: 'admin' }, branchContext: {} }, replacements);
    expect(sql).toBe('');
  });

  test('a non-admin is always scoped to their own branch', () => {
    const replacements = {};
    const sql = branchScope({ user: { role: 'reports', branchId: 9 }, branchContext: {} }, replacements, 'r');
    expect(sql).toBe(' AND r.branch_id = :branchId');
    expect(replacements.branchId).toBe(9);
  });
});

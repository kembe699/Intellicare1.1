/**
 * ICD-10 feature — pure-logic unit tests (no database). Covers the CMS
 * order-file adapter, the chapter-range lookup, the search query's
 * normalize/synonym helpers, and the free-text diagnosis segment parser
 * used by the backfill script. DB-backed search ranking, duplicate
 * prevention, closed-visit rules and tenant/branch isolation are covered in
 * tests/integration/icd10.test.js.
 */
const path = require('path');
const { parseOrderFile, parseCodesFileCount, withDot } = require('../../src/server/data/icd10/adapters/cmsOrderFile');
const { chapterForCategory, CHAPTERS } = require('../../src/server/data/icd10/chapters');
const { __testHelpers } = require('../../src/server/routes/icd10');
const { extractDiagnosisSegments } = require('../../src/server/scripts/backfillVisitDiagnoses');
const { MOH_CODE_REMAP } = require('../../src/server/scripts/importIcd10');
const MOH_DIAGNOSES = require('../../src/server/scripts/icd10MohList');

const { normalizeCodeQuery, expandSynonyms, buildPrefixTsQuery } = __testHelpers;

const ORDER_FILE = path.join(__dirname, '../../src/server/data/icd10/icd10cm_order_2027.txt.gz');
const CODES_FILE = path.join(__dirname, '../../src/server/data/icd10/icd10cm_codes_2027.txt.gz');

describe('withDot', () => {
  test('inserts a dot after the 3-character category for subdivided codes', () => {
    expect(withDot('A010')).toBe('A01.0');
    expect(withDot('C441021')).toBe('C44.1021');
  });

  test('leaves 3-character category headers undotted', () => {
    expect(withDot('A01')).toBe('A01');
    expect(withDot('B54')).toBe('B54');
  });
});

describe('parseOrderFile (real CMS FY2027 source file)', () => {
  let rows;
  beforeAll(() => { rows = parseOrderFile(ORDER_FILE); });

  test('parses well over 70,000 codes', () => {
    expect(rows.length).toBeGreaterThan(70000);
  });

  test('billable count matches the sibling codes-only file exactly', () => {
    const billable = rows.filter((r) => r.isBillable).length;
    expect(billable).toBe(parseCodesFileCount(CODES_FILE));
  });

  test('includes non-billable category header codes (the spec\'s own A01 example)', () => {
    const a01 = rows.find((r) => r.codeNoDot === 'A01');
    expect(a01).toBeDefined();
    expect(a01.isBillable).toBe(false);
    expect(a01.description).toMatch(/Typhoid and paratyphoid fevers/i);
  });

  test('includes billable leaf codes with the dotted display form', () => {
    const b54 = rows.find((r) => r.codeNoDot === 'B54');
    expect(b54).toBeDefined();
    expect(b54.code).toBe('B54');
    expect(b54.isBillable).toBe(true);
    expect(b54.description).toMatch(/malaria/i);
  });

  test('every code is unique', () => {
    const codes = new Set(rows.map((r) => r.codeNoDot));
    expect(codes.size).toBe(rows.length);
  });
});

describe('chapterForCategory', () => {
  test('maps a category to its chapter name', () => {
    expect(chapterForCategory('B54')).toMatch(/infectious and parasitic/i);
    expect(chapterForCategory('J18')).toMatch(/respiratory/i);
  });

  test('handles the alpha-tailed chapter boundary (O9A)', () => {
    expect(chapterForCategory('O9A')).toMatch(/Pregnancy/i);
    expect(chapterForCategory('P00')).toMatch(/perinatal/i);
    expect(chapterForCategory('O99')).toMatch(/Pregnancy/i);
  });

  test('every chapter boundary is exactly 3 characters (required for the string-range comparison)', () => {
    for (const c of CHAPTERS) {
      expect(c.start).toHaveLength(3);
      expect(c.end).toHaveLength(3);
    }
  });

  test('returns null for a category outside every defined chapter', () => {
    expect(chapterForCategory('')).toBeNull();
  });
});

describe('buildPrefixTsQuery — search-as-you-type', () => {
  test('marks only the last word as a prefix', () => {
    expect(buildPrefixTsQuery('malaria fal')).toBe('malaria & fal:*');
  });

  test('a single (possibly partial) word becomes a bare prefix term', () => {
    expect(buildPrefixTsQuery('malar')).toBe('malar:*');
  });

  test('ignores punctuation between words', () => {
    expect(buildPrefixTsQuery('cholera, unspecified')).toBe('cholera & unspecified:*');
  });

  test('returns null for input with no word characters', () => {
    expect(buildPrefixTsQuery('...')).toBeNull();
    expect(buildPrefixTsQuery('')).toBeNull();
  });
});

describe('normalizeCodeQuery', () => {
  test('strips dots and non-alphanumerics, uppercases', () => {
    expect(normalizeCodeQuery('b54')).toBe('B54');
    expect(normalizeCodeQuery('A01.0')).toBe('A010');
    expect(normalizeCodeQuery('a010')).toBe('A010');
    expect(normalizeCodeQuery(' a01.0 ')).toBe('A010');
  });
});

describe('expandSynonyms', () => {
  test('replaces a known shorthand with its full phrase', () => {
    expect(expandSynonyms('uti')).toBe('urinary tract infection');
  });

  test('does not keep the bare abbreviation alongside the expansion', () => {
    // plainto_tsquery ANDs every remaining word together, and no ICD-10
    // description contains the literal word "uti" — keeping it in the
    // expanded text would make the resulting tsquery unmatchable.
    expect(expandSynonyms('uti')).not.toMatch(/\buti\b/i);
  });

  test('leaves unrelated words untouched', () => {
    expect(expandSynonyms('malaria falciparum')).toBe('malaria falciparum');
  });

  test('expands a synonym embedded among other words without dropping them', () => {
    const expanded = expandSynonyms('child uti fever');
    expect(expanded).toMatch(/child/);
    expect(expanded).toMatch(/urinary tract infection/i);
    expect(expanded).toMatch(/fever/);
  });

  test('is case-insensitive on the shorthand itself', () => {
    expect(expandSynonyms('UTI')).toMatch(/urinary tract infection/i);
  });
});

describe('extractDiagnosisSegments (backfill parser)', () => {
  test('extracts every "Diagnosis: X" segment, trimmed', () => {
    expect(extractDiagnosisSegments('Diagnosis: Malaria\nDiagnosis: UTI')).toEqual(['Malaria', 'UTI']);
  });

  test('de-dupes case-insensitively', () => {
    expect(extractDiagnosisSegments('Diagnosis: Malaria Diagnosis: malaria')).toEqual(['Malaria']);
  });

  test('returns an empty array when there is no diagnosis segment', () => {
    expect(extractDiagnosisSegments('Routine checkup, nothing else documented.')).toEqual([]);
    expect(extractDiagnosisSegments(null)).toEqual([]);
  });
});

describe('mohDiagnoses.ts coverage against the imported ICD-10-CM set', () => {
  let rows;
  let codeSet;
  beforeAll(() => {
    rows = parseOrderFile(ORDER_FILE);
    codeSet = new Set(rows.map((r) => r.codeNoDot));
  });

  test('every mohDiagnoses.ts code either exists in CM as-is, or has a documented remap', () => {
    expect(MOH_DIAGNOSES.length).toBeGreaterThan(0);
    const unexplained = [];
    for (const m of MOH_DIAGNOSES) {
      const nodot = m.icd10Code.replace(/\./g, '');
      if (codeSet.has(nodot)) continue;
      if (MOH_CODE_REMAP[m.icd10Code]) continue;
      unexplained.push(m);
    }
    expect(unexplained).toEqual([]);
  });

  test('every remap target is itself a real, current ICD-10-CM code', () => {
    for (const [mohCode, remap] of Object.entries(MOH_CODE_REMAP)) {
      const targetNoDot = remap.to.replace(/\./g, '');
      expect(codeSet.has(targetNoDot)).toBe(true);
    }
  });
});

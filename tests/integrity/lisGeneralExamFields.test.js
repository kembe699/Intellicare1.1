/**
 * LIS order / Visit Summary examination layout: a free-text General
 * Examination right after Economic History / Allergies, then the
 * "Systematic Examination" section (a title only, Abdomen first), and
 * Impressions last — on entry, Visit Summary and print.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '../../src/pages/lis/LISTestOrders.tsx'), 'utf8');
const examFields = src.slice(src.indexOf('const GENERAL_EXAM_FIELDS'), src.indexOf('const EMPTY_GENERAL_EXAM'));
const keys = [...examFields.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);

test("Abdomen is the first finding, on the original 'abdomen' key", () => {
  expect(keys[0]).toBe('abdomen');
  expect(examFields).toMatch(/key: 'abdomen', label: 'Abdomen'/);
});

test('Systematic Examination is only the section title, not a field', () => {
  expect(keys).not.toContain('systematic_examination');
  expect(src).not.toMatch(/>General Examination<\/(label|p)>\s*<div className="grid/);
  expect(src.match(/>Systematic Examination<\/(label|p)>/g)).toHaveLength(3);
  expect(src).toMatch(/ic-section-title">Systematic Examination</);
});

test('General Examination notes are part of every empty form and pre-filled from saved vitals', () => {
  expect(src.match(/impressions: '', general_examination_notes: ''/g)).toHaveLength(2);
  expect(src).toMatch(/general_examination_notes: v\.general_examination_notes \|\| ''/);
});

test('Entry forms: Allergies → General Examination → Systematic Examination → Impressions', () => {
  for (const form of ['vitals', 'clinicalNotesForm']) {
    const at = (re) => src.search(re);
    const allergies = at(new RegExp(`value=\\{${form}\\.allergies\\}`));
    const general = at(new RegExp(`value=\\{${form}\\.general_examination_notes\\}`));
    const systematic = at(new RegExp(`value=\\{${form}\\.general_examination\\[key\\]\\}`));
    const impressions = at(new RegExp(`value=\\{${form}\\.impressions\\}`));
    expect(allergies).toBeGreaterThan(-1);
    expect(general).toBeGreaterThan(allergies);
    expect(systematic).toBeGreaterThan(general);
    expect(impressions).toBeGreaterThan(systematic);
  }
});

test('Visit Summary shows General Examination with the histories and prints it right after Allergies, Impressions last', () => {
  expect(src.match(/\['Allergies', selectedSummary\.vitals\?\.allergies\],\s*\['General Examination', selectedSummary\.vitals\?\.general_examination_notes\]/g)).toHaveLength(2);
  expect(src).toMatch(/plainNote\('Allergies', v\.allergies\),\s*plainNote\('General Examination', v\.general_examination_notes\),\s*gynaeHTML,\s*generalExamHTML,\s*plainNote\('Impressions', v\.impressions\)/);
});

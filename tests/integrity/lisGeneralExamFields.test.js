/**
 * LIS order / Visit Summary examination fields: Abdomen is back on its
 * original 'abdomen' key and listed first, Systematic Examination has its own
 * key, and a free-text General Examination sits beside Impressions everywhere
 * Impressions is entered, shown and printed.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '../../src/pages/lis/LISTestOrders.tsx'), 'utf8');
const examFields = src.slice(src.indexOf('const GENERAL_EXAM_FIELDS'), src.indexOf('const EMPTY_GENERAL_EXAM'));

test("Abdomen is first, on the original 'abdomen' key", () => {
  const keys = [...examFields.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
  expect(keys[0]).toBe('abdomen');
  expect(examFields).toMatch(/key: 'abdomen', label: 'Abdomen'/);
});

test('Systematic Examination comes second, on its own key', () => {
  const keys = [...examFields.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
  expect(keys[1]).toBe('systematic_examination');
  expect(examFields).toMatch(/key: 'systematic_examination', label: 'Systematic Examination'/);
});

test('General Examination notes are part of every empty form and pre-filled from saved vitals', () => {
  expect(src.match(/impressions: '', general_examination_notes: ''/g)).toHaveLength(2);
  expect(src).toMatch(/general_examination_notes: v\.general_examination_notes \|\| ''/);
});

test('General Examination is entered next to Impressions on both the order form and Visit Summary', () => {
  expect(src).toMatch(/value=\{vitals\.general_examination_notes\}/);
  expect(src).toMatch(/value=\{clinicalNotesForm\.general_examination_notes\}/);
});

test('General Examination is shown on Visit Summary and printed right before Impressions', () => {
  expect(src).toMatch(/\['General Examination', selectedSummary\.vitals\?\.general_examination_notes\]/);
  expect(src).toMatch(/plainNote\('General Examination', v\.general_examination_notes\),\s*plainNote\('Impressions', v\.impressions\)/);
});

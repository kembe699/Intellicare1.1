// Server-side (CommonJS) view of src/data/mohDiagnoses.ts's MOH_DIAGNOSES
// list, for the ICD-10 importer to mark priority codes and check coverage
// against. Extracted from the .ts source text itself (a Vite/TS file can't
// be `require()`d directly from a plain Node script) rather than duplicated
// by hand, so it can never silently drift out of sync with the real list.
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, '../../data/mohDiagnoses.ts');

function loadMohDiagnoses() {
  const src = fs.readFileSync(SOURCE_PATH, 'utf8');
  const entries = [];
  // Each diagnosis is a single-line object literal: { id: '1', name: '...',
  // icd10Code: '...', ... }. No nested braces in any entry, so a non-greedy
  // brace match per line is exact, not approximate.
  const objectRe = /\{[^{}]*\}/g;
  const matches = src.match(objectRe) || [];
  for (const block of matches) {
    const nameMatch = block.match(/name:\s*'([^']*)'/);
    const codeMatch = block.match(/icd10Code:\s*'([^']*)'/);
    if (nameMatch && codeMatch) {
      entries.push({ name: nameMatch[1], icd10Code: codeMatch[1] });
    }
  }
  if (entries.length === 0) {
    throw new Error(`No MOH_DIAGNOSES entries parsed from ${SOURCE_PATH} — has the file's format changed?`);
  }
  return entries;
}

module.exports = loadMohDiagnoses();

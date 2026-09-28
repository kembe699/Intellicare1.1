// Adapter for CMS's ICD-10-CM "order file" format (icd10cm_order_<year>.txt,
// gzipped under src/server/data/icd10/). Fixed-width columns, one row per
// code, INCLUDING the non-billable category/header codes (e.g. "A01
// Typhoid and paratyphoid fevers") — the order file is used specifically
// because the sibling icd10cm_codes_<year>.txt only lists billable leaf
// codes, and the spec requires both.
//
// Column layout (verified against the FY2027 file, one file per CMS release
// for as long as they've published this format):
//   0-4   order sequence number
//   6-12  code, left-justified in a 7-char field, NO dot (e.g. "A00", "C441021")
//   14    billable flag: '1' billable, '0' header/category, non-billable
//   16-76 short (legacy 80-column) description
//   77+   long description, to end of line
//
// Importing a different source (e.g. a future WHO ICD-10 release) means
// writing a new adapter with this same output shape — nothing downstream
// (importIcd10.js, the search API, visit_diagnoses) needs to change.
const zlib = require('zlib');
const fs = require('fs');

// Inserts a dot after the 3-character category for display, matching how
// ICD-10 codes are conventionally written (e.g. "A010" -> "A01.0"). Category
// headers (3 chars, e.g. "A01") have no subdivision and so get no dot.
function withDot(codeNoDot) {
  return codeNoDot.length > 3 ? `${codeNoDot.slice(0, 3)}.${codeNoDot.slice(3)}` : codeNoDot;
}

/**
 * Parses a gzipped CMS order-file at `gzPath` into
 * { code, codeNoDot, description, shortDescription, isBillable }[].
 */
function parseOrderFile(gzPath) {
  const raw = zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const codeNoDot = line.slice(6, 13).trim();
    const isBillable = line.slice(14, 15) === '1';
    const shortDescription = line.slice(16, 77).trim();
    const description = line.slice(77).trim() || shortDescription;
    return { code: withDot(codeNoDot), codeNoDot, description, shortDescription, isBillable };
  });
}

/**
 * Parses the sibling codes-only file (billable leaf codes only, two plain
 * columns) purely as a cross-check: its row count must equal the order
 * file's billable-row count, or the two files disagree about what's
 * billable and the import should fail loudly rather than seed silently
 * wrong data.
 */
function parseCodesFileCount(gzPath) {
  const raw = zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8');
  return raw.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

module.exports = { parseOrderFile, parseCodesFileCount, withDot };

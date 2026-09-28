// Imports the full ICD-10-CM code set into ONE shared table,
// `public.icd10_codes` — read-only reference data, identical for every
// tenant. `public` is already on every tenant connection's search_path
// (see dbConnectionOptions.js: `SET search_path TO "<tenant>", public`) and
// already holds the control-plane tables (clients, plans, invoices — see
// config/platformDatabase.js), so this reuses infrastructure the app
// already depends on instead of introducing a new schema, new grants, or a
// new connection type. Every query against it is schema-qualified
// (`public.icd10_codes`) regardless, so it's never ambiguous with anything
// a tenant might create.
//
// Idempotent: a second run with the same source+version is a fast no-op
// (single COUNT check) so this can sit in the normal boot-time migration
// runner without re-importing ~98k rows on every restart.
const path = require('path');
const platformSequelize = require('../config/platformDatabase');
const { parseOrderFile, parseCodesFileCount } = require('../data/icd10/adapters/cmsOrderFile');
const { chapterForCategory } = require('../data/icd10/chapters');
const MOH_DIAGNOSES = require('./icd10MohList');

const SOURCE = 'CMS-ICD10CM';
const VERSION = '2027';
const ORDER_FILE = path.join(__dirname, '../data/icd10/icd10cm_order_2027.txt.gz');
const CODES_FILE = path.join(__dirname, '../data/icd10/icd10cm_codes_2027.txt.gz');

// mohDiagnoses.ts codes that don't exist in ICD-10-CM (WHO-only codes) —
// confirmed by diffing all 61 codes in that file against this import.
// Mapped to the closest valid CM code so "MoH priority" still lands
// somewhere real, with the reasoning kept here rather than silently dropped.
const MOH_CODE_REMAP = {
  // CM has no O06 (WHO "unspecified abortion") category at all; O03.9 is the
  // generic "complete or unspecified spontaneous abortion, no complication"
  // — the closest match and the far more common presentation.
  'O06.9': { to: 'O03.9', reason: 'CM has no O06 (WHO "unspecified abortion") category; O03.9 is the closest generic match (complete or unspecified spontaneous abortion, without complication).' },
  // CM's M13 (Other arthritis) block has no single unspecified-type code;
  // M13.80 is the closest generic entry in that block.
  'M13.9': { to: 'M13.80', reason: 'CM has no single "arthritis, unspecified" code; M13.80 (Other specified arthritis, unspecified site) is the closest entry in the M13 block.' },
  // Already the code src/server/config/dhis2FormDefinition.js uses for the
  // same "Injuries" concept.
  'T14.1': { to: 'T14.90XA', reason: 'CM has no T14.1; T14.90XA (Injury, unspecified, initial encounter) is the code already used for "Injuries" elsewhere (dhis2FormDefinition.js).' },
};

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/\./g, '');
}

/** Creates the extension, table and indexes. Safe to re-run. */
async function migrateIcd10Table(db = platformSequelize) {
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } catch (err) {
    // Some managed Postgres roles can't CREATE EXTENSION even though pg_trgm
    // is pre-approved on most providers (including Render) — degrade to a
    // plain B-tree/GIN-on-tsvector search rather than failing the whole
    // migration over an index that's a performance nicety, not a
    // correctness requirement.
    console.error('⚠️  Could not create pg_trgm extension (search will fall back to plain ILIKE/tsvector):', err.message);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.icd10_codes (
      id BIGSERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      code_nodot VARCHAR(10) NOT NULL,
      description TEXT NOT NULL,
      category_code VARCHAR(3) NOT NULL,
      chapter VARCHAR(255),
      block TEXT,
      is_billable BOOLEAN NOT NULL DEFAULT false,
      is_priority BOOLEAN NOT NULL DEFAULT false,
      source VARCHAR(50) NOT NULL,
      version VARCHAR(20) NOT NULL,
      search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', description)) STORED,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_icd10_code_source_version UNIQUE (code_nodot, source, version)
    )
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_icd10_code_nodot ON public.icd10_codes (code_nodot)',
    'CREATE INDEX IF NOT EXISTS idx_icd10_category ON public.icd10_codes (category_code)',
    'CREATE INDEX IF NOT EXISTS idx_icd10_priority ON public.icd10_codes (is_priority) WHERE is_priority = true',
    'CREATE INDEX IF NOT EXISTS idx_icd10_search_vector ON public.icd10_codes USING GIN (search_vector)',
  ];
  for (const idx of indexes) {
    try { await db.query(idx); } catch (err) { console.error('Index creation failed:', err.message); }
  }
  // Trigram indexes depend on pg_trgm — created separately so their failure
  // (extension unavailable) doesn't take the b-tree/GIN indexes above with it.
  try {
    await db.query('CREATE INDEX IF NOT EXISTS idx_icd10_desc_trgm ON public.icd10_codes USING GIN (description gin_trgm_ops)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_icd10_code_trgm ON public.icd10_codes USING GIN (code gin_trgm_ops)');
  } catch (err) {
    console.error('⚠️  Trigram indexes skipped (pg_trgm unavailable):', err.message);
  }
}

/**
 * Loads the full code set. Idempotent — if `public.icd10_codes` already has
 * exactly the expected row count for this source+version, does nothing.
 * Returns { imported, skipped, total, mohRemaps }.
 */
async function importIcd10Codes(db = platformSequelize, { force = false } = {}) {
  const rows = parseOrderFile(ORDER_FILE);
  const codesFileCount = parseCodesFileCount(CODES_FILE);
  const billableCount = rows.filter((r) => r.isBillable).length;

  // The two CMS files must agree on what's billable — if they don't, the
  // parser or the source files themselves are wrong, and importing anyway
  // would silently seed incorrect is_billable flags.
  if (billableCount !== codesFileCount) {
    throw new Error(
      `ICD-10 import aborted: order file's billable count (${billableCount}) does not match the codes-only file's row count (${codesFileCount}) — refusing to seed inconsistent data.`
    );
  }
  if (rows.length < 70000) {
    throw new Error(`ICD-10 import aborted: parsed only ${rows.length} codes, expected well over 70,000 — source file looks truncated or malformed.`);
  }

  if (!force) {
    const [[existing]] = await db.query(
      `SELECT COUNT(*)::int AS count FROM public.icd10_codes WHERE source = :source AND version = :version`,
      { replacements: { source: SOURCE, version: VERSION } }
    );
    if (existing.count === rows.length) {
      console.log(`✅ icd10_codes already has all ${rows.length} ${SOURCE} ${VERSION} codes — skipping import.`);
      return { imported: 0, skipped: rows.length, total: rows.length, mohRemaps: [] };
    }
  }

  // category_code -> block description, from each category's own 3-char
  // header row (e.g. "A01" -> "Typhoid and paratyphoid fevers"). Left null
  // for the rare category with no standalone 3-char header row.
  const blockByCategory = new Map();
  for (const r of rows) {
    if (r.codeNoDot.length === 3) blockByCategory.set(r.codeNoDot, r.description);
  }

  // Which codes are MoH priority codes (src/data/mohDiagnoses.ts), with the
  // hand-verified WHO->CM remap applied for the 3 codes that don't exist in
  // CM as-is.
  const priorityCodes = new Set();
  const mohRemaps = [];
  for (const moh of MOH_DIAGNOSES) {
    const remap = MOH_CODE_REMAP[moh.icd10Code];
    const target = remap ? remap.to : moh.icd10Code;
    priorityCodes.add(normalizeCode(target));
    if (remap) mohRemaps.push({ mohCode: moh.icd10Code, mohName: moh.name, mappedTo: remap.to, reason: remap.reason });
  }

  const values = rows.map((r) => {
    const categoryCode = r.codeNoDot.slice(0, 3);
    return {
      code: r.code,
      code_nodot: r.codeNoDot,
      description: r.description,
      category_code: categoryCode,
      chapter: chapterForCategory(categoryCode),
      block: blockByCategory.get(categoryCode) || null,
      is_billable: r.isBillable,
      is_priority: priorityCodes.has(r.codeNoDot),
      source: SOURCE,
      version: VERSION,
    };
  });

  await db.query('DELETE FROM public.icd10_codes WHERE source = :source AND version = :version', { replacements: { source: SOURCE, version: VERSION } });

  const BATCH = 500;
  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH);
    const replacements = { sourceLit: SOURCE, versionLit: VERSION };
    const placeholders = batch.map((v, idx) => {
      replacements[`code${idx}`] = v.code;
      replacements[`codeNodot${idx}`] = v.code_nodot;
      replacements[`description${idx}`] = v.description;
      replacements[`categoryCode${idx}`] = v.category_code;
      replacements[`chapter${idx}`] = v.chapter;
      replacements[`block${idx}`] = v.block;
      replacements[`isBillable${idx}`] = v.is_billable;
      replacements[`isPriority${idx}`] = v.is_priority;
      return `(:code${idx}, :codeNodot${idx}, :description${idx}, :categoryCode${idx}, :chapter${idx}, :block${idx}, :isBillable${idx}, :isPriority${idx}, :sourceLit, :versionLit)`;
    }).join(',');
    await db.query(
      `INSERT INTO public.icd10_codes (code, code_nodot, description, category_code, chapter, block, is_billable, is_priority, source, version)
       VALUES ${placeholders}
       ON CONFLICT (code_nodot, source, version) DO UPDATE SET
         description = EXCLUDED.description, category_code = EXCLUDED.category_code,
         chapter = EXCLUDED.chapter, block = EXCLUDED.block, is_billable = EXCLUDED.is_billable,
         is_priority = EXCLUDED.is_priority, updated_at = NOW()`,
      { replacements }
    );
  }

  const [[after]] = await db.query(
    `SELECT COUNT(*)::int AS count FROM public.icd10_codes WHERE source = :source AND version = :version`,
    { replacements: { source: SOURCE, version: VERSION } }
  );
  if (after.count !== rows.length) {
    throw new Error(`ICD-10 import mismatch: expected ${rows.length} rows for ${SOURCE} ${VERSION}, table has ${after.count}.`);
  }

  console.log(`✅ Imported ${rows.length} ${SOURCE} ${VERSION} ICD-10 codes (${billableCount} billable, ${rows.length - billableCount} category headers).`);
  if (mohRemaps.length) {
    console.log(`ℹ️  ${mohRemaps.length} MoH priority code(s) remapped (WHO vs CM):`);
    mohRemaps.forEach((r) => console.log(`   ${r.mohCode} (${r.mohName}) -> ${r.mappedTo}: ${r.reason}`));
  }

  return { imported: rows.length, skipped: 0, total: rows.length, mohRemaps };
}

async function migrateAndImportIcd10(db = platformSequelize) {
  await migrateIcd10Table(db);
  return importIcd10Codes(db);
}

module.exports = { migrateIcd10Table, importIcd10Codes, migrateAndImportIcd10, SOURCE, VERSION, MOH_CODE_REMAP };

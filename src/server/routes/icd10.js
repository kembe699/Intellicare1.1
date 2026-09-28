// ICD-10 code search — reads the shared, cross-tenant `public.icd10_codes`
// table (see scripts/importIcd10.js for why it lives in `public` rather
// than a per-tenant table or a new schema) joined against this tenant's own
// `visit_diagnoses` for "recently/most used here" ranking. req.models'
// connection already has `public` on its search_path (see
// dbConnectionOptions.js), so one query safely reads both without ever
// touching another tenant's usage counts.
//
// Same auth as the existing /api/clinical-diagnoses endpoints: any
// authenticated user can search (matches the picker being open to whoever
// can already see the diagnosis list), no extra privilege beyond that.
//
// The actual query logic lives in standalone async functions (searchIcd10,
// getPriorityList, getRecentList) rather than inline in the route handlers,
// so tests can call them directly against a real connection — same pattern
// as reportDhis2.js's __testHelpers.
const express = require('express');
const router = express.Router();
const { ICD10_SYNONYMS } = require('../config/icd10Synonyms');
const { SOURCE, VERSION } = require('../scripts/importIcd10');

function normalizeCodeQuery(q) {
  return String(q || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Replaces known shorthand (whole words only) with its full phrase before
// the text search runs, e.g. "uti" -> "urinary tract infection". This must
// REPLACE rather than append the original word: plainto_tsquery ANDs every
// remaining lexeme together, and no ICD-10 description ever contains the
// literal abbreviation "uti" as a word, so keeping it alongside the
// expansion would make the whole query unmatchable. Order-of-words in the
// result doesn't matter to the tsquery that consumes it.
function expandSynonyms(text) {
  return String(text || '').replace(/[a-zA-Z]+/g, (word) => {
    const hit = ICD10_SYNONYMS[word.toLowerCase()];
    return hit ? hit.join(' ') : word;
  });
}

// "Common in South Sudan" — the MoH priority list, for the picker's default
// (empty-query) view.
async function getPriorityList(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT code, code_nodot, description, category_code, chapter, block, is_billable, is_priority
     FROM public.icd10_codes
     WHERE source = :source AND version = :version AND is_priority = true
     ORDER BY description ASC`,
    { replacements: { source: SOURCE, version: VERSION } }
  );
  return rows;
}

// "Recently used here" — this tenant's (optionally branch's) most-used codes.
async function getRecentList(sequelize, { branchId = null, limit = 10 } = {}) {
  const [rows] = await sequelize.query(
    `SELECT c.code, c.code_nodot, c.description, c.category_code, c.chapter, c.block, c.is_billable, c.is_priority,
            u.usage_count
     FROM (
       SELECT icd_code, COUNT(*)::int AS usage_count
       FROM visit_diagnoses
       WHERE icd_code IS NOT NULL AND deleted_at IS NULL ${branchId ? 'AND branch_id = :branchId' : ''}
       GROUP BY icd_code
       ORDER BY usage_count DESC
       LIMIT :limit
     ) u
     JOIN public.icd10_codes c ON c.code = u.icd_code AND c.source = :source AND c.version = :version`,
    { replacements: { source: SOURCE, version: VERSION, branchId, limit } }
  );
  return rows;
}

// The main typed-query search: code with/without dot, code prefix,
// description word-order-independent text search (+ synonym expansion),
// ranked exact-code > priority > tenant usage > prefix > billable > text
// relevance.
async function searchIcd10(sequelize, { q, limit = 30, branchId = null } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];

  const codeQuery = normalizeCodeQuery(query);
  const textQuery = expandSynonyms(query);

  const [rows] = await sequelize.query(
    `WITH usage AS (
       SELECT icd_code, COUNT(*)::int AS usage_count
       FROM visit_diagnoses
       WHERE icd_code IS NOT NULL AND deleted_at IS NULL
         ${branchId ? 'AND branch_id = :branchId' : ''}
       GROUP BY icd_code
     )
     SELECT c.code, c.code_nodot, c.description, c.category_code, c.chapter, c.block,
            c.is_billable, c.is_priority, COALESCE(u.usage_count, 0) AS usage_count
     FROM public.icd10_codes c
     LEFT JOIN usage u ON u.icd_code = c.code
     WHERE c.source = :source AND c.version = :version
       AND (
         (:codeQuery <> '' AND c.code_nodot ILIKE :codePrefix)
         OR c.search_vector @@ plainto_tsquery('english', :textQuery)
         OR c.description ILIKE :fuzzyLike
       )
     ORDER BY
       (c.code_nodot = :codeQuery) DESC,
       c.is_priority DESC,
       COALESCE(u.usage_count, 0) DESC,
       (:codeQuery <> '' AND c.code_nodot LIKE :codePrefix) DESC,
       c.is_billable DESC,
       ts_rank(c.search_vector, plainto_tsquery('english', :textQuery)) DESC,
       c.code_nodot ASC
     LIMIT :limit`,
    {
      replacements: {
        source: SOURCE, version: VERSION,
        codeQuery, codePrefix: `${codeQuery}%`,
        textQuery, fuzzyLike: `%${query}%`,
        branchId, limit,
      },
    }
  );
  return rows;
}

async function getIcd10ByCode(sequelize, code) {
  const codeNoDot = normalizeCodeQuery(code);
  const [[row]] = await sequelize.query(
    `SELECT code, code_nodot, description, category_code, chapter, block, is_billable, is_priority, source, version
     FROM public.icd10_codes WHERE code_nodot = :codeNoDot AND source = :source AND version = :version`,
    { replacements: { codeNoDot, source: SOURCE, version: VERSION } }
  );
  return row || null;
}

router.get('/priority', async (req, res) => {
  try {
    const results = await getPriorityList(req.models.sequelize);
    res.json({ results, source: SOURCE, version: VERSION });
  } catch (error) {
    console.error('ICD-10 priority list failed:', error);
    res.status(500).json({ error: 'Failed to load priority diagnoses' });
  }
});

router.get('/recent', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  try {
    const results = await getRecentList(req.models.sequelize, { branchId, limit });
    res.json({ results, source: SOURCE, version: VERSION });
  } catch (error) {
    console.error('ICD-10 recent list failed:', error);
    res.status(500).json({ error: 'Failed to load recently used diagnoses' });
  }
});

router.get('/search', async (req, res) => {
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  try {
    const results = await searchIcd10(req.models.sequelize, { q: req.query.q, limit, branchId });
    res.json({ results, source: SOURCE, version: VERSION });
  } catch (error) {
    console.error('ICD-10 search failed:', error);
    res.status(500).json({ error: 'ICD-10 search failed' });
  }
});

router.get('/:code', async (req, res) => {
  try {
    const row = await getIcd10ByCode(req.models.sequelize, req.params.code);
    if (!row) return res.status(404).json({ error: 'Code not found' });
    res.json(row);
  } catch (error) {
    console.error('ICD-10 lookup failed:', error);
    res.status(500).json({ error: 'ICD-10 lookup failed' });
  }
});

module.exports = router;

// Pure/async helpers exposed for unit + integration testing only — the
// routes above call these same functions directly.
module.exports.__testHelpers = {
  normalizeCodeQuery, expandSynonyms, searchIcd10, getPriorityList, getRecentList, getIcd10ByCode,
};

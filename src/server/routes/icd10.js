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

// Builds a prefix-matching tsquery string so search-as-you-type actually
// works: plainto_tsquery/websearch_to_tsquery require each word to be
// COMPLETE before it can match a stemmed lexeme, so typing "malar" (on the
// way to "malaria") matched nothing until the last letter landed. Every
// word but the last is used as-is; the last (possibly still-being-typed)
// word gets a `:*` prefix marker, matching any lexeme that starts with it.
// Words are split on anything non-alphanumeric, so the built string can
// only ever contain safe tokens, spaces, `&` and one trailing `:*` — never
// raw user input that could break tsquery syntax.
function buildPrefixTsQuery(text) {
  const words = String(text || '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(' & ');
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
  // Falls back to plainto_tsquery's own (non-prefix) parse of the text when
  // the query is nothing but punctuation — to_tsquery still needs SOME
  // syntactically valid string, and this keeps the ranking's ts_rank call
  // safe even in that edge case.
  const prefixTsQuery = buildPrefixTsQuery(textQuery);
  const tsQueryString = prefixTsQuery || textQuery.trim().split(/\s+/).filter(Boolean).join(' & ') || '';

  // Three independent, each-individually-index-backed branches, UNIONed
  // together, rather than one query with all three conditions OR'd in a
  // single WHERE. Postgres happily uses idx_icd10_code_nodot /
  // idx_icd10_search_vector / idx_icd10_desc_trgm for each condition ALONE
  // (~1-2ms each, confirmed via EXPLAIN ANALYZE), but once they're combined
  // with OR under the full multi-key ORDER BY (priority/usage/billable/
  // ts_rank) and the usage LEFT JOIN, the planner gives up on combining
  // three different index scans and falls back to a full sequential scan —
  // 140ms+ for a common word like "acute", which is exactly what made the
  // picker feel heavy. Each branch here stays simple enough to keep its own
  // index and its own small LIMIT, so the final re-rank below only ever
  // sorts a couple hundred candidate rows, not the whole matching set.
  const [rows] = await sequelize.query(
    `WITH usage AS (
       SELECT icd_code, COUNT(*)::int AS usage_count
       FROM visit_diagnoses
       WHERE icd_code IS NOT NULL AND deleted_at IS NULL
         ${branchId ? 'AND branch_id = :branchId' : ''}
       GROUP BY icd_code
     ),
     candidates AS (
       -- Split in two rather than one ORDER BY is_priority DESC, code_nodot
       -- pass: for a broad prefix (a bare "B" matches thousands of codes)
       -- sorting the whole matching set by is_priority first stops the
       -- pattern index from serving the LIMIT directly and forces a slow
       -- full sort. The priority-flagged half is tiny (~60 rows total
       -- across the whole table) and index-backed via idx_icd10_priority,
       -- so it's cheap regardless, and the plain half stays a fast
       -- straight-index-order scan.
       (SELECT code, code_nodot, description, category_code, chapter, block, is_billable, is_priority
        FROM public.icd10_codes
        WHERE source = :source AND version = :version AND :codeQuery <> '' AND code_nodot LIKE :codePrefix AND is_priority = true
        LIMIT 20)
       UNION
       (SELECT code, code_nodot, description, category_code, chapter, block, is_billable, is_priority
        FROM public.icd10_codes
        WHERE source = :source AND version = :version AND :codeQuery <> '' AND code_nodot LIKE :codePrefix
        ORDER BY code_nodot ASC
        LIMIT 50)
       UNION
       (SELECT code, code_nodot, description, category_code, chapter, block, is_billable, is_priority
        FROM public.icd10_codes
        WHERE source = :source AND version = :version AND :tsQueryString <> '' AND search_vector @@ to_tsquery('english', :tsQueryString)
        ORDER BY is_priority DESC, ts_rank(search_vector, to_tsquery('english', :tsQueryString)) DESC
        LIMIT 100)
       UNION
       (SELECT code, code_nodot, description, category_code, chapter, block, is_billable, is_priority
        FROM public.icd10_codes
        WHERE source = :source AND version = :version AND description ILIKE :fuzzyLike
        LIMIT 50)
     )
     SELECT c.code, c.code_nodot, c.description, c.category_code, c.chapter, c.block,
            c.is_billable, c.is_priority, COALESCE(u.usage_count, 0) AS usage_count
     FROM candidates c
     LEFT JOIN usage u ON u.icd_code = c.code
     ORDER BY
       (c.code_nodot = :codeQuery) DESC,
       c.is_priority DESC,
       COALESCE(u.usage_count, 0) DESC,
       (:codeQuery <> '' AND c.code_nodot LIKE :codePrefix) DESC,
       c.is_billable DESC,
       (CASE WHEN :tsQueryString <> '' THEN ts_rank(to_tsvector('english', c.description), to_tsquery('english', :tsQueryString)) ELSE 0 END) DESC,
       c.code_nodot ASC
     LIMIT :limit`,
    {
      replacements: {
        source: SOURCE, version: VERSION,
        codeQuery, codePrefix: `${codeQuery}%`,
        tsQueryString, fuzzyLike: `%${query}%`,
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
  normalizeCodeQuery, expandSynonyms, buildPrefixTsQuery, searchIcd10, getPriorityList, getRecentList, getIcd10ByCode,
};

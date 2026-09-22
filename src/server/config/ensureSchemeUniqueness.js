// Same bug shape as ensureInventoryItemCodeUniqueness.js / ensureDepartmentCodeUniqueness.js,
// applied to the 6 real unique indexes that exist across the scheme/insurance tables
// (patient_schemes, scheme_discounts, scheme_membership, scheme_negotiated_prices,
// scheme_product_pricing, scheme_service_pricing — see migrateSchemes.js, which is where
// these were originally declared as named UNIQUE constraints; on the live tenant schemas
// they actually landed as plain Sequelize-style unique indexes instead, e.g.
// `patient_schemes_clinic_id_scheme_code_idx` on (clinic_id, scheme_code)). Since clinic_id
// is always 1 in this schema-per-tenant app, every one of these constraints actually enforced
// uniqueness TENANT-WIDE, not per branch — Branch B could never register its own "NHIF" scheme
// code, its own patient/scheme membership pairing, or its own negotiated price number once
// Branch A had already used it. This widens each to also include branch_id.
//
// Unlike the item_code/department_code fix, the columns to widen aren't found via
// information_schema.table_constraints (these are plain unique INDEXES, not named
// constraints — table_constraints only reports the PRIMARY KEY for these tables), so this
// reads the real column list per unique index off the pg_index/pg_attribute catalogs
// instead, matched by exact column-order equality to the known "old" shape.
//
// Same idempotent, per-tenant self-migration shape as ensureInventoryItemCodeUniqueness.js —
// see tenantDb.js's buildTenantConnection for why this runs per tenant connection, after
// ensureBranchIsolationColumns has already added branch_id. Existing conflicting rows are
// checked for and logged rather than letting the index creation fail and crash tenant startup.
const TABLES = [
  { table: 'patient_schemes', oldCols: ['clinic_id', 'scheme_code'] },
  { table: 'scheme_discounts', oldCols: ['clinic_id', 'discount_code'] },
  { table: 'scheme_membership', oldCols: ['patient_id', 'scheme_id'] },
  { table: 'scheme_negotiated_prices', oldCols: ['clinic_id', 'negotiation_number'] },
  { table: 'scheme_product_pricing', oldCols: ['scheme_id', 'product_id', 'product_type', 'effective_from'] },
  { table: 'scheme_service_pricing', oldCols: ['scheme_id', 'service_id', 'effective_from'] },
];

const sameCols = (cols, expected) =>
  Array.isArray(cols) && cols.length === expected.length &&
  expected.every((c, i) => cols[i] === c);

async function getNonPrimaryUniqueIndexes(sequelize, table) {
  // string_agg + split, not array_agg — Sequelize's raw query path here doesn't run the
  // pg array-type parser on an array_agg() result, so it comes back as the literal string
  // "{clinic_id,scheme_code}" instead of a JS array, silently breaking every cols.length /
  // cols.every() comparison downstream (found by testing this exact query against a real
  // tenant connection — array_agg looked right in isolation but never actually matched).
  const [rows] = await sequelize.query(`
    SELECT ic.relname AS index_name,
           string_agg(a.attname, ',' ORDER BY x.n) AS cols
    FROM pg_index ix
    JOIN pg_class ic ON ic.oid = ix.indexrelid
    JOIN pg_class tc ON tc.oid = ix.indrelid
    JOIN pg_namespace ns ON ns.oid = tc.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true
    JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = x.attnum
    WHERE tc.relname = :table
      AND ns.nspname = current_schema()
      AND ix.indisunique = true
      AND ix.indisprimary = false
    GROUP BY ic.relname
  `, { replacements: { table } });
  return rows.map((r) => ({ index_name: r.index_name, cols: r.cols.split(',') }));
}

async function widenOne(sequelize, label, table, oldCols) {
  try {
    const [[tableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table`,
      { replacements: { table } }
    );
    if (Number(tableCheck.cnt) === 0) return;

    const [[colCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = 'branch_id'`,
      { replacements: { table } }
    );
    if (Number(colCheck.cnt) === 0) return; // branch_id migration hasn't reached this tenant yet

    // A plain `(…, branch_id)` unique index would silently stop catching conflicts for
    // every row where branch_id is NULL — Postgres never treats two NULLs as equal under a
    // unique index, so schemes.js's INSERT ... ON CONFLICT upserts (membership, service/
    // product pricing) would start creating duplicate rows instead of updating the existing
    // one, specifically for a multi-branch tenant's legacy rows (which stay NULL forever —
    // see backfillBranchIds's ambiguous-skip rule) touched by a request that itself resolves
    // to no branch (e.g. a legacy admin account predating the branch feature). Indexing on
    // COALESCE(branch_id, -1) instead makes NULL behave like a real, conflictable value —
    // the standard Postgres pattern for a nullable column inside a unique constraint that
    // must still work with ON CONFLICT. schemes.js's ON CONFLICT clauses target this same
    // COALESCE expression, not the bare column — the two must be kept in sync.
    const branchExpr = 'COALESCE(branch_id, -1)';
    const newCols = [...oldCols, branchExpr];
    const colList = newCols.join(', ');
    const newIndexName = `${table}_${[...oldCols, 'branch_id'].join('_')}_uidx`;

    // Check the ACTUAL definition, not just the name — an earlier version of this file
    // (before the COALESCE fix above existed) already created a same-named but plain
    // `(…, branch_id)` index on some tenants during testing; a name-only check would
    // mistake that wrong-shaped leftover for "already done" and never replace it.
    const [[existingByName]] = await sequelize.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = :table AND indexname = :idx`,
      { replacements: { table, idx: newIndexName } }
    );
    if (existingByName) {
      if (existingByName.indexdef.includes('COALESCE')) return; // already widened correctly by a prior run
      await sequelize.query(`DROP INDEX "${newIndexName}"`); // wrong-shaped leftover — replace it below
    }

    const indexes = await getNonPrimaryUniqueIndexes(sequelize, table);
    const oldMatches = indexes.filter((ix) => sameCols(ix.cols, oldCols));
    if (oldMatches.length === 0 && !existingByName) return; // nothing in the old shape left to widen

    // Conflict check against the SAME grouping the new index will enforce — NULL branch_id
    // rows collapse to -1 here too, so two legacy NULL-branch rows that already share
    // (oldCols) would conflict under COALESCE just as they would have under the old
    // constraint (which already guaranteed oldCols alone was unique tenant-wide); this
    // should therefore only ever fire for genuine pre-existing data problems, not as a
    // side effect of adding branch_id.
    const [conflicts] = await sequelize.query(`
      SELECT ${colList}, COUNT(*) AS cnt
      FROM ${table}
      GROUP BY ${colList}
      HAVING COUNT(*) > 1
    `);
    if (conflicts.length > 0) {
      console.warn(
        `⚠️  [${label}] Skipping ${table} (${colList}) uniqueness fix — ${conflicts.length} existing conflict(s). ` +
        `Resolve these duplicates manually, then this will apply on the next connection.`
      );
      return;
    }

    // Drop every index still in the old shape (handles duplicates from a prior double-sync
    // the same way — see services below); create exactly one widened replacement.
    for (const ix of oldMatches) {
      await sequelize.query(`DROP INDEX "${ix.index_name}"`);
    }
    await sequelize.query(`CREATE UNIQUE INDEX "${newIndexName}" ON ${table}(${colList})`);
    console.log(`✅ [${label}] ${table} uniqueness widened to (${colList})`);
  } catch (e) {
    console.warn(`[${label}] ${table} uniqueness migration warning:`, e.message);
  }
}

async function ensureSchemeUniqueness(sequelize, label = 'database') {
  for (const { table, oldCols } of TABLES) {
    await widenOne(sequelize, label, table, oldCols);
  }
}

module.exports = { ensureSchemeUniqueness };

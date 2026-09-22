/**
 * stock_locations has the identical bug shape as inventory_items/departments (see
 * ensureInventoryItemCodeUniqueness.js): a unique constraint on
 * (clinic_id, location_code) — migrateInventoryTables.js's `unique_clinic_location`
 * — which, since clinic_id is always 1 in this schema-per-tenant app, actually blocks
 * two different branches from ever using the same location_code, even a location
 * literally named the same thing ("Pharmacy") in each branch's own building. Widens
 * it to (clinic_id, branch_id, location_code).
 *
 * Same idempotent, per-tenant self-migration shape as
 * ensureInventoryItemCodeUniqueness.js — see tenantDb.js's buildTenantConnection for
 * why this runs per tenant connection. Looks at pg_index directly, not
 * information_schema.table_constraints, since the latter misses a bare
 * `CREATE UNIQUE INDEX` with no backing constraint — exactly the leftover shape
 * found (and fixed) on every production tenant for inventory_items/departments, so
 * this checks for it here from the start rather than repeating that lesson later.
 * Drops every old-shaped match found (named constraint or bare index), using
 * ALTER TABLE ... DROP CONSTRAINT for a named one (the only form Postgres accepts
 * for a constraint-backed index) or plain DROP INDEX for a bare one.
 */
async function getNonPrimaryUniqueIndexes(sequelize, table) {
  // string_agg + split, not array_agg — see ensureSchemeUniqueness.js's identical helper
  // for why: Sequelize's raw query path here never runs the pg array-type parser on an
  // array_agg() result, so it comes back as a literal string, not a JS array.
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

async function ensureStockLocationUniqueness(sequelize, label = 'database') {
  try {
    const [[tableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'stock_locations'`
    );
    if (Number(tableCheck.cnt) === 0) return;

    const [[colCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'stock_locations' AND column_name = 'branch_id'`
    );
    if (Number(colCheck.cnt) === 0) return; // branch_id migration hasn't reached this tenant yet

    const sameCols = (cols, expected) =>
      Array.isArray(cols) && cols.length === expected.length &&
      expected.every((c) => cols.includes(c));

    const indexes = await getNonPrimaryUniqueIndexes(sequelize, 'stock_locations');
    const oldMatches = indexes.filter((ix) => sameCols(ix.cols, ['clinic_id', 'location_code']));
    const alreadyWidened = indexes.some((ix) => sameCols(ix.cols, ['clinic_id', 'branch_id', 'location_code']));
    if (oldMatches.length === 0) return;

    const [conflicts] = await sequelize.query(`
      SELECT clinic_id, branch_id, location_code, COUNT(*) AS cnt
      FROM stock_locations
      WHERE branch_id IS NOT NULL
      GROUP BY clinic_id, branch_id, location_code
      HAVING COUNT(*) > 1
    `);
    if (conflicts.length > 0) {
      console.warn(
        `⚠️  [${label}] Skipping stock_locations (clinic_id, branch_id, location_code) uniqueness fix — ` +
        `${conflicts.length} existing location_code conflict(s) within the same branch. Resolve these duplicates manually, then this will apply on the next connection.`
      );
      return;
    }

    const [namedConstraints] = await sequelize.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = current_schema() AND table_name = 'stock_locations' AND constraint_type = 'UNIQUE'
    `);
    const constraintNames = new Set(namedConstraints.map((c) => c.constraint_name));
    for (const ix of oldMatches) {
      if (constraintNames.has(ix.index_name)) {
        await sequelize.query(`ALTER TABLE stock_locations DROP CONSTRAINT "${ix.index_name}"`);
      } else {
        await sequelize.query(`DROP INDEX "${ix.index_name}"`);
      }
    }
    if (!alreadyWidened) {
      await sequelize.query(`ALTER TABLE stock_locations ADD CONSTRAINT unique_clinic_branch_location UNIQUE (clinic_id, branch_id, location_code)`);
    }
    console.log(`✅ [${label}] stock_locations location_code uniqueness widened to (clinic_id, branch_id, location_code)`);
  } catch (e) {
    console.warn(`[${label}] stock_locations uniqueness migration warning:`, e.message);
  }
}

module.exports = { ensureStockLocationUniqueness };

// services.service_name currently carries TWO separate unique indexes (both plain
// btree UNIQUE, e.g. `services_service_name_idx` / `services_service_name_idx1` — a
// leftover of the table having been synced more than once against models/Service.js's
// `indexes: [{ fields: ['service_name'], unique: true }]`). Since clinic_id doesn't even
// exist on this table, either one alone already enforces service_name uniqueness
// TENANT-WIDE, not per branch — Branch B could never create its own "Consultation"
// service once Branch A had one. This widens both to include branch_id, collapsing the
// pair down to one surviving widened index in the process (keeping two indexes over the
// exact same widened column set would be pure redundant overhead with no added safety).
//
// Same idempotent, per-tenant self-migration shape as ensureSchemeUniqueness.js — see
// tenantDb.js's buildTenantConnection for why this runs per tenant connection, after
// ensureBranchIsolationColumns has already added branch_id. Existing conflicting rows
// are checked for and logged rather than letting the index creation fail and crash
// tenant startup.
const sameCols = (cols, expected) =>
  Array.isArray(cols) && cols.length === expected.length &&
  expected.every((c, i) => cols[i] === c);

async function getNonPrimaryUniqueIndexes(sequelize, table) {
  // string_agg + split, not array_agg — see ensureSchemeUniqueness.js's identical helper
  // for why: Sequelize's raw query path here never runs the pg array-type parser on an
  // array_agg() result, so it comes back as the literal string "{service_name}" instead
  // of a JS array, silently breaking every cols.length / cols.every() comparison downstream.
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

async function ensureServiceNameUniqueness(sequelize, label = 'database') {
  try {
    const [[tableCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'services'`
    );
    if (Number(tableCheck.cnt) === 0) return;

    const [[colCheck]] = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'services' AND column_name = 'branch_id'`
    );
    if (Number(colCheck.cnt) === 0) return; // branch_id migration hasn't reached this tenant yet

    const oldCols = ['service_name'];
    const newCols = ['service_name', 'branch_id'];
    const indexes = await getNonPrimaryUniqueIndexes(sequelize, 'services');

    const alreadyWidened = indexes.some((ix) => sameCols(ix.cols, newCols));
    const oldMatches = indexes.filter((ix) => sameCols(ix.cols, oldCols));
    if (oldMatches.length === 0) return; // nothing in the old shape left to widen (or already fixed)

    const [conflicts] = await sequelize.query(`
      SELECT service_name, branch_id, COUNT(*) AS cnt
      FROM services
      WHERE branch_id IS NOT NULL
      GROUP BY service_name, branch_id
      HAVING COUNT(*) > 1
    `);
    if (conflicts.length > 0) {
      console.warn(
        `⚠️  [${label}] Skipping services (service_name, branch_id) uniqueness fix — ` +
        `${conflicts.length} existing service_name conflict(s) within the same branch (e.g. branch ${conflicts[0].branch_id}, ` +
        `"${conflicts[0].service_name}"). Resolve these duplicates manually, then this will apply on the next connection.`
      );
      return;
    }

    let created = alreadyWidened;
    for (const ix of oldMatches) {
      await sequelize.query(`DROP INDEX "${ix.index_name}"`);
      if (!created) {
        await sequelize.query(`CREATE UNIQUE INDEX "services_service_name_branch_id_uidx" ON services(service_name, branch_id)`);
        created = true;
      }
    }
    console.log(`✅ [${label}] services service_name uniqueness widened to (service_name, branch_id) — collapsed ${oldMatches.length} duplicate index(es) into one`);
  } catch (e) {
    console.warn(`[${label}] services uniqueness migration warning:`, e.message);
  }
}

module.exports = { ensureServiceNameUniqueness };

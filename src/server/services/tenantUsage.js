// Measures each tenant's actual MySQL database size from
// information_schema.tables — a real measurement (row/index bytes MySQL is
// actually storing), not an estimate. information_schema is a virtual,
// server-wide catalog, so this reads it through the platform's own
// connection scoped to the tenant's db_name — no per-tenant connection
// needed just to ask "how big is this database."
const { Client, DbUsageSnapshot } = require('../models/platform');
const { getTenantConnection } = require('../tenantDb');

// Every tenant clones the same ~204-table schema, and most of those tables
// stay empty — InnoDB's fixed per-table page overhead dominates the total
// size regardless of real usage, which is why every client reports nearly
// the same total (~8MB) no matter how much data they've actually entered.
// Row counts on the tables that actually accumulate tenant activity are the
// honest "how much have they used this" signal instead — grouped by module
// so it reads as a report, not a raw table dump. Catalog/reference tables
// (chart_of_accounts, lab_tests, etc.) are deliberately excluded — those get
// seeded identically for every tenant, they're not something a client "enters."
const USAGE_CATEGORIES = [
  { label: 'Patients', table: 'patients' },
  { label: 'Visits', table: 'visits' },
  { label: 'Patient Bills', table: 'patient_bills' },
  { label: 'Invoices', table: 'invoices' },
  { label: 'Receipts', table: 'receipts' },
  { label: 'Lab Requests', table: 'lab_requests' },
  { label: 'Lab Results', table: 'lab_results' },
  { label: 'Prescriptions', table: 'pharmacy_prescriptions' },
  { label: 'Dispensing Records', table: 'dispensing_records' },
  { label: 'Purchase Orders', table: 'purchase_orders' },
  { label: 'Journal Entries', table: 'journal_entries' },
  { label: 'Staff Accounts', table: 'users' },
];

async function getDataBreakdown(client) {
  const { sequelize: tenantSequelize } = await getTenantConnection(client.db_name);

  const results = await Promise.all(USAGE_CATEGORIES.map(async ({ label, table }) => {
    try {
      const [[row]] = await tenantSequelize.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
      return { label, table, count: Number(row.count) };
    } catch (err) {
      // Table missing on an older/newer schema variant — report 0 rather
      // than fail the whole breakdown over one category.
      return { label, table, count: 0 };
    }
  }));

  return results;
}

async function measureDbSize(dbName) {
  // Queried through the tenant's own connection, not the platform's shared
  // one — information_schema only shows a MySQL user the databases it
  // actually has privileges on, and on hosts where every database has its
  // own dedicated user (e.g. Hostinger shared hosting), the platform user
  // can't see a tenant's information_schema rows at all.
  const { sequelize: tenantSequelize } = await getTenantConnection(dbName);
  const [[row]] = await tenantSequelize.query(
    `SELECT
       COALESCE(SUM(data_length + index_length), 0) AS size_bytes,
       COUNT(*) AS table_count
     FROM information_schema.tables
     WHERE table_schema = :dbName`,
    { replacements: { dbName } }
  );
  return { sizeBytes: Number(row.size_bytes), tableCount: Number(row.table_count) };
}

async function recordSnapshotForClient(client) {
  const { sizeBytes, tableCount } = await measureDbSize(client.db_name);
  return DbUsageSnapshot.create({
    client_id: client.id,
    size_bytes: sizeBytes,
    table_count: tableCount,
    recorded_at: new Date(),
  });
}

// Runs periodically (see index.js) and once at boot — one snapshot per
// client per run, so the growth chart accumulates real history over time
// instead of only ever showing a single current-size number.
async function recordSnapshotsForAllClients() {
  const clients = await Client.findAll();
  let recorded = 0;
  for (const client of clients) {
    try {
      await recordSnapshotForClient(client);
      recorded += 1;
    } catch (err) {
      console.error(`DB usage snapshot failed for client ${client.id} (${client.code}):`, err.message);
    }
  }
  return { recorded, total: clients.length };
}

module.exports = { measureDbSize, recordSnapshotForClient, recordSnapshotsForAllClients, getDataBreakdown };

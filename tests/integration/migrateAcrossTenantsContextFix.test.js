/**
 * Performance/correctness audit finding: 13 of this codebase's ~18
 * migration scripts (Accounting, CashTransfers, Procurement, Inventory,
 * Pharmacy, Billing, Schemes, Invoices, InsuranceClaims, MultiCurrency,
 * Inpatient, Radiology, Dhis2Report, Departments) are written in this
 * codebase's dominant style — `const { sequelize } = require('../models')`
 * at the top of the file, used directly, with no `db` parameter threaded
 * through — and were called from runBackgroundMigrations() with no
 * connection argument at all. Exactly the same bug already found and fixed
 * this session for addPerformanceIndexes.js/migrateTheatreTables.js/etc:
 * with no argument, require('../models')'s tenant-aware proxy
 * (models/index.js) falls back to the hardcoded tenant_template default
 * outside a request context, so these migrations never reached any
 * already-provisioned real tenant.
 *
 * Fixed in migrateAcrossTenants.js itself (not in each of the 13 scripts):
 * it now runs migrationFn inside tenantContext.run(), the same
 * AsyncLocalStorage mechanism every request handler already relies on —
 * closing the gap for any migration function regardless of whether it
 * personally accepts/uses a `db` parameter.
 */
const tenantContext = require('../../src/server/tenantContext');
const { getTenantConnection } = require('../../src/server/tenantDb');

const TEST_SCHEMA = process.env.DB_SCHEMA || 'tenant_test';

describe('migrateAcrossTenants makes a plain require(\'../models\')-style migration target the real tenant', () => {
  test('a migration function with no db parameter still runs against the passed schema, not tenant_template', async () => {
    const { migrateAcrossTenants } = require('../../src/server/scripts/migrateAcrossTenants');

    // Mirrors the 13 affected scripts' own style exactly: no parameter,
    // resolves sequelize from the top-level models import.
    const resolvedSchemas = [];
    async function migrationWithNoDbParam() {
      const { sequelize } = require('../../src/server/models');
      const [[row]] = await sequelize.query('SELECT current_schema() AS schema');
      resolvedSchemas.push(row.schema);
    }

    // Limit this run to just tenant_test by stubbing out the client list —
    // migrateAcrossTenants always includes 'tenant_template' plus every
    // schema_name from the Client model; faking that model keeps this test
    // from touching any other real tenant schema.
    jest.resetModules();
    jest.doMock('../../src/server/models/platform', () => ({
      Client: { findAll: async () => [{ schema_name: TEST_SCHEMA }] },
    }));
    const { migrateAcrossTenants: isolatedMigrateAcrossTenants } = require('../../src/server/scripts/migrateAcrossTenants');
    await isolatedMigrateAcrossTenants(migrationWithNoDbParam, 'Test');
    jest.dontMock('../../src/server/models/platform');
    jest.resetModules();

    // migrateAcrossTenants always includes 'tenant_template' itself in its
    // schema list by design (so a brand-new tenant cloned from it inherits
    // the migration too) — the point being tested here is that TEST_SCHEMA
    // is ALSO correctly reached, proving the ambient tenantContext resolved
    // require('../models')'s sequelize to the real tenant, not just ever
    // landing on the default.
    expect(resolvedSchemas).toContain(TEST_SCHEMA);
    expect(resolvedSchemas).toContain('tenant_template');
  });
});

describe('index.js wires every real per-tenant migration script through migrateAcrossTenants', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/server/index.js'), 'utf8');
  const migrationsBlock = src.slice(src.indexOf('const migrations = ['), src.indexOf('for (const [label, migrate] of migrations)'));

  const PREVIOUSLY_UNWRAPPED = [
    'Accounting', 'CashTransfers', 'Procurement', 'Inventory', 'Pharmacy', 'Billing',
    'Schemes', 'Invoices', 'InsuranceClaims', 'MultiCurrency', 'Inpatient', 'Radiology',
    'Dhis2Report', 'Departments',
  ];

  test.each(PREVIOUSLY_UNWRAPPED)('%s is wrapped in migrateAcrossTenants', (label) => {
    const entryStart = migrationsBlock.indexOf(`['${label}',`);
    expect(entryStart).toBeGreaterThan(-1);
    const entryEnd = migrationsBlock.indexOf(')],', entryStart) + 3;
    const entry = migrationsBlock.slice(entryStart, entryEnd);
    expect(entry).toMatch(/migrateAcrossTenants\(/);
  });

  // Confirmed a shared, single reference table (its own default param is
  // platformSequelize, not a tenant connection) — looping it per-tenant
  // would be wrong, not just redundant, so it must stay unwrapped.
  test('Icd10Reference is deliberately NOT wrapped — it is a shared platform reference table', () => {
    const entryStart = migrationsBlock.indexOf("['Icd10Reference',");
    expect(entryStart).toBeGreaterThan(-1);
    const entryEnd = migrationsBlock.indexOf('],', entryStart) + 2;
    const entry = migrationsBlock.slice(entryStart, entryEnd);
    expect(entry).not.toMatch(/migrateAcrossTenants\(/);
  });
});

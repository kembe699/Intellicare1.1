/**
 * Live-DB check that reconcileRolePrivileges.js actually produces what
 * permissionsCatalog.js promises, against a real schema — the static tests
 * in tests/integrity/ can prove the catalog is internally consistent, but
 * only a real database can prove the seed lands correctly and that
 * authorize()'s admin bypass genuinely never touches the DB.
 *
 * Runs against tenant_test only (see tests/setup/testDb.js) — never a real
 * tenant.
 */
const { getSequelize, query, closeConnection } = require('../setup/testDb');
const { reconcileOnConnection } = require('../../src/server/scripts/reconcileRolePrivileges');
const { PRIVILEGES, DEFAULT_ROLE_PRIVILEGES } = require('../../src/server/config/permissionsCatalog');
const { authorize } = require('../../src/server/middleware/authorize');

beforeAll(async () => {
  await reconcileOnConnection(getSequelize(), { apply: true, label: 'tenant_test' });
});

afterAll(async () => {
  await query(`DELETE FROM roles WHERE role_key = 'smoke_test_role'`);
  await closeConnection();
});

describe('reconcileRolePrivileges seeds exactly what the catalog says', () => {
  test('every catalog key grants exactly its DEFAULT_ROLE_PRIVILEGES role set — no more, no less', async () => {
    const mismatches = [];
    for (const p of PRIVILEGES) {
      const expected = new Set(DEFAULT_ROLE_PRIVILEGES[p.privilege_key] || []);
      const rows = await query(
        `SELECT r.role_key
           FROM role_privileges rp
           JOIN roles r ON r.id = rp.role_id
           JOIN privileges pr ON pr.id = rp.privilege_id
          WHERE pr.privilege_key = :key`,
        { key: p.privilege_key }
      );
      const actual = new Set(rows.map((r) => r.role_key));
      const missing = [...expected].filter((r) => !actual.has(r));   // lockout regression
      const extra = [...actual].filter((r) => !expected.has(r));     // privilege-escalation regression
      if (missing.length || extra.length) mismatches.push({ key: p.privilege_key, missing, extra });
    }
    expect(mismatches).toEqual([]);
  });

  test('the old page_*/approval_* catalog is gone', async () => {
    const rows = await query(`SELECT privilege_key FROM privileges WHERE privilege_key LIKE 'page\\_%' OR privilege_key LIKE 'approval\\_%'`);
    expect(rows).toEqual([]);
  });
});

describe("authorize()'s admin bypass never touches the database", () => {
  test('admin passes through with no req.models/tenantSchema set at all', async () => {
    const req = { user: { role: 'admin' } }; // deliberately no models/tenantSchema
    let calledNext = false;
    const res = { status: () => ({ json: () => {} }) };
    await authorize('billing.write')(req, res, () => { calledNext = true; });
    expect(calledNext).toBe(true);
  });

  test('a non-admin role with no matching grant is rejected, not silently allowed', async () => {
    const req = { user: { role: 'nonexistent_role_xyz' }, models: { sequelize: getSequelize() }, tenantSchema: 'tenant_test' };
    let statusCode = null;
    const res = { status: (c) => { statusCode = c; return { json: () => {} }; } };
    let calledNext = false;
    await authorize('billing.write')(req, res, () => { calledNext = true; });
    expect(calledNext).toBe(false);
    expect(statusCode).toBe(403);
  });
});

describe('the id-sequence fixup actually closes the collision bug', () => {
  test('a fresh custom role insert with no explicit id succeeds after reconciliation', async () => {
    await expect(
      query(`INSERT INTO roles (role_key, name, description, is_system) VALUES ('smoke_test_role', 'Smoke Test', NULL, FALSE)`)
    ).resolves.toBeDefined();
  });
});

describe('additional roles combine with the primary role, they do not replace it', () => {
  test('user_additional_roles table exists', async () => {
    const rows = await query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'user_additional_roles'`);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('a privilege only the additional role grants is allowed (array shape)', async () => {
    // 'lab' cannot approve inventory adjustments; 'procurement' can — pull the
    // real grant from the catalog rather than hardcoding a role list here, so
    // this doesn't rot if the catalog changes.
    const key = 'inventory.adjustments.approve';
    expect(DEFAULT_ROLE_PRIVILEGES[key]).toContain('procurement');
    expect(DEFAULT_ROLE_PRIVILEGES[key]).not.toContain('lab');

    const req = { user: { role: 'lab', additionalRoles: ['procurement'] }, models: { sequelize: getSequelize() }, tenantSchema: 'tenant_test' };
    let calledNext = false;
    const res = { status: () => ({ json: () => {} }) };
    await authorize(key)(req, res, () => { calledNext = true; });
    expect(calledNext).toBe(true);
  });

  test('neither role granting it is still rejected — union does not mean "allow everything"', async () => {
    const req = { user: { role: 'lab', additionalRoles: ['nurse'] }, models: { sequelize: getSequelize() }, tenantSchema: 'tenant_test' };
    let statusCode = null;
    const res = { status: (c) => { statusCode = c; return { json: () => {} }; } };
    let calledNext = false;
    await authorize('inventory.adjustments.approve')(req, res, () => { calledNext = true; });
    expect(calledNext).toBe(false);
    expect(statusCode).toBe(403);
  });

  test('a hardcoded literal-array gate also honors an additional role', async () => {
    const req = { user: { role: 'lab', additionalRoles: ['procurement'] } };
    let calledNext = false;
    const res = { status: () => ({ json: () => {} }) };
    await authorize(['admin', 'procurement'])(req, res, () => { calledNext = true; });
    expect(calledNext).toBe(true);
  });
});

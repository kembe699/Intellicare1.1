/**
 * Every authorize('some.key') call site across the route files must
 * reference a key that actually exists in the catalog — a typo here used to
 * mean a silent, permanent 403 in production for a role that should have
 * access (there's no DB row to grant, so the lookup always misses), rather
 * than a loud failure at review time.
 */
const fs = require('fs');
const path = require('path');
const { PRIVILEGES, DEFAULT_ROLE_PRIVILEGES, SYSTEM_ROLES } = require('../../src/server/config/permissionsCatalog');

const ROUTES_DIR = path.resolve(__dirname, '../../src/server/routes');

function allPrivilegeKeyCallSites() {
  const sites = [];
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const re = /authorize\('([\w.]+)'\)/g;
    let m;
    while ((m = re.exec(src))) sites.push({ file, key: m[1] });
  }
  return sites;
}

describe('permissionsCatalog is internally consistent', () => {
  test('no duplicate privilege keys', () => {
    const keys = PRIVILEGES.map((p) => p.privilege_key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  test('no duplicate role keys', () => {
    const keys = SYSTEM_ROLES.map((r) => r.role_key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  test('every DEFAULT_ROLE_PRIVILEGES entry only names real roles', () => {
    const validRoles = new Set(SYSTEM_ROLES.map((r) => r.role_key));
    const bad = [];
    for (const [key, roles] of Object.entries(DEFAULT_ROLE_PRIVILEGES)) {
      for (const r of roles) if (!validRoles.has(r)) bad.push(`${key}:${r}`);
    }
    expect(bad).toEqual([]);
  });

  test('every DEFAULT_ROLE_PRIVILEGES key has a matching catalog entry', () => {
    const validKeys = new Set(PRIVILEGES.map((p) => p.privilege_key));
    const orphaned = Object.keys(DEFAULT_ROLE_PRIVILEGES).filter((k) => !validKeys.has(k));
    expect(orphaned).toEqual([]);
  });
});

describe('every dynamic authorize() call site references a real privilege', () => {
  const sites = allPrivilegeKeyCallSites();
  const validKeys = new Set(PRIVILEGES.map((p) => p.privilege_key));

  test('at least one route actually uses the new authorize(\'key\') form', () => {
    // A sanity check on the extraction itself — if this ever drops to 0, the
    // regex above stopped matching real call sites and every test below
    // would pass vacuously.
    expect(sites.length).toBeGreaterThan(50);
  });

  test('no call site references an unknown privilege key', () => {
    const unknown = sites.filter((s) => !validKeys.has(s.key)).map((s) => `${s.file}: ${s.key}`);
    expect(unknown).toEqual([]);
  });
});

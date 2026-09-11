/**
 * Every privilege key referenced by App.tsx's requiredPrivilege prop or
 * Sidebar.tsx's privilege field must exist in the real catalog — a typo here
 * means a page nobody can ever see (a silent, permanent redirect loop away
 * from that route), not a loud failure at review time.
 */
const fs = require('fs');
const path = require('path');
const { PRIVILEGES } = require('../../src/server/config/permissionsCatalog');

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const validKeys = new Set(PRIVILEGES.map((p) => p.privilege_key));

// App.tsx uses JSX prop syntax (requiredPrivilege="key" / ={['a','b']}),
// Sidebar.tsx uses object-literal syntax (privilege: 'key' / : ['a','b']) —
// `[=:]` matches either.
function extractKeys(src, propName) {
  const keys = [];
  const re = new RegExp(`${propName}\\s*[=:]\\s*\\{?\\s*(?:"([\\w.]+)"|'([\\w.]+)'|\\[([^\\]]*)\\])`, 'g');
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) keys.push(m[1]);
    else if (m[2]) keys.push(m[2]);
    else keys.push(...[...m[3].matchAll(/'([^']+)'/g)].map((r) => r[1]));
  }
  return keys;
}

describe('frontend privilege references are all real', () => {
  test('App.tsx: at least one requiredPrivilege is actually extracted', () => {
    const keys = extractKeys(read('src/App.tsx'), 'requiredPrivilege');
    expect(keys.length).toBeGreaterThan(40);
  });

  test('App.tsx: every requiredPrivilege key exists in the catalog', () => {
    const keys = extractKeys(read('src/App.tsx'), 'requiredPrivilege');
    const unknown = keys.filter((k) => !validKeys.has(k));
    expect(unknown).toEqual([]);
  });

  test('Sidebar.tsx: at least one privilege is actually extracted', () => {
    const keys = extractKeys(read('src/components/layout/Sidebar.tsx'), 'privilege');
    expect(keys.length).toBeGreaterThan(40);
  });

  test('Sidebar.tsx: every privilege key exists in the catalog', () => {
    const keys = extractKeys(read('src/components/layout/Sidebar.tsx'), 'privilege');
    const unknown = keys.filter((k) => !validKeys.has(k));
    expect(unknown).toEqual([]);
  });
});

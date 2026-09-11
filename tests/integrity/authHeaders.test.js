/**
 * A request must not hand-roll the header authFetch already sets.
 *
 * authFetch attaches the session token, reading it from 'auth_token'. A caller
 * that sets its own Authorization header overrides that — and the one that did
 * read 'token', a key nothing writes. It sent "Bearer null" on every attempt, so
 * changing a password always answered 401 and the form reported the session had
 * expired on a session that was perfectly valid.
 *
 * Nothing about that is visible in either file alone: authFetch looks correct,
 * and the caller looks like it is being careful.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
  };
  walk(dir);
  return out;
}

describe('the session token is read from one place', () => {
  test("nothing reads localStorage 'token' — the key is 'auth_token'", () => {
    const offenders = sourceFiles('src')
      .filter((f) => /localStorage\.getItem\(\s*['"]token['"]\s*\)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test('authFetch still reads the key everything else writes', () => {
    // If this key ever changes, the check above is testing the wrong name.
    const client = read('src/api/apiClient.ts');
    expect(client).toMatch(/localStorage\.getItem\(['"]auth_token['"]\)/);
  });

});

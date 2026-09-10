/**
 * Connections must be given back.
 *
 * A transaction that is opened and then escaped without commit or rollback holds
 * its connection until the process dies. The pool is small and shared, so a leak
 * on a common path drains it within a few requests, and the failure lands
 * somewhere else entirely: billing still wrote the bill, then could not get a
 * connection to post the matching ledger entry, so the income statement quietly
 * reported less than the cashier had taken. Nothing errored to the user.
 *
 * That is exactly what postGLEntry did — it returned early when an entry was
 * already posted, out of an open transaction, on the path every bill takes.
 *
 * These are source-level checks rather than runtime ones because the damage is
 * cumulative and invisible in a single request: one leak looks like a healthy
 * response. Reviewing the shape is what catches it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../src/server');
const DIRS = ['routes', 'services', 'utils'];

function sourceFiles() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

/**
 * Find unmanaged transactions (`const t = await sequelize.transaction()`) that
 * can be escaped by a `return` before `t.commit()` or `t.rollback()` runs.
 * The callback form is not scanned: Sequelize settles that one itself.
 */
function findEscapingReturns(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const found = [];

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/(?:const|let)\s+(\w+)\s*=\s*await\s+[\w.]*sequelize\.transaction\(\s*\)/);
    if (!open) continue;

    const varName = open[1];
    const openIndent = lines[i].length - lines[i].trimStart().length;

    for (let j = i + 1; j < Math.min(i + 260, lines.length); j++) {
      const line = lines[j];
      const trimmed = line.trim();
      const indent = line.length - line.trimStart().length;

      if (new RegExp(`\\b${varName}\\.(commit|rollback)\\(`).test(line)) break;
      if (/^}\s*$/.test(line) && indent <= openIndent) break;

      if (/^return\b/.test(trimmed) && indent > openIndent) {
        found.push({
          file: path.relative(ROOT, file),
          openedAt: i + 1,
          returnedAt: j + 1,
          variable: varName,
          code: trimmed.slice(0, 80),
        });
        break;
      }
    }
  }
  return found;
}

describe('database connections are always released', () => {
  test('no transaction is escaped by a return before it is settled', () => {
    const leaks = sourceFiles().flatMap(findEscapingReturns);

    const report = leaks
      .map((l) => `  ${l.file}:${l.returnedAt} — transaction '${l.variable}' opened at line ${l.openedAt} is still open at: ${l.code}`)
      .join('\n');

    expect(leaks.length === 0 ? '' : `\nTransaction(s) returned without commit or rollback:\n${report}\n`).toBe('');
  });

  test('the scanner actually detects the shape it is meant to catch', () => {
    // Guards the guard: a regex that silently stops matching would turn this
    // whole file into a test that always passes.
    const tmp = path.join(ROOT, 'utils', '__leak_probe__.js');
    fs.writeFileSync(tmp, [
      'async function bad() {',
      '  const t = await sequelize.transaction();',
      '  const row = await Thing.findByPk(1);',
      '  if (row.done) {',
      '    return row;',
      '  }',
      '  await t.commit();',
      '}',
    ].join('\n'));
    try {
      const found = findEscapingReturns(tmp);
      expect(found).toHaveLength(1);
      expect(found[0].variable).toBe('t');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

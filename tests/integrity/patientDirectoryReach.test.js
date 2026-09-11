/**
 * Every registered person must be selectable.
 *
 * The patient pickers fetch the directory once, with no search term, and filter
 * what comes back in the browser. The participants endpoint capped that fetch at
 * 200 rows ordered newest-first — so on a tenant with 347 people registered
 * through the LIS, and none in the patient registry, the 147 oldest could not be
 * chosen on any screen. The picker said "No matching patients" about someone who
 * was plainly registered, which reads as a broken page rather than a limit.
 *
 * The same endpoint matched with LIKE, which on PostgreSQL is case-sensitive:
 * searching "james" found nothing for "James".
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('the patient directory can reach every patient', () => {
  const lis = read('src/server/routes/lisModule.js');
  const participants = lis.slice(lis.indexOf("router.get('/participants'"), lis.indexOf("router.put('/participants/:id'"));

  test('the participants list is not capped at a few hundred rows', () => {
    const cap = participants.match(/LIMIT \$\{LIMIT\}|LIMIT (\d+)/);
    expect(cap).toBeTruthy();
    if (cap[1]) expect(Number(cap[1])).toBeGreaterThanOrEqual(2000);
    else expect(participants).toMatch(/LIS_PARTICIPANT_LIMIT \|\| '(\d{4,})'/);
  });

  test('searching is case-insensitive', () => {
    // PostgreSQL's LIKE is case-sensitive; MySQL's is not. This query was
    // written for MySQL.
    expect(participants).toMatch(/ILIKE/);
    expect(participants).not.toMatch(/first_name LIKE/);
  });

  test('the directory reads both registries, so an empty one is not fatal', () => {
    // nation keeps everyone in lis_participants and nothing in patients; a
    // picker that read only the registry would show nobody at all.
    const directory = read('src/lib/patientDirectory.ts');
    expect(directory).toMatch(/\/api\/patients/);
    expect(directory).toMatch(/\/api\/lis\/participants/);
  });

  test('a registry that cannot be read is reported, not silently dropped', () => {
    const directory = read('src/lib/patientDirectory.ts');
    expect(directory).toMatch(/failed\.push/);
  });
});

// Enrolling a patient in a scheme at registration needs only the narrow schemes.enroll_patient
// (front desk), not schemes.write (managing schemes). Reception, nurse and cashier hold it by
// default; roles that already register patients get it too; reception still cannot manage schemes.
import { AFTER, call, q, done, newPatient, tokenFor, check, summary } from './lib.mjs';

const holders = async (key) => (await q(`SELECT r.role_key FROM role_privileges rp JOIN roles r ON r.id = rp.role_id
  JOIN privileges p ON p.id = rp.privilege_id WHERE p.privilege_key = $1 ORDER BY 1`, [key])).map((r) => r.role_key);
// The server reads a user's role from the users table, so each role needs a real user;
// roles the preview tenant has no user for get a throwaway one (removed at the end).
const made = [];
const users = {};
async function userFor(role) {
  if (users[role]) return users[role];
  let [u] = await q('SELECT id, email FROM users WHERE role = $1 AND is_active IS NOT FALSE ORDER BY id LIMIT 1', [role]);
  if (!u) {
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users'
                           AND column_name NOT IN ('id', 'email', 'role', 'username')`)).map((r) => `"${r.column_name}"`).join(', ');
    const hasUsername = (await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'username'`)).length > 0;
    [u] = await q(`INSERT INTO users (email, role${hasUsername ? ', username' : ''}, ${cols})
                   SELECT $1, $2${hasUsername ? ', $1' : ''}, ${cols} FROM users WHERE role = 'cashier' ORDER BY id LIMIT 1 RETURNING id, email`, [`t28-${role}@preview.local`, role]);
    made.push(u.id);
  }
  return (users[role] = u);
}
const as = async (role) => { const u = await userFor(role); return tokenFor({ userId: u.id, role, email: u.email }); };

const enroll = await holders('schemes.enroll_patient');
const registers = await holders('pages.lis_registration.view');
check('schemes.enroll_patient exists and is held by reception, nurse, cashier',
  ['reception', 'nurse', 'cashier'].every((r) => enroll.includes(r)), JSON.stringify(enroll));
check('…and by every role that can open patient registration', registers.every((r) => enroll.includes(r)), JSON.stringify({ registers, enroll }));
check('reception still does not hold schemes.write', !(await holders('schemes.write')).includes('reception'));

const code = `T28${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
const sch = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code, scheme_name: `T28 ${code}`, scheme_type: 'corporate', currency: 'SSP' });
const schemeId = sch.body.id || sch.body.data?.id || (await q('SELECT id FROM patient_schemes WHERE scheme_code = $1', [code]))[0].id;

for (const role of ['reception', 'nurse', 'cashier']) {
  const pt = await newPatient(AFTER, 'T28');
  const r = await call(AFTER, 'POST', `/schemes/patient-schemes/${pt.id}`, { scheme_id: schemeId, clinic_id: 1, member_number: `T28-${role}` }, await as(role));
  const [m] = await q('SELECT member_number FROM scheme_membership WHERE patient_id::text = $1 AND scheme_id::text = $2', [String(pt.id), String(schemeId)]);
  check(`${role} can enrol a patient at registration`, r.ok && m?.member_number === `T28-${role}`, JSON.stringify({ s: r.status, e: r.body?.error }));
}
const ptP = await newPatient(AFTER, 'T28');
const refused = await call(AFTER, 'POST', `/schemes/patient-schemes/${ptP.id}`, { scheme_id: schemeId, clinic_id: 1 }, await as('pharmacy'));
check('pharmacy (no registration, no scheme rights) is refused', refused.status === 403, String(refused.status));
const crud = await call(AFTER, 'POST', '/schemes', { clinic_id: 1, scheme_code: code + 'X', scheme_name: 'T28 X', currency: 'SSP' }, await as('reception'));
check('reception still cannot create a scheme', crud.status === 403, String(crud.status));

for (const id of made) await q('DELETE FROM users WHERE id = $1', [id]);
await done();
process.exit(summary() ? 1 : 0);

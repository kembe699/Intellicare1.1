/**
 * When a new privilege splits an action out of an existing one (e.g. "cancel
 * a bill" out of "delete bills", "pay an expense" out of "manage expenses"),
 * every role that can do the action today must keep being able to on day
 * one. Copies the grants once per tenant — from whichever roles hold the
 * source privilege in THIS tenant, customisations included — and records it,
 * so an admin who later removes the new privilege from a role is not
 * overridden on the next restart.
 *
 * Additive only: one small bookkeeping table plus role_privileges rows.
 */
const COPIES = [
  { key: 'bills.cancel', from: ['bills.delete'] },
];

async function ensurePrivilegeGrantCopies(sequelize, copies = COPIES) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS privilege_grant_copies (
      privilege_key VARCHAR(100) PRIMARY KEY,
      copied_from TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  for (const { key, from } of copies) {
    const [[done]] = await sequelize.query('SELECT 1 AS ok FROM privilege_grant_copies WHERE privilege_key = :key', { replacements: { key } });
    if (done) continue;
    const [[target]] = await sequelize.query('SELECT id FROM privileges WHERE privilege_key = :key', { replacements: { key } });
    if (!target) continue; // catalog sync hasn't created it yet — try again next time
    await sequelize.query(
      `INSERT INTO role_privileges (role_id, privilege_id)
       SELECT DISTINCT rp.role_id, :targetId
         FROM role_privileges rp JOIN privileges p ON p.id = rp.privilege_id
        WHERE p.privilege_key IN (:from)
       ON CONFLICT DO NOTHING`,
      { replacements: { targetId: target.id, from } }
    );
    await sequelize.query(
      'INSERT INTO privilege_grant_copies (privilege_key, copied_from) VALUES (:key, :from) ON CONFLICT DO NOTHING',
      { replacements: { key, from: from.join(',') } }
    );
  }
}

module.exports = { ensurePrivilegeGrantCopies, COPIES };

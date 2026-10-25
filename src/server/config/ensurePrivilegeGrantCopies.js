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
  { key: 'expenses.pay', from: ['expenses.write'] },
  { key: 'supplier_bills.pay', from: ['expenses.write'] },
  { key: 'consultant_bills.pay', from: ['expenses.write'] },
  { key: 'payroll.pay', from: ['hr.payroll.write'] },
  { key: 'salary_advances.disburse', from: ['hr.salary_advances.write'] },
  // Enrolling a patient in a scheme happens at registration (it used to need
  // schemes.write, which front desks don't hold): whoever registers patients.
  { key: 'schemes.enroll_patient', from: ['lis.registration.write', 'pages.lis_registration.view'] },
  // Rosters are new HR/attendance work: whoever runs HR or attendance today.
  { key: 'roster.view', from: ['attendance.view', 'hr.employees.read'] },
  { key: 'roster.manage', from: ['attendance.manage_sites', 'hr.employees.write'] },
  { key: 'roster.approve', from: ['hr.employees.write'] },
  // Refund approval was a per-USER right (approval_permissions); the roles of
  // everyone holding it get the new role privilege, and the per-user check stays.
  { key: 'refunds.approve', from: [], fromApprovalTypes: ['receipt_void_approve', 'deposit_refund_approve'] },
];

async function ensurePrivilegeGrantCopies(sequelize, copies = COPIES) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS privilege_grant_copies (
      privilege_key VARCHAR(100) PRIMARY KEY,
      copied_from TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  for (const { key, from, fromApprovalTypes = [] } of copies) {
    const [[done]] = await sequelize.query('SELECT 1 AS ok FROM privilege_grant_copies WHERE privilege_key = :key', { replacements: { key } });
    if (done) continue;
    const [[target]] = await sequelize.query('SELECT id FROM privileges WHERE privilege_key = :key', { replacements: { key } });
    if (!target) continue; // catalog sync hasn't created it yet — try again next time
    if (from.length) {
      await sequelize.query(
        `INSERT INTO role_privileges (role_id, privilege_id)
         SELECT DISTINCT rp.role_id, :targetId
           FROM role_privileges rp JOIN privileges p ON p.id = rp.privilege_id
          WHERE p.privilege_key IN (:from)
         ON CONFLICT DO NOTHING`,
        { replacements: { targetId: target.id, from } }
      );
    }
    if (fromApprovalTypes.length) {
      const [[hasTable]] = await sequelize.query(`SELECT to_regclass('approval_permissions') IS NOT NULL AS ok`);
      if (hasTable?.ok) {
        await sequelize.query(
          `INSERT INTO role_privileges (role_id, privilege_id)
           SELECT DISTINCT r.id, :targetId
             FROM approval_permissions ap
             JOIN users u ON u.id = ap.user_id
             JOIN roles r ON r.role_key = u.role
            WHERE ap.approval_type IN (:types)
           ON CONFLICT DO NOTHING`,
          { replacements: { targetId: target.id, types: fromApprovalTypes } }
        );
      }
    }
    await sequelize.query(
      'INSERT INTO privilege_grant_copies (privilege_key, copied_from) VALUES (:key, :from) ON CONFLICT DO NOTHING',
      { replacements: { key, from: [...from, ...fromApprovalTypes.map((t) => `approval:${t}`)].join(',') } }
    );
  }
}

module.exports = { ensurePrivilegeGrantCopies, COPIES };

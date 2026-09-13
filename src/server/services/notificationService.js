const { v4: uuidv4 } = require('uuid');

/**
 * In-app notifications (stored in app_notifications — plain "notifications"
 * collides with a pre-existing, unrelated, unused table already in this
 * schema) — always non-blocking (a notification failing to write must never
 * fail the action that triggered it, same convention as this codebase's
 * audit logging), and always fanned out to real rows per recipient (see
 * ensureNotificationsTable.js for why).
 */

/**
 * Notify one specific user.
 */
async function notifyUser(sequelize, { clinic_id, user_id, type, title, message, entity_type, entity_id, link }) {
  if (!user_id) return;
  try {
    await sequelize.query(
      `INSERT INTO app_notifications (id, clinic_id, user_id, type, title, message, entity_type, entity_id, link, is_read, created_at)
       VALUES (:id, :clinicId, :userId, :type, :title, :message, :entityType, :entityId, :link, false, NOW())`,
      {
        replacements: {
          id: uuidv4(), clinicId: parseInt(clinic_id) || null, userId: parseInt(user_id),
          type, title, message: message || null,
          entityType: entity_type || null, entityId: entity_id != null ? String(entity_id) : null,
          link: link || null,
        },
      }
    );
  } catch (e) {
    console.error('notifyUser failed (non-blocking):', e.message);
  }
}

/**
 * Notify every active user holding a given role in a clinic — either as
 * their primary users.role or as one of their user_additional_roles. Scoped
 * to branch_id when given (a branch-specific event, e.g. a queue entry at
 * one site, shouldn't page every doctor at every branch of a multi-branch
 * tenant); omit it for a clinic-wide event.
 */
async function notifyRole(sequelize, { clinic_id, role, branch_id, excludeUserId, type, title, message, entity_type, entity_id, link }) {
  if (!role) return;
  try {
    const conditions = ['u.clinic_id = :clinicId', 'u.is_active = true', '(u.role = :role OR uar.role_key = :role)'];
    const replacements = { clinicId: parseInt(clinic_id) || null, role };
    if (branch_id) {
      conditions.push('(u.branch_id = :branchId OR u.branch_id IS NULL)');
      replacements.branchId = parseInt(branch_id);
    }
    if (excludeUserId) {
      conditions.push('u.id != :excludeUserId');
      replacements.excludeUserId = parseInt(excludeUserId);
    }

    const [users] = await sequelize.query(
      `SELECT DISTINCT u.id
         FROM users u
         LEFT JOIN user_additional_roles uar ON uar.user_id = u.id
        WHERE ${conditions.join(' AND ')}`,
      { replacements }
    );
    if (users.length === 0) return;

    // One multi-row INSERT rather than one round trip per recipient — a role
    // with dozens of people (every nurse in a large facility, say) would
    // otherwise serialize that many sequential queries for a single event.
    const rowReplacements = { clinicId: parseInt(clinic_id) || null, type, title, message: message || null,
      entityType: entity_type || null, entityId: entity_id != null ? String(entity_id) : null, link: link || null };
    const valueRows = users.map((u, i) => {
      rowReplacements[`userId${i}`] = u.id;
      return `(:id${i}, :clinicId, :userId${i}, :type, :title, :message, :entityType, :entityId, :link, false, NOW())`;
    });
    for (let i = 0; i < users.length; i++) rowReplacements[`id${i}`] = uuidv4();

    await sequelize.query(
      `INSERT INTO app_notifications (id, clinic_id, user_id, type, title, message, entity_type, entity_id, link, is_read, created_at)
       VALUES ${valueRows.join(', ')}`,
      { replacements: rowReplacements }
    );
  } catch (e) {
    console.error('notifyRole failed (non-blocking):', e.message);
  }
}

module.exports = { notifyUser, notifyRole };

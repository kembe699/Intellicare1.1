const { v4: uuidv4 } = require('uuid');

/**
 * The employee-portal counterpart to services/notificationService.js's
 * notifyUser — same always-non-blocking convention, writing to
 * portal_notifications (employees.id recipient) instead of
 * app_notifications (users.id recipient), since a portal-only employee
 * may have no HMIS user account to notify there.
 */
async function notifyEmployee(sequelize, { clinic_id, employee_id, type, title, message, entity_type, entity_id }) {
  if (!employee_id) return;
  try {
    await sequelize.query(
      `INSERT INTO portal_notifications (id, clinic_id, employee_id, type, title, message, entity_type, entity_id, is_read, created_at)
       VALUES (:id, :clinicId, :employeeId, :type, :title, :message, :entityType, :entityId, false, NOW())`,
      {
        replacements: {
          id: uuidv4(), clinicId: parseInt(clinic_id) || null, employeeId: employee_id,
          type, title, message: message || null,
          entityType: entity_type || null, entityId: entity_id != null ? String(entity_id) : null,
        },
      }
    );
  } catch (e) {
    console.error('notifyEmployee failed (non-blocking):', e.message);
  }
}

module.exports = { notifyEmployee };

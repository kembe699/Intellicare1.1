/**
 * Links a lis_test_orders row back to the appointment it was queued from
 * (see POST /api/appointments/:id/queue in appointments.js), so a doctor
 * opening this visit — on the queue list or in the Visit Summary — can see
 * it's a booked follow-up rather than a walk-in, and why. Nullable; most
 * orders still come from a direct queue (no appointment). No FK, consistent
 * with this codebase's other ensureXxxTable-style column additions.
 */
async function ensureLisAppointmentLink(sequelize) {
  await sequelize.query(`ALTER TABLE lis_test_orders ADD COLUMN IF NOT EXISTS appointment_id VARCHAR(36)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_lis_test_orders_appointment ON lis_test_orders(appointment_id)`);
}

module.exports = { ensureLisAppointmentLink };

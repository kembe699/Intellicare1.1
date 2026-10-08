/**
 * Follow-up / next-visit appointments — scheduled from a patient's Visit
 * Summary (or directly from the Appointments page), surfaced on the new
 * sidebar "Appointments" page so front desk/nursing can see who's expected
 * and queue them straight to the doctor who asked for the follow-up when
 * they actually show up. Ensured per-tenant the same way as
 * ensureNursingProceduresTable.js (see tenantDb.js's buildTenantConnection
 * for why per-tenant call sites, not a one-off boot migration, are how a
 * new table actually reaches every tenant).
 *
 * Deliberately NOT a time-slot/calendar booking system — just a date, a
 * reason, and who it's for/with, matching what was actually asked for
 * ("like a follow up visit next visit"). `status` moves scheduled -> queued
 * (once queued, via queued_order_id) or scheduled -> cancelled; there is no
 * separate "completed" state because queuing into lis_test_orders IS the
 * handoff into the normal visit/consult flow, which already tracks its own
 * completion.
 */
async function ensureAppointmentsTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER,
      branch_id INTEGER,
      participant_id VARCHAR(36) NOT NULL,
      doctor_id INTEGER,
      scheduled_date DATE NOT NULL,
      reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      source_order_id VARCHAR(36),
      queued_order_id VARCHAR(36),
      created_by INTEGER,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_appointments_participant ON appointments(participant_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, scheduled_date)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_appointments_clinic_date ON appointments(clinic_id, scheduled_date)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)`);
}

module.exports = { ensureAppointmentsTable };

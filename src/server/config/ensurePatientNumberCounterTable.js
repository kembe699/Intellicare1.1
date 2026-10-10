/**
 * The old participant_number was "PTN-YYYYMMDD-RRRR" — a random 4-digit
 * suffix with no uniqueness constraint behind it (lis_participants.
 * participant_number is NOT NULL only, no UNIQUE), and 12 digits long after
 * the prefix. Replaced with a 6-digit sequential number per facility,
 * allocated the same collision-proof way as queue_number_counters and
 * GL/JE document numbers: INSERT ... ON CONFLICT DO UPDATE ... RETURNING
 * inside the same transaction as the lis_participants insert, so Postgres'
 * row lock on the counter makes two concurrent registrations impossible to
 * collide. Unlike queue_number_counters this never resets — a patient
 * number is permanent, not a daily ticket.
 */
async function ensurePatientNumberCounterTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS patient_number_counters (
      clinic_id INTEGER PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/** Allocates the next sequential patient number for one clinic, zero-padded
 * to 6 digits (widening naturally past 999999 rather than truncating). Pass
 * the same open transaction the caller uses to insert the participant row. */
async function getNextPatientNumber(sequelize, { clinicId, transaction }) {
  const [rows] = await sequelize.query(
    `INSERT INTO patient_number_counters (clinic_id, last_number, updated_at)
     VALUES (:clinicId, 1, NOW())
     ON CONFLICT (clinic_id)
     DO UPDATE SET last_number = patient_number_counters.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    { replacements: { clinicId: clinicId || 1 }, transaction }
  );
  return String(rows[0].last_number).padStart(6, '0');
}

module.exports = { ensurePatientNumberCounterTable, getNextPatientNumber };

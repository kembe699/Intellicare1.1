/**
 * Printable queue receipts need a short, human-readable ticket number — the
 * existing queue is just lis_test_orders rows ordered by created_at, with
 * nothing sequential to hand a patient. queue_number_counters allocates one
 * per (clinic, branch, day), resetting every day, via the same
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING technique
 * DocumentNumberService.js uses for GL/JE numbers: Postgres takes a row lock
 * on the conflicting counter row, so two concurrent queue-ins for the same
 * clinic/branch/day can never be handed the same number. branch_id is
 * NOT NULL (defaulted to 0 for a branchless tenant) because it's part of the
 * primary key and Postgres PKs can't contain NULL.
 */
async function ensureQueueNumberSupport(sequelize) {
  await sequelize.query(`ALTER TABLE lis_test_orders ADD COLUMN IF NOT EXISTS queue_number INTEGER`);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS queue_number_counters (
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL DEFAULT 0,
      queue_date DATE NOT NULL,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (clinic_id, branch_id, queue_date)
    )
  `);
}

/**
 * Allocates the next queue number for today, for one clinic+branch. Pass the
 * same open transaction the caller is using to insert the lis_test_orders
 * row, same reasoning as getNextDocumentNumber.
 */
async function getNextQueueNumber(sequelize, { clinicId, branchId, transaction }) {
  const [rows] = await sequelize.query(
    `INSERT INTO queue_number_counters (clinic_id, branch_id, queue_date, last_number, updated_at)
     VALUES (:clinicId, :branchId, CURRENT_DATE, 1, NOW())
     ON CONFLICT (clinic_id, branch_id, queue_date)
     DO UPDATE SET last_number = queue_number_counters.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    { replacements: { clinicId: clinicId || 1, branchId: branchId || 0 }, transaction }
  );
  return rows[0].last_number;
}

module.exports = { ensureQueueNumberSupport, getNextQueueNumber };

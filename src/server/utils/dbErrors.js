/**
 * Recognising database errors across the dialect this app was written for and
 * the one it now runs on.
 *
 * The codebase was built against MySQL and moved to PostgreSQL. Error handling
 * was written against MySQL's string codes (ER_DUP_ENTRY, ER_DUP_FIELDNAME),
 * which PostgreSQL never produces — it uses SQLSTATE numbers. Every one of those
 * checks silently stopped matching.
 *
 * The visible symptom was a user-facing one: adding a room, ward or bed whose
 * number already existed produced "Failed to create room" with a 500, instead of
 * "Room number already exists". Sequelize does raise a recognisable error there
 * — SequelizeUniqueConstraintError — but its .message is the unhelpful
 * "Validation error", so a check for the word "unique" missed it too.
 */

/** A unique constraint was violated (duplicate key). */
function isUniqueViolation(error) {
  if (!error) return false;
  if (error.name === 'SequelizeUniqueConstraintError') return true;
  const code = error.original?.code ?? error.parent?.code ?? error.code;
  return code === '23505'          // PostgreSQL unique_violation
      || code === 'ER_DUP_ENTRY';  // MySQL
}

/** An ALTER TABLE tried to add a column that is already there. */
function isDuplicateColumn(error) {
  if (!error) return false;
  const code = error.original?.code ?? error.parent?.code ?? error.code;
  if (code === '42701' || code === 'ER_DUP_FIELDNAME') return true;
  return /already exists/i.test(error.message || '');
}

/** A row was referenced that does not exist (foreign key violation). */
function isForeignKeyViolation(error) {
  if (!error) return false;
  if (error.name === 'SequelizeForeignKeyConstraintError') return true;
  const code = error.original?.code ?? error.parent?.code ?? error.code;
  return code === '23503' || code === 'ER_NO_REFERENCED_ROW' || code === 'ER_NO_REFERENCED_ROW_2';
}

module.exports = { isUniqueViolation, isDuplicateColumn, isForeignKeyViolation };

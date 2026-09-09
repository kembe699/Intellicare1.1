/**
 * Telling a legacy MySQL migration apart from a real schema failure.
 *
 * This app was written against MySQL and migrated to PostgreSQL. A number of
 * boot-time "ensure the schema is right" guards are still written in MySQL DDL —
 * ALTER TABLE ... MODIFY COLUMN, ENUM widening, ADD COLUMN ... AFTER x, inline
 * KEY clauses. On PostgreSQL each is a syntax error, and each is also
 * unnecessary: the columns they widen are plain text here, so they are already
 * unconstrained, and the tables they guard already exist.
 *
 * They were caught and logged as errors, which put nine "syntax error" lines in
 * every boot log. That is worse than useless — an operator who learns to scroll
 * past them will scroll past a real one too. This lets those call sites say what
 * is actually happening instead.
 */
const LEGACY_PATTERNS = [
  /syntax error at or near "MODIFY"/i,
  /syntax error at or near "AFTER"/i,
  /syntax error at or near "KEY"/i,
  /syntax error at or near "AUTO_INCREMENT"/i,
  /syntax error at or near "ENUM"/i,
  /type "enum" does not exist/i,
];

/** True when this error is MySQL-only DDL failing on PostgreSQL. */
function isLegacyMySqlDDL(error) {
  const msg = error?.message || String(error || '');
  return LEGACY_PATTERNS.some((p) => p.test(msg));
}

/**
 * Log a failed schema guard at the right volume: quiet when it is legacy MySQL
 * DDL that PostgreSQL neither accepts nor needs, loud when it is anything else.
 */
function reportSchemaGuardFailure(label, error) {
  if (isLegacyMySqlDDL(error)) {
    console.log(`  ⏭  ${label}: skipped, MySQL-only DDL that PostgreSQL does not need`);
    return;
  }
  console.warn(`  ⚠️  ${label}: ${error?.message || error}`);
}

module.exports = { isLegacyMySqlDDL, reportSchemaGuardFailure };

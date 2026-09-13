/**
 * DDL only — creates the app_notifications table if it doesn't exist yet.
 * Named app_notifications rather than notifications because this schema
 * already has an unrelated, unused "notifications" table (different columns,
 * no code anywhere referencing it) — a collision not worth untangling when a
 * different name sidesteps it entirely.
 *
 * Safe to call repeatedly, and safe to call per-tenant (see ensureRolesTables.js
 * for why per-tenant call sites, not the single-connection background migration
 * list, are how a brand-new table actually reaches every schema).
 *
 * One row per (recipient, event) — a notification meant for a whole role (e.g.
 * every lab tech) is fanned out into one row per matching user at creation
 * time rather than stored once and shared, so is_read is genuinely per-user
 * and never a global toggle for other people's copies.
 */
async function ensureNotificationsTable(sequelize) {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_notifications (
      id VARCHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT,
      entity_type VARCHAR(100),
      entity_id VARCHAR(100),
      link VARCHAR(500),
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const [idxName, idxSql] of [
    ['notifications_user_unread_idx', 'CREATE INDEX notifications_user_unread_idx ON app_notifications(user_id, is_read, created_at DESC)'],
    ['notifications_clinic_id_idx', 'CREATE INDEX notifications_clinic_id_idx ON app_notifications(clinic_id)'],
  ]) {
    try {
      const [[check]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'app_notifications' AND indexname = :idxName`,
        { replacements: { idxName } }
      );
      if (!check.cnt) await sequelize.query(idxSql);
    } catch (e) { /* index creation is best-effort */ }
  }
}

module.exports = { ensureNotificationsTable };

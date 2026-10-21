/**
 * The Analytics Assistant's allowlisted query layer. Every function here is
 * a fixed, parameterized SELECT — no user text is ever concatenated into
 * SQL, only validated dates/ids passed as named replacements, matching the
 * read-only requirement in full. There is no free-form query path; an
 * intent that isn't one of the functions below simply cannot be asked.
 *
 * ── Why department-level and per-doctor revenue aren't here ─────────────
 * IntelliCare's data model has no foreign key from a bill line item to a
 * department, and no doctor_id column on patient_bills at all (confirmed by
 * reading reportClinicPerformance.js and reportDoctorPerformance.js, the
 * two existing reports that already grapple with this). The only existing
 * way to approximate department revenue is reportClinicPerformance.js's
 * normalized-name matching against the `services` catalog, which that
 * report's own comments say is "far from complete" even on live data and
 * explicitly buckets unmatched line items as "Uncategorized". Reusing that
 * heuristic here, presented as a chatbot's confident answer, would violate
 * the spec's own "never fabricate, never guess missing values" requirement
 * — so these two questions are intentionally routed (see
 * responseTemplates.js) to an honest limitation message pointing at the
 * Clinic Performance / Doctor Performance reports instead of a computed
 * number. Visit/registration counts and doctor *activity* (not revenue)
 * have real foreign keys and are computed exactly, below.
 *
 * ── Revenue definition ───────────────────────────────────────────────────
 * Cash-basis, matching reportIncomeStatement.js's own documented default
 * and receipts.js's /clinic/:clinicId/stats endpoint: counts a receipt when
 * the patient paid (receipts.status = 'active', payment_date in range), not
 * when a bill was raised. Voided/refunded receipts are excluded by the same
 * status filter, so refunds are never double-counted as revenue.
 *
 * ── "Visit" means lis_test_orders, not the legacy `visits` table ────────
 * Confirmed against reportDoctorPerformance.js's own header comment (and
 * reproduced here against the live preview DB): the `visits` table is
 * barely-used legacy data, and its `doctor_id` is stamped with whichever
 * account was logged in when the row was created — never a real
 * role='doctor' user (it's also DataTypes.UUID there, which doesn't even
 * type-match users.id, an INTEGER — joining the two throws a Postgres
 * "operator does not exist: integer = uuid" error, caught while verifying
 * this feature live). The real unit of clinical encounter this system
 * actually uses is a `lis_test_orders` row (created per visit via POST
 * /lis/orders), whose `doctor_id` DOES correctly resolve to real doctor
 * accounts. Visit counts and doctor activity below both query
 * lis_test_orders, same as reportDoctorPerformance.js and reportPatients.js
 * already do. `lis_test_orders.clinic_id` is a separate, unreliable
 * (UUID, often-null) column unrelated to the numeric facility clinic_id —
 * per the same existing reports, it is deliberately NOT filtered on here;
 * branch scoping still applies via branch_id, which is reliable.
 */

/** Same role==='admin'-bypass / branchContext.branchId-else-user.branchId rule as dashboard.js's branchScope(). */
function branchScope(req, replacements, column = 'branch_id') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId || null;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ` AND ${column} = :branchId`;
}

async function getRegistrationsCount(sequelize, { req, start, end }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_participants WHERE created_at >= :start AND created_at < :end${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

async function getVisitsCount(sequelize, { req, start, end }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM lis_test_orders WHERE created_at >= :start AND created_at < :end${branchSQL}`,
    { replacements },
  );
  return { count: parseInt(row?.cnt || 0, 10) };
}

async function getRevenueTotal(sequelize, { req, clinicId, start, end }) {
  const replacements = { clinicId, start, end };
  const branchSQL = branchScope(req, replacements);
  const [[row]] = await sequelize.query(
    `SELECT COALESCE(SUM(payment_amount), 0) AS total, COUNT(*) AS cnt
       FROM receipts
      WHERE clinic_id = :clinicId AND status = 'active'
        AND payment_date >= :start AND payment_date < :end${branchSQL}`,
    { replacements },
  );
  return { total: parseFloat(row?.total || 0), count: parseInt(row?.cnt || 0, 10) };
}

/** Doctors visible to this tenant/branch — used both for entity extraction and the full ranking. */
async function listDoctors(sequelize, { req, clinicId }) {
  const replacements = { clinicId };
  const branchSQL = branchScope(req, replacements);
  const [rows] = await sequelize.query(
    `SELECT id, display_name FROM users WHERE role = 'doctor' AND is_active = true AND clinic_id = :clinicId${branchSQL}
     ORDER BY display_name`,
    { replacements },
  );
  return rows;
}

/**
 * Visit counts per doctor, via lis_test_orders.doctor_id -> users (role=
 * 'doctor') — the verified-correct join (see header comment above; the
 * same one reportDoctorPerformance.js already uses). `doctorId` narrows to
 * a single doctor (named-doctor follow-up); omitted, returns the full
 * ranking.
 */
async function getDoctorActivity(sequelize, { req, start, end, doctorId }) {
  const replacements = { start, end };
  const branchSQL = branchScope(req, replacements, 'o.branch_id');
  const doctorSQL = doctorId ? ' AND u.id = :doctorId' : '';
  if (doctorId) replacements.doctorId = doctorId;
  const [rows] = await sequelize.query(
    `SELECT u.id, u.display_name AS "displayName", COUNT(o.id) AS visits
       FROM lis_test_orders o
       JOIN users u ON u.id = o.doctor_id AND u.role = 'doctor'
      WHERE o.created_at >= :start AND o.created_at < :end${branchSQL}${doctorSQL}
      GROUP BY u.id, u.display_name
      ORDER BY visits DESC
      LIMIT 10`,
    { replacements },
  );
  return rows.map((r) => ({ id: r.id, displayName: r.displayName, visits: parseInt(r.visits, 10) }));
}

module.exports = {
  getRegistrationsCount,
  getVisitsCount,
  getRevenueTotal,
  getDoctorActivity,
  listDoctors,
};

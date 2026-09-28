const { v4: uuidv4 } = require('uuid');

// Core visit_diagnoses business rules, pulled out of routes/lisModule.js so
// they're directly unit/integration-testable without spinning up Express —
// same reasoning as reportDhis2.js's __testHelpers and routes/icd10.js's
// standalone query functions.
//
// clinical_notes keeps getting the "Diagnosis: ..." line appended on every
// add too (coded as "Diagnosis: <code> - <description>", custom as
// "Diagnosis: <text>") so every existing reader of that text
// (getDiagnosesFromNotes/extractDiagnosisFromNotes in LISTestOrders.tsx, the
// DHIS2 report) keeps working unchanged — visit_diagnoses is additive, not a
// replacement.

function diagnosisNoteLine({ source, icd_code, description }) {
  return source === 'icd' && icd_code ? `${icd_code} - ${description}` : description;
}

async function appendDiagnosisNote(db, orderId, noteText) {
  const [[order]] = await db.query('SELECT clinical_notes FROM lis_test_orders WHERE id = ?', { replacements: [orderId] });
  const updated = order?.clinical_notes ? `${order.clinical_notes}\n\nDiagnosis: ${noteText}` : `Diagnosis: ${noteText}`;
  await db.query('UPDATE lis_test_orders SET clinical_notes = ?, updated_at = NOW() WHERE id = ?', { replacements: [updated, orderId] });
}

async function listVisitDiagnoses(db, orderId) {
  const [rows] = await db.query(
    `SELECT id, icd_code, icd_source, icd_version, description, is_primary, source, custom_diagnosis_id, created_at
     FROM visit_diagnoses WHERE order_id = ? AND deleted_at IS NULL
     ORDER BY is_primary DESC, created_at ASC`,
    { replacements: [orderId] }
  );
  return rows;
}

/**
 * Adds a diagnosis to a visit. `icdCode` present -> source 'icd'; otherwise
 * 'custom'. Enforces: order must exist and be open, no duplicate diagnosis
 * on the same visit (by code for ICD, by text case-insensitively for
 * custom), and the visit's first diagnosis becomes primary automatically.
 * Returns { status, error } on failure, { status: 201, diagnosis } on success.
 */
async function addVisitDiagnosis(db, { orderId, icdCode, icdSource, icdVersion, description, customDiagnosisId, userId, fallbackBranchId }) {
  const source = icdCode ? 'icd' : 'custom';
  const text = (description || '').trim();
  if (!text) return { status: 400, error: 'A diagnosis description is required' };

  const [[order]] = await db.query('SELECT status, participant_id, branch_id FROM lis_test_orders WHERE id = ?', { replacements: [orderId] });
  if (!order) return { status: 404, error: 'Order not found' };
  if (order.status === 'closed') return { status: 409, error: 'This visit is closed — start a new visit to add a diagnosis.' };

  const [dupes] = source === 'icd'
    ? await db.query(`SELECT id FROM visit_diagnoses WHERE order_id = ? AND deleted_at IS NULL AND icd_code = ?`, { replacements: [orderId, icdCode] })
    : await db.query(`SELECT id FROM visit_diagnoses WHERE order_id = ? AND deleted_at IS NULL AND source = 'custom' AND LOWER(description) = LOWER(?)`, { replacements: [orderId, text] });
  if (dupes.length > 0) return { status: 409, error: 'This diagnosis is already recorded for this visit' };

  const [[{ count: existingCount }]] = await db.query(`SELECT COUNT(*)::int AS count FROM visit_diagnoses WHERE order_id = ? AND deleted_at IS NULL`, { replacements: [orderId] });
  const isPrimary = existingCount === 0;

  const diagId = uuidv4();
  await db.query(
    `INSERT INTO visit_diagnoses (id, order_id, participant_id, branch_id, icd_code, icd_source, icd_version, description, is_primary, source, custom_diagnosis_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    { replacements: [diagId, orderId, order.participant_id, order.branch_id || fallbackBranchId || null, icdCode || null, icdSource || null, icdVersion || null, text, isPrimary, source, customDiagnosisId || null, userId || null] }
  );

  await appendDiagnosisNote(db, orderId, diagnosisNoteLine({ source, icd_code: icdCode, description: text }));

  const [[created]] = await db.query(`SELECT * FROM visit_diagnoses WHERE id = ?`, { replacements: [diagId] });
  return { status: 201, diagnosis: created };
}

async function setPrimaryDiagnosis(db, { orderId, diagnosisId }) {
  const t = await db.transaction();
  try {
    const [[order]] = await db.query('SELECT status FROM lis_test_orders WHERE id = ?', { replacements: [orderId], transaction: t });
    if (!order) { await t.rollback(); return { status: 404, error: 'Order not found' }; }
    if (order.status === 'closed') { await t.rollback(); return { status: 409, error: 'This visit is closed.' }; }
    const [[target]] = await db.query('SELECT id FROM visit_diagnoses WHERE id = ? AND order_id = ? AND deleted_at IS NULL', { replacements: [diagnosisId, orderId], transaction: t });
    if (!target) { await t.rollback(); return { status: 404, error: 'Diagnosis not found on this visit' }; }
    await db.query('UPDATE visit_diagnoses SET is_primary = false WHERE order_id = ?', { replacements: [orderId], transaction: t });
    await db.query('UPDATE visit_diagnoses SET is_primary = true WHERE id = ?', { replacements: [diagnosisId], transaction: t });
    await t.commit();
    return { status: 200 };
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

/**
 * Soft-deletes a diagnosis. If it was primary, promotes the next-oldest
 * remaining diagnosis automatically so a visit with >=1 diagnosis never ends
 * up with none marked primary.
 */
async function removeVisitDiagnosis(db, { orderId, diagnosisId, userId }) {
  const [[order]] = await db.query('SELECT status FROM lis_test_orders WHERE id = ?', { replacements: [orderId] });
  if (!order) return { status: 404, error: 'Order not found' };
  if (order.status === 'closed') return { status: 409, error: 'This visit is closed — diagnoses can no longer be removed.' };
  const [[diag]] = await db.query('SELECT * FROM visit_diagnoses WHERE id = ? AND order_id = ? AND deleted_at IS NULL', { replacements: [diagnosisId, orderId] });
  if (!diag) return { status: 404, error: 'Diagnosis not found on this visit' };

  await db.query('UPDATE visit_diagnoses SET deleted_at = NOW(), deleted_by = ? WHERE id = ?', { replacements: [userId || null, diagnosisId] });
  if (diag.is_primary) {
    await db.query(
      `UPDATE visit_diagnoses SET is_primary = true WHERE id = (
         SELECT id FROM visit_diagnoses WHERE order_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1
       )`,
      { replacements: [orderId] }
    );
  }
  return { status: 200, removed: diag };
}

module.exports = {
  listVisitDiagnoses, addVisitDiagnosis, setPrimaryDiagnosis, removeVisitDiagnosis,
  diagnosisNoteLine, appendDiagnosisNote,
};

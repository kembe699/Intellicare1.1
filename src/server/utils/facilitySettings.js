/**
 * Reads a clinic's Setup › Configurations row (facility_settings) with the
 * built-in defaults filled in — the defaults are the system's behaviour from
 * before each setting existed. Used wherever the server enforces one of them.
 */
const DEFAULTS = {
  queue_receipt_enabled: true,
  billing_redirect_after_queue_enabled: true,
  patient_number_prefix: 'PTN',
  patient_number_suffix: '',
  approvals_allow_same_person: false,
  expense_approvals_required: 2,
  supplier_bill_approvals_required: 3,
  receipt_void_requires_approval: true,
  credit_note_separate_approver: false,
};

async function getFacilitySettings(db, clinicId) {
  try {
    const [[row]] = await db.query('SELECT * FROM facility_settings WHERE clinic_id = :clinicId', { replacements: { clinicId: parseInt(clinicId, 10) || 1 } });
    const merged = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (row && row[k] !== null && row[k] !== undefined) merged[k] = row[k];
    merged.expense_approvals_required = Math.min(2, Math.max(1, parseInt(merged.expense_approvals_required, 10) || 2));
    merged.supplier_bill_approvals_required = Math.min(3, Math.max(1, parseInt(merged.supplier_bill_approvals_required, 10) || 3));
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { getFacilitySettings, FACILITY_DEFAULTS: DEFAULTS };

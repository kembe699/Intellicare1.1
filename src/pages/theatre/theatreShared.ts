export interface PatientOption {
  id: string; code: string; first_name: string; last_name: string; gender: string | null; date_of_birth: string | null; source: 'patients' | 'lis_participants';
}

// A room tagged room_type = 'or' in the general rooms table (managed at
// /setup/rooms), with its OR-specific live status joined in.
export interface TheatreRoom {
  id: string; name: string; status: 'available' | 'in_use' | 'cleaning' | 'maintenance';
}

export interface StockLocation { id: string; location_code: string; location_name: string; location_type: string; }
export interface StockItemOption { id: string; item_name: string; item_code: string; unit_of_measure: string | null; available_quantity: number; }
export interface OperationItemUsage {
  id: string; item_id: string; item_name: string; location_id: string | null; location_name: string | null;
  quantity: string; unit_of_measure: string | null; dispensed_by: string | null; dispensed_at: string; notes: string | null;
  administered_at: string | null; administered_by: string | null;
  administered_route: string | null; administered_dose: string | null; administered_notes: string | null;
  /** Only present on the response from recording usage (POST /items), not on the stored row. */
  billed?: boolean; billReason?: 'no_selling_price' | 'billing_failed' | null;
}

export interface TheatreRequest {
  id: string; patient_id: string; patient_first_name: string | null; patient_last_name: string | null; patient_code: string | null;
  requesting_department: string | null; procedure_name: string; diagnosis: string | null;
  priority: 'routine' | 'urgent' | 'emergency'; status: 'pending' | 'scheduled' | 'cancelled';
  notes: string | null; cancelled_reason: string | null; created_at: string;
  service_id: string | null; estimated_fee: string | null; fee_currency: string; bill_id: string | null; billed_at: string | null;
}

// A service from /setup/services whose category is 'Procedure' — the
// catalog /theatre/requests picks from instead of free text.
export interface ProcedureServiceOption { id: string; service_name: string; price: string | number; category: string; }

export interface TeamMember {
  id: string; operation_id: string; employee_id: string; role: 'surgeon' | 'anesthetist' | 'scrub_nurse';
  first_name: string; last_name: string; created_at: string; fee_percentage: string | number | null;
}
export const ROLE_LABEL: Record<string, string> = { surgeon: 'Surgeon', anesthetist: 'Anaesthetist', scrub_nurse: 'Scrub Nurse' };

export interface ChecklistItem {
  id: string; operation_id: string; phase: 'pre_op' | 'intra_op' | 'post_op'; item_text: string; sort_order: number;
  is_checked: boolean; checked_by: string | null; checked_at: string | null;
}

export interface VitalsEntry {
  id: string; phase: 'pre_op' | 'intra_op' | 'post_op'; recorded_at: string; blood_pressure: string | null;
  pulse: number | null; temperature: string | null; respiratory_rate: number | null; spo2: number | null; notes: string | null;
}

export interface TheatreOperation {
  id: string; clinic_id: number; request_id: string | null; patient_id: string;
  patient_first_name: string | null; patient_last_name: string | null; patient_code: string | null;
  patient_gender: string | null; patient_dob: string | null;
  theatre_room_id: string | null; room_name: string | null;
  procedure_name: string;
  surgeon_employee_id: string | null; surgeon_first_name: string | null; surgeon_last_name: string | null;
  anesthetist_employee_id: string | null; anesthetist_first_name: string | null; anesthetist_last_name: string | null;
  scrub_nurse_employee_id: string | null; nurse_first_name: string | null; nurse_last_name: string | null;
  scheduled_at: string | null; status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  started_at: string | null; ended_at: string | null; duration_minutes: number | null;
  outcome: 'successful' | 'complication' | 'death' | 'aborted' | null; outcome_notes: string | null; cause_of_death: string | null;
  procedure_fee: string | null; fee_currency: string; bill_id: string | null; billed_at: string | null;
  checklist: ChecklistItem[]; vitals: VitalsEntry[]; items: OperationItemUsage[]; team: TeamMember[];
}

export const PRIORITY_BADGE: Record<string, 'danger' | 'warning' | 'neutral'> = { emergency: 'danger', urgent: 'warning', routine: 'neutral' };
export const STATUS_BADGE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  pending: 'warning', scheduled: 'neutral', in_progress: 'warning', completed: 'success', cancelled: 'danger',
};
export const ROOM_STATUS_BADGE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  available: 'success', in_use: 'warning', cleaning: 'neutral', maintenance: 'danger',
};
export const PHASE_LABEL: Record<string, string> = { pre_op: 'Pre-Op (Sign In)', intra_op: 'Intra-Op (Time Out)', post_op: 'Post-Op (Sign Out)' };
export const OUTCOME_LABEL: Record<string, string> = { successful: 'Successful', complication: 'Complication', death: 'Patient Died', aborted: 'Aborted' };
export const OUTCOME_BADGE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { successful: 'success', complication: 'warning', death: 'danger', aborted: 'neutral' };

export function patientName(row: { patient_first_name: string | null; patient_last_name: string | null }) {
  return [row.patient_first_name, row.patient_last_name].filter(Boolean).join(' ') || 'Unknown patient';
}

export function formatDuration(minutes: number | null) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

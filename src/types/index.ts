// The 12 built-in roles, plus any custom role_key an admin creates via
// Setup > Security > Roles & Privileges (src/server/routes/roles.js allows an
// arbitrary role_key) — same "known literals | string" pattern as ClinicName
// below, so a custom role doesn't silently fail every role check.
export type UserRole = 'admin' | 'reception' | 'doctor' | 'lab' | 'pharmacy' | 'reports' | 'cashier' | 'accountant' | 'finance_manager' | 'auditor' | 'procurement' | 'nurse' | string;

export type ClinicName = 'IntelliCare' | string;

export interface AccessibleBranch {
  id: number;
  name: string;
  facilityId?: number | null;
  isPrimary?: boolean;
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  clinic: ClinicName;
  branchId?: number | null;
  primaryBranchId?: number | null;
  primaryBranchName?: string | null;
  accessibleBranches?: AccessibleBranch[];
  isAdmin?: boolean;
  id?: string;
  isActive?: boolean;
  currentRoomId?: string | null;
  // Resolved role_privileges grants for this user's role, from the login/verify
  // response (src/server/routes/auth.js buildUserResponse) — empty for admin,
  // which bypasses on isAdmin instead. See useAuth().hasPrivilege.
  privileges?: string[];
  // Extra roles granted on top of `role` (Setup > Security > Roles &
  // Privileges) — `privileges` above already includes their grants unioned
  // in, so most code should just use hasPrivilege() rather than reading this
  // directly. Present mainly for displaying/editing what's assigned.
  additionalRoles?: string[];
  // The login code for this tenant (e.g. "dpoc") — from the JWT's clientCode claim, via
  // auth.js's /login and /verify. Only for tenant-specific feature gating (there is no
  // other way to tell tenants apart on the frontend); not a general-purpose identifier.
  tenantCode?: string;
}

export interface Patient {
  id: string;
  patientId: string; // Auto-generated display ID
  fullName?: string; // Computed field
  first_name?: string; // Database field
  last_name?: string; // Database field
  patientName?: string; // Alternative name field
  age?: number;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  occupation?: string;
  phoneNumber?: string;
  phone?: string; // Database field
  clinic?: ClinicName;
  registeredAt?: string;
  registeredBy?: string;
  beneficiaryType?: 'dpoc_staff' | 'contractors' | 'arm_group' | 'local_residents';
  // Enhanced MOH fields
  address?: {
    county?: string;
    payam?: string;
    boma?: string;
    village?: string;
  };
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed';
  educationLevel?: 'none' | 'primary' | 'secondary' | 'tertiary';
  nextOfKin?: {
    name: string;
    relationship: string;
    phoneNumber: string;
  };
  insuranceType?: 'none' | 'nhif' | 'private' | 'employer' | 'other';
  emergencyContact?: string;
}

export interface Visit {
  id: string;
  patientId: string;
  patientName: string;
  clinic: ClinicName;
  date: string;
  chiefComplaints: string;
  clinicalNotes: string;
  doctorId: string;
  doctorName: string;
  status: 'active' | 'completed' | 'inactive';
  labRequests?: string[];
  radiologyRequests?: string[];
  theatreRequests?: string[];
  vitals?: {
    bloodPressure?: string;
    pulse?: string;
    temperature?: string;
    respiratoryRate?: string;
    oxygenSaturation?: string;
    weight?: string;
    height?: string;
    bmi?: string;
    notes?: string;
  };
  // Enhanced MOH clinical assessment fields
  physicalExamination?: {
    generalAppearance?: string;
    consciousness?: 'alert' | 'drowsy' | 'unconscious';
    pallor?: 'none' | 'mild' | 'moderate' | 'severe';
    jaundice?: boolean;
    cyanosis?: boolean;
    dehydration?: 'none' | 'mild' | 'moderate' | 'severe';
    lymphNodes?: string;
    cardiovascular?: string;
    respiratory?: string;
    abdomen?: string;
    neurological?: string;
    musculoskeletal?: string;
    skin?: string;
  };
  treatmentPlan?: {
    medications?: string[];
    procedures?: string[];
    followUpDate?: string;
    referralTo?: string;
    admissionRequired?: boolean;
    dischargeInstructions?: string;
  };
  visitOutcome?: 'improved' | 'stable' | 'worsened' | 'referred' | 'admitted' | 'died';
  painScore?: number; // 0-10 scale
}

export interface Diagnosis {
  id: string;
  visitId: string;
  patientId: string;
  code: string;
  description: string;
  clinic: ClinicName;
  date: string;
  doctorId: string;
  doctorName: string;
  diseaseCategory?: 'tropical' | 'digestive' | 'respiratory' | 'urogenital' | 'cardiovascular' | 'cns_musculoskeletal' | 'dermatological' | 'surgery' | 'other';
  isTropicalDisease?: boolean;
  affectedSystem?: string;
  icd10Code?: string;
  severity?: 'mild' | 'moderate' | 'severe' | 'critical';
  isNotifiable?: boolean; // For disease surveillance
  outbreakRelated?: boolean;
}

export interface DrugInventory {
  id: string;
  drug_name: string;
  generic_name?: string;
  unit_of_measure: string;
  quantity_received: number;
  current_stock: number;
  expiry_date: string;
  batch_number?: string;
  reorder_level: number;
  unit_cost: number;
  selling_price: number;
  clinic_id: number;
  date_received: string;
  received_by: string;
}

export interface Dispensing {
  id: string;
  drugId: string;
  drugName: string;
  patientId: string;
  patientName: string;
  visitId: string;
  quantity: number;
  prescribedBy: string;
  dispensedBy: string;
  dispensed_at?: string;
  clinic: ClinicName;
  date: string;
}

export interface LabRequest {
  id: string;
  patient_id: string;
  patient_name: string;
  visit_id: string;
  test_name: string;
  test_code: string;
  requested_by: string;
  requested_at: string;
  status: 'pending' | 'partial' | 'completed' | 'results_sent';
  clinic_id: number;
  priority: 'normal' | 'urgent' | 'stat';
  notes?: string;
  created_at: string;
  updated_at?: string;
  // Legacy camelCase fields for backward compatibility
  patientId?: string;
  patientName?: string;
  visitId?: string;
  testType?: string;
  requestedBy?: string;
  requestedAt?: string;
  clinic?: ClinicName;
  lastSavedAt?: string;
  savedBy?: string;
}

export interface LabResult {
  id: string;
  requestId: string;
  patientId: string;
  patientName: string;
  testType: string;
  results: string;
  resultDate: string;
  performedBy: string;
  clinic: ClinicName;
  analyzerData?: string; // For CBC machine integration
  isPartial?: boolean;
  totalComponents?: number;
  completedComponents?: number;
  componentValues?: Array<{
    name: string;
    value: string;
    remark?: string;
    savedAt?: string;
  }>; // For component-based test results
}

export interface PatientQueue {
  id: string;
  patientId: string;
  patientDocId: string;
  patientName: string;
  age?: number;
  clinic: ClinicName;
  queuedAt: string;
  queuedBy: string;
  status: 'waiting' | 'in-consultation' | 'completed';
  priority?: 'normal' | 'urgent' | 'stat';
}

export interface LabTestComponent {
  name: string;
  unit: string;
  normalRangeMin?: number;
  normalRangeMax?: number;
  normalRangeText?: string;
  // Database fields for compatibility
  component_name?: string;
  reference_range?: string;
}

export interface LabTest {
  id: string;
  testName?: string;
  test_name?: string;
  testCode?: string;
  test_code?: string;
  category: string;
  price?: number;
  service_id?: number;
  machine_integration?: string | null;
  clinic?: ClinicName;
  clinic_id?: number;
  branch_id?: number | null;
  components?: LabTestComponent[];
  createdAt?: string;
  created_at?: string;
  createdBy?: string;
  created_by?: string;
  is_active?: boolean;
}

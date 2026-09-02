/**
 * Test Data Fixtures for E2E Tests
 */

export const TEST_USERS = {
  admin: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'admin',
    displayName: 'Admin User'
  },
  doctor: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'doctor',
    displayName: 'Dr. Smith'
  },
  nurse: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'nurse',
    displayName: 'Nurse Johnson'
  },
  pharmacist: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'pharmacy',
    displayName: 'Pharmacist Brown'
  },
  lab: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'lab',
    displayName: 'Lab Tech Davis'
  },
  reception: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'reception',
    displayName: 'Receptionist Wilson'
  },
  cashier: {
    email: 'kembe699@gmail.com',
    password: process.env.E2E_PASSWORD || 'ChangeMe123!',
    role: 'cashier',
    displayName: 'Cashier Martinez'
  }
};

export const TEST_PATIENTS = {
  walkIn: {
    fullName: 'John Test Patient',
    age: '35',
    gender: 'male',
    phoneNumber: '+211912345678',
    occupation: 'Teacher'
  },
  withScheme: {
    fullName: 'Jane Scheme Patient',
    age: '28',
    gender: 'female',
    phoneNumber: '+211912345679',
    occupation: 'Nurse',
    beneficiaryType: 'nhif',
    memberNumber: 'NHIF123456'
  },
  emergency: {
    fullName: 'Emergency Test Patient',
    age: '45',
    gender: 'male',
    phoneNumber: '+211912345680',
    occupation: 'Driver'
  }
};

export const TEST_MEDICATIONS = [
  {
    name: 'Paracetamol 500mg',
    dosage: '2 tablets',
    frequency: 'Three times daily',
    duration: '5 days',
    instructions: 'Take after meals'
  },
  {
    name: 'Amoxicillin 250mg',
    dosage: '1 capsule',
    frequency: 'Three times daily',
    duration: '7 days',
    instructions: 'Complete the course'
  },
  {
    name: 'Ibuprofen 400mg',
    dosage: '1 tablet',
    frequency: 'Twice daily',
    duration: '3 days',
    instructions: 'Take with food'
  }
];

export const TEST_LAB_TESTS = [
  'Complete Blood Count (CBC)',
  'Malaria Test',
  'Blood Sugar (Random)',
  'Urinalysis',
  'Liver Function Test'
];

export const TEST_SERVICES = [
  {
    name: 'General Consultation',
    price: 5000
  },
  {
    name: 'Specialist Consultation',
    price: 10000
  },
  {
    name: 'Emergency Consultation',
    price: 15000
  }
];

export const TEST_VITALS = {
  bloodPressure: '120/80',
  temperature: '37.0',
  pulse: '72',
  respiratoryRate: '16',
  weight: '70',
  height: '175',
  oxygenSaturation: '98'
};

export const TEST_DIAGNOSIS = {
  diagnosis: 'Upper Respiratory Tract Infection',
  diagnosisCode: 'J06.9',
  chiefComplaint: 'Cough and fever for 3 days',
  clinicalNotes: 'Patient presents with productive cough, mild fever, and sore throat. No difficulty breathing. Chest clear on auscultation.'
};

/**
 * Generate unique test data with timestamp
 */
export function generateUniquePatient(base = TEST_PATIENTS.walkIn) {
  const timestamp = Date.now();
  return {
    ...base,
    fullName: `${base.fullName} ${timestamp}`,
    phoneNumber: `+211${timestamp.toString().slice(-9)}`
  };
}

/**
 * Generate unique email for test users
 */
export function generateUniqueEmail(prefix: string) {
  return `${prefix}+${Date.now()}@hospital.com`;
}

/**
 * Wait helper for delays in tests
 */
export function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface MOHDiagnosis {
  id: string;
  name: string;
  icd10Code: string;
  category: 'tropical' | 'digestive' | 'respiratory' | 'urogenital' | 'cardiovascular' | 'cns_musculoskeletal' | 'dermatological' | 'surgery' | 'other';
  affectedSystem: string;
  isTropicalDisease: boolean;
  isNotifiable: boolean;
}

export const MOH_DIAGNOSES: MOHDiagnosis[] = [
  // Tropical Diseases
  { id: '1', name: 'Malaria', icd10Code: 'B54', category: 'tropical', affectedSystem: 'Systemic', isTropicalDisease: true, isNotifiable: true },
  { id: '2', name: 'Typhoid Fever', icd10Code: 'A01.0', category: 'tropical', affectedSystem: 'Digestive System', isTropicalDisease: true, isNotifiable: true },
  { id: '3', name: 'Brucellosis', icd10Code: 'A23.9', category: 'tropical', affectedSystem: 'Systemic', isTropicalDisease: true, isNotifiable: true },
  { id: '4', name: 'Hepatitis B', icd10Code: 'B16.9', category: 'tropical', affectedSystem: 'Digestive System', isTropicalDisease: true, isNotifiable: true },
  { id: '5', name: 'Worm Infestation', icd10Code: 'B83.9', category: 'tropical', affectedSystem: 'Digestive System', isTropicalDisease: true, isNotifiable: false },
  { id: '6', name: 'Bilharziasis (Schistosomiasis)', icd10Code: 'B65.9', category: 'tropical', affectedSystem: 'Urogenital System', isTropicalDisease: true, isNotifiable: true },
  { id: '7', name: 'Bee Sting', icd10Code: 'T63.4', category: 'other', affectedSystem: 'Dermatological System', isTropicalDisease: true, isNotifiable: false },

  // Urogenital System
  { id: '8', name: 'STD/STI', icd10Code: 'A64', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: true },
  { id: '9', name: 'Abortion', icd10Code: 'O06.9', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },
  { id: '10', name: 'PIH (Pregnancy Induced Hypertension)', icd10Code: 'O13', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },
  { id: '11', name: 'Retention of Placenta', icd10Code: 'O73.0', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },
  { id: '12', name: 'Dysmenorrhea', icd10Code: 'N94.6', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },
  { id: '13', name: 'APH/PPH (Antepartum/Postpartum Hemorrhage)', icd10Code: 'O72.1', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },
  { id: '14', name: 'UTI (Urinary Tract Infection)', icd10Code: 'N39.0', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },
  { id: '15', name: 'PID (Pelvic Inflammatory Disease)', icd10Code: 'N73.9', category: 'urogenital', affectedSystem: 'Urogenital System', isTropicalDisease: false, isNotifiable: false },

  // Cardiovascular Diseases
  { id: '16', name: 'Congestive Heart Failure', icd10Code: 'I50.9', category: 'cardiovascular', affectedSystem: 'Cardiovascular System', isTropicalDisease: false, isNotifiable: false },
  { id: '17', name: 'Hypertension', icd10Code: 'I10', category: 'cardiovascular', affectedSystem: 'Cardiovascular System', isTropicalDisease: false, isNotifiable: false },
  { id: '18', name: 'Anemia', icd10Code: 'D64.9', category: 'cardiovascular', affectedSystem: 'Cardiovascular System', isTropicalDisease: false, isNotifiable: false },

  // CNS and Musculoskeletal Diseases
  { id: '19', name: 'Meningitis', icd10Code: 'G03.9', category: 'cns_musculoskeletal', affectedSystem: 'CNS & Musculoskeletal system', isTropicalDisease: false, isNotifiable: true },
  { id: '20', name: 'Paralysis of Legs', icd10Code: 'G82.20', category: 'cns_musculoskeletal', affectedSystem: 'CNS & Musculoskeletal system', isTropicalDisease: false, isNotifiable: false },
  { id: '21', name: 'Epilepsy', icd10Code: 'G40.9', category: 'cns_musculoskeletal', affectedSystem: 'CNS & Musculoskeletal system', isTropicalDisease: false, isNotifiable: false },
  { id: '22', name: 'Low Back Pain', icd10Code: 'M54.5', category: 'cns_musculoskeletal', affectedSystem: 'CNS & Musculoskeletal system', isTropicalDisease: false, isNotifiable: false },
  { id: '23', name: 'Shoulder Joint Dislocation', icd10Code: 'S43.006A', category: 'cns_musculoskeletal', affectedSystem: 'CNS & Musculoskeletal system', isTropicalDisease: false, isNotifiable: false },
  { id: '24', name: 'Arthritis', icd10Code: 'M13.9', category: 'cns_musculoskeletal', affectedSystem: 'CNS & Musculoskeletal system', isTropicalDisease: false, isNotifiable: false },

  // Respiratory System
  { id: '25', name: 'URTI (Upper Respiratory Tract Infection)', icd10Code: 'J06.9', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: false },
  { id: '26', name: 'Common Cold', icd10Code: 'J00', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: false },
  { id: '27', name: 'Pneumonia', icd10Code: 'J18.9', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: true },
  { id: '28', name: 'Asthma', icd10Code: 'J45.9', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: false },
  { id: '29', name: 'Tuberculosis', icd10Code: 'A15.9', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: true },

  // Digestive System
  { id: '30', name: 'Diarrhea', icd10Code: 'K59.1', category: 'digestive', affectedSystem: 'Digestive System', isTropicalDisease: false, isNotifiable: false },
  { id: '31', name: 'Dysentery', icd10Code: 'A09', category: 'digestive', affectedSystem: 'Digestive System', isTropicalDisease: false, isNotifiable: true },
  { id: '32', name: 'Gastritis', icd10Code: 'K29.70', category: 'digestive', affectedSystem: 'Digestive System', isTropicalDisease: false, isNotifiable: false },
  { id: '33', name: 'Peptic Ulcer', icd10Code: 'K27.9', category: 'digestive', affectedSystem: 'Digestive System', isTropicalDisease: false, isNotifiable: false },
  { id: '34', name: 'Ascites', icd10Code: 'R18.8', category: 'digestive', affectedSystem: 'Digestive System', isTropicalDisease: false, isNotifiable: false },

  // Others
  { id: '35', name: 'Hypoglycemia', icd10Code: 'E16.2', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: false },
  { id: '36', name: 'Diabetes', icd10Code: 'E11.9', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: false },
  { id: '37', name: 'Hysteria (HYS)', icd10Code: 'F44.9', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: false },
  { id: '38', name: 'Malnutrition', icd10Code: 'E46', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: true },
  { id: '39', name: 'Conjunctivitis', icd10Code: 'H10.9', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: false },
  { id: '40', name: 'Jaundice', icd10Code: 'R17', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: false },

  // Skin Diseases
  { id: '41', name: 'All Skin Diseases', icd10Code: 'L98.9', category: 'dermatological', affectedSystem: 'Dermatological System', isTropicalDisease: false, isNotifiable: false },
  { id: '42', name: 'Allergy', icd10Code: 'T78.40XA', category: 'dermatological', affectedSystem: 'Dermatological System', isTropicalDisease: false, isNotifiable: false },
  { id: '43', name: 'Dermatitis', icd10Code: 'L30.9', category: 'dermatological', affectedSystem: 'Dermatological System', isTropicalDisease: false, isNotifiable: false },
  { id: '44', name: 'Fungal Infections', icd10Code: 'B49', category: 'dermatological', affectedSystem: 'Dermatological System', isTropicalDisease: false, isNotifiable: false },
  { id: '45', name: 'Scabies', icd10Code: 'B86', category: 'dermatological', affectedSystem: 'Dermatological System', isTropicalDisease: false, isNotifiable: false },
  { id: '46', name: 'Cellulitis', icd10Code: 'L03.90', category: 'dermatological', affectedSystem: 'Dermatological System', isTropicalDisease: false, isNotifiable: false },

  // Surgery Cases
  { id: '47', name: 'Gun Shot Wound', icd10Code: 'T14.1', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: true },
  { id: '48', name: 'Trauma', icd10Code: 'T14.90XA', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '49', name: 'Wounds', icd10Code: 'T14.1', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '50', name: 'Burns', icd10Code: 'T30.0', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '51', name: 'Appendicitis', icd10Code: 'K37', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '52', name: 'Hernia', icd10Code: 'K46.9', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '53', name: 'Abscess', icd10Code: 'L02.91', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '54', name: 'Lipoma', icd10Code: 'D17.9', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '55', name: 'Hemorrhoid', icd10Code: 'K64.9', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },

  // Additional Common Diagnoses
  { id: '56', name: 'Sinusitis (Allergic Rhinitis)', icd10Code: 'J30.9', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: false },
  { id: '57', name: 'Septicemia', icd10Code: 'A41.9', category: 'other', affectedSystem: 'Systemic', isTropicalDisease: false, isNotifiable: true },
  { id: '58', name: 'Mumps', icd10Code: 'B26.9', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: true },
  { id: '59', name: 'Dog Bite', icd10Code: 'W54.0XXA', category: 'surgery', affectedSystem: 'Surgery cases- all systems', isTropicalDisease: false, isNotifiable: false },
  { id: '60', name: 'Dental Caries', icd10Code: 'K02.9', category: 'other', affectedSystem: 'Others', isTropicalDisease: false, isNotifiable: false },
  { id: '61', name: 'Tonsillitis', icd10Code: 'J03.90', category: 'respiratory', affectedSystem: 'Respiratory system', isTropicalDisease: false, isNotifiable: false }
];

// Function to get diagnosis by ID
export const getDiagnosisById = (id: string): MOHDiagnosis | undefined => {
  return MOH_DIAGNOSES.find(diagnosis => diagnosis.id === id);
};

// Function to get diagnoses by category
export const getDiagnosesByCategory = (category: MOHDiagnosis['category']): MOHDiagnosis[] => {
  return MOH_DIAGNOSES.filter(diagnosis => diagnosis.category === category);
};

// Function to get tropical diseases
export const getTropicalDiseases = (): MOHDiagnosis[] => {
  return MOH_DIAGNOSES.filter(diagnosis => diagnosis.isTropicalDisease);
};

// Function to get notifiable diseases
export const getNotifiableDiseases = (): MOHDiagnosis[] => {
  return MOH_DIAGNOSES.filter(diagnosis => diagnosis.isNotifiable);
};

// Function to search diagnoses
export const searchDiagnoses = (searchTerm: string): MOHDiagnosis[] => {
  const term = searchTerm.toLowerCase();
  return MOH_DIAGNOSES.filter(diagnosis => 
    diagnosis.name.toLowerCase().includes(term) ||
    diagnosis.icd10Code.toLowerCase().includes(term) ||
    diagnosis.affectedSystem.toLowerCase().includes(term)
  );
};

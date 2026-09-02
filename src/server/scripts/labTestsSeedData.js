// Curated from "MedicentreV3  Lab Tests.csv" at the repo root — rows with a
// zero Rate excluded (nothing to charge, not a real offered test), each given a
// generated test_code and a category inferred from its name (this source sheet
// has no category column of its own). "service" is the sheet's own Service
// column — the seeder finds-or-creates a matching Service and links lab_tests.service_id
// to it, so every seeded test arrives already billable.
//
// Every test also carries a real "components" panel — the actual parameters a
// lab reports for that test (e.g. CBC's 20-parameter differential, Urine
// General's dipstick + microscopy fields), not a single placeholder row named
// after the test. Multi-analyte panels (CBC, Stool General, Urine General,
// Urine for S/A, BFFM, Electrolyte, Widal, Semen Analysis, Renal Function)
// list each analyte; single-analyte tests (most Chemistry/Serology) still get
// one component, but with the test's own realistic reference range and unit
// filled in rather than left blank.
const labTestsSeed = [
  { code: 'UREA', name: 'Urea', category: 'Chemistry', price: 25000.0, service: 'Urea', components: [
    { name: 'Urea', unit: 'mg/dL', range: '15-50' },
  ] },
  { code: 'VDRL', name: 'VDRL', category: 'Serology', price: 20000.0, service: 'VDRL', components: [
    { name: 'VDRL', unit: '', range: 'Non-Reactive' },
  ] },
  { code: 'URINECUL', name: 'URINE CULTURE AND SENSITIVITY', category: 'Microbiology', price: 120000.0, service: 'Urine for C/S', components: [
    { name: 'Organism Isolated', unit: '', range: 'No Growth' },
    { name: 'Colony Count', unit: 'CFU/mL', range: '<10,000' },
    { name: 'Antibiotic Sensitivity', unit: '', range: '-' },
  ] },
  { code: 'URINEGEN', name: 'Urine General', category: 'Urinalysis', price: 20000.0, service: 'Urine General', components: [
    { name: 'Colour', unit: '', range: '-' },
    { name: 'Reaction', unit: '', range: '-' },
    { name: 'Leucocyte', unit: '', range: '-' },
    { name: 'Blood', unit: '', range: '-' },
    { name: 'Ketone', unit: '', range: '-' },
    { name: 'PH', unit: '', range: '-' },
    { name: 'Protein', unit: '', range: '-' },
    { name: 'Urobilinogen', unit: '', range: '-' },
    { name: 'Sugar', unit: '', range: '-' },
    { name: 'Bilirubin', unit: '', range: '-' },
    { name: 'Specific Gravity', unit: '', range: '-' },
    { name: 'Pus', unit: '/HPF', range: '-' },
    { name: 'RBCs', unit: '/HPF', range: '-' },
    { name: 'Epithelial Cells', unit: '/LPF', range: '-' },
    { name: 'Crystal', unit: '', range: '-' },
    { name: 'Cast', unit: '', range: '-' },
    { name: 'Others', unit: '', range: '-' },
  ] },
  { code: 'URINEFOR', name: 'Urine for S/A', category: 'Urinalysis', price: 20000.0, service: 'Urine for S/A', components: [
    { name: 'Urine Sugar', unit: '', range: '-' },
    { name: 'Urine Acetone', unit: '', range: '-' },
  ] },
  { code: 'URINEFOR2', name: 'Urine for Protien', category: 'Urinalysis', price: 20000.0, service: 'Urine for Protien', components: [
    { name: 'Protein', unit: '', range: 'Negative' },
  ] },
  { code: 'STOOLGEN', name: 'Stool General', category: 'Chemistry', price: 20000.0, service: 'Stool General', components: [
    { name: 'Colour', unit: '', range: '-' },
    { name: 'Consistency', unit: '', range: '-' },
    { name: 'Mucus', unit: '', range: '-' },
    { name: 'Blood', unit: '', range: '-' },
    { name: 'Worms', unit: '', range: '-' },
    { name: 'Pus', unit: '/HPF', range: '-' },
    { name: 'RBCs', unit: '/HPF', range: '-' },
    { name: 'Cyst', unit: '', range: '-' },
    { name: 'Trophozoite', unit: '', range: '-' },
    { name: 'Ova', unit: '', range: '-' },
    { name: 'Undigested Food', unit: '', range: '-' },
    { name: 'Motile Bacteria', unit: '', range: '-' },
    { name: 'Yeast Cells', unit: '', range: '-' },
  ] },
  { code: 'BFFM', name: 'BFFM', category: 'Parasitology', price: 20000.0, service: 'BFFM', components: [
    { name: 'BFFM', unit: '', range: '-' },
    { name: 'SPECIES', unit: '', range: '-' },
    { name: 'Stage', unit: '', range: '-' },
    { name: 'Density', unit: '', range: '-' },
  ] },
  { code: 'ICTFORMA', name: 'ICT for Malaria1', category: 'Parasitology', price: 20000.0, service: 'ICT for Malaria', components: [
    { name: 'ICT for Malaria', unit: '', range: 'Negative' },
  ] },
  { code: 'CBC', name: 'CBC', category: 'Hematology', price: 30000.0, service: 'CBC', components: [
    { name: 'WBC', unit: '10^9/L', range: '4.0-10.0' },
    { name: 'Lymph#', unit: '10^9/L', range: '0.8-4.0' },
    { name: 'Lymph%', unit: '%', range: '20.0-40.0' },
    { name: 'RBC', unit: '10^12/L', range: '3.50-5.50' },
    { name: 'HGB', unit: 'g/dl', range: '11.0-16.0' },
    { name: 'MCV', unit: 'fl', range: '80.0-100.0' },
    { name: 'MCH', unit: 'pg', range: '27.0-34.0' },
    { name: 'MCHC', unit: 'g/dl', range: '32.0-36.0' },
    { name: 'RDW-CV', unit: '%', range: '11.0-16.0' },
    { name: 'RDW-SD', unit: 'fl', range: '35.0-56.0' },
    { name: 'HCT', unit: '%', range: '37.0-54.0' },
    { name: 'PLT', unit: '10^9/L', range: '150-450' },
    { name: 'MPV', unit: 'fl', range: '6.5-12.0' },
    { name: 'PDW', unit: 'fl', range: '15.0-17.0' },
    { name: 'PCT', unit: '%', range: '0.108-0.282' },
    { name: 'P-LCR', unit: '%', range: '11.0-45.0' },
    { name: 'Gran#', unit: '10^9/L', range: '2.0-7.0' },
    { name: 'Gran%', unit: '%', range: '50.0-70.0' },
    { name: 'Mid#', unit: '10^9/L', range: '0.1-1.5' },
    { name: 'Mid%', unit: '%', range: '3.0-15.0' },
  ] },
  { code: 'ESR', name: 'ESR', category: 'Hematology', price: 20000.0, service: 'ESR', components: [
    { name: 'ESR', unit: 'mm/hr', range: '0-20' },
  ] },
  { code: 'BLOODGRO', name: 'Blood Group', category: 'Hematology', price: 20000.0, service: 'Blood Group', components: [
    { name: 'ABO Group', unit: '', range: '-' },
    { name: 'Rh Factor', unit: '', range: '-' },
  ] },
  { code: 'RTDSICTF', name: 'RTDS: ICT for Typhoid', category: 'Serology', price: 20000.0, service: 'RTDS: ICT for Typhoid', components: [
    { name: 'ICT for Typhoid', unit: '', range: 'Negative' },
  ] },
  { code: 'HPYLORIF', name: 'H.pylori for Serum', category: 'Serology', price: 20000.0, service: 'H.pylori for Serum', components: [
    { name: 'H.pylori (Serum)', unit: '', range: 'Negative' },
  ] },
  { code: 'HPYLORIF2', name: 'H.pylori for Stool', category: 'Serology', price: 20000.0, service: 'H.pylori for Stool', components: [
    { name: 'H.pylori (Stool)', unit: '', range: 'Negative' },
  ] },
  { code: 'HCGFORSE', name: 'HCG for Serum', category: 'Serology', price: 20000.0, service: 'HCG for Serum', components: [
    { name: 'HCG (Serum)', unit: '', range: 'Negative' },
  ] },
  { code: 'HCGFORUR', name: 'HCG for Urine', category: 'Serology', price: 20000.0, service: 'HCG for Urine', components: [
    { name: 'HCG (Urine)', unit: '', range: 'Negative' },
  ] },
  { code: 'HIVP24', name: 'HIV/P24', category: 'Serology', price: 20000.0, service: 'HIV/P24', components: [
    { name: 'HIV/P24', unit: '', range: 'Non-Reactive' },
  ] },
  { code: 'HCV', name: 'HCV', category: 'Serology', price: 20000.0, service: 'HCV', components: [
    { name: 'HCV', unit: '', range: 'Non-Reactive' },
  ] },
  { code: 'HBSAG', name: 'HBsAg', category: 'Serology', price: 20000.0, service: 'HBsAg', components: [
    { name: 'HBsAg', unit: '', range: 'Non-Reactive' },
  ] },
  { code: 'ALT', name: 'ALT', category: 'Chemistry', price: 25000.0, service: 'ALT', components: [
    { name: 'ALT', unit: 'U/L', range: '7-56' },
  ] },
  { code: 'AST', name: 'AST', category: 'Chemistry', price: 25000.0, service: 'AST', components: [
    { name: 'AST', unit: 'U/L', range: '10-40' },
  ] },
  { code: 'ALP', name: 'ALP', category: 'Chemistry', price: 25000.0, service: 'ALP', components: [
    { name: 'ALP', unit: 'U/L', range: '44-147' },
  ] },
  { code: 'TPROTEIN', name: 'T.Protein', category: 'Chemistry', price: 25000.0, service: 'T.Protein', components: [
    { name: 'Total Protein', unit: 'g/dL', range: '6.0-8.3' },
  ] },
  { code: 'ALBUMIN', name: 'Albumin', category: 'Chemistry', price: 25000.0, service: 'Albumin', components: [
    { name: 'Albumin', unit: 'g/dL', range: '3.5-5.0' },
  ] },
  { code: 'TBILIRUB', name: 'T.Bilirubin', category: 'Chemistry', price: 25000.0, service: 'T.Bilirubin', components: [
    { name: 'Total Bilirubin', unit: 'mg/dL', range: '0.1-1.2' },
  ] },
  { code: 'DBILIRUB', name: 'D.Bilirubin', category: 'Chemistry', price: 25000.0, service: 'D.Bilirubin', components: [
    { name: 'Direct Bilirubin', unit: 'mg/dL', range: '0.0-0.3' },
  ] },
  { code: 'CREATINI', name: 'Creatinine', category: 'Chemistry', price: 25000.0, service: 'Creatinine', components: [
    { name: 'Creatinine', unit: 'mg/dL', range: '0.6-1.3' },
  ] },
  { code: 'URICACID', name: 'Uric acid', category: 'Chemistry', price: 25000.0, service: 'Uric acid', components: [
    { name: 'Uric Acid', unit: 'mg/dL', range: '3.4-7.0' },
  ] },
  { code: 'ELECTROL', name: 'Electrolyte (Na, K, Cl, P, PH)', category: 'Chemistry', price: 25000.0, service: 'Electrolyte', components: [
    { name: 'Sodium (Na)', unit: 'mmol/L', range: '135-145' },
    { name: 'Potassium (K)', unit: 'mmol/L', range: '3.5-5.1' },
    { name: 'Chloride (Cl)', unit: 'mmol/L', range: '98-107' },
    { name: 'Phosphate (P)', unit: 'mg/dL', range: '2.5-4.5' },
    { name: 'PH', unit: '', range: '7.35-7.45' },
  ] },
  { code: 'TOTALCHO', name: 'Total Cholestrol', category: 'Chemistry', price: 25000.0, service: 'Total Cholestrol', components: [
    { name: 'Total Cholesterol', unit: 'mg/dL', range: '125-200' },
  ] },
  { code: 'TRIGLYCE', name: 'Triglyceride', category: 'Chemistry', price: 25000.0, service: 'Triglyceride', components: [
    { name: 'Triglyceride', unit: 'mg/dL', range: '0-150' },
  ] },
  { code: 'HDL', name: 'HDL', category: 'Chemistry', price: 20000.0, service: 'HDL', components: [
    { name: 'HDL Cholesterol', unit: 'mg/dL', range: '40-60' },
  ] },
  { code: 'LDL', name: 'LDL', category: 'Chemistry', price: 20000.0, service: 'LDL', components: [
    { name: 'LDL Cholesterol', unit: 'mg/dL', range: '0-100' },
  ] },
  { code: 'PT', name: 'PT', category: 'Hematology', price: 60000.0, service: 'PTT', components: [
    { name: 'PT', unit: 'sec', range: '11-13.5' },
  ] },
  { code: 'PTT', name: 'PTT', category: 'Hematology', price: 60000.0, service: 'PTT', components: [
    { name: 'PTT', unit: 'sec', range: '25-35' },
  ] },
  { code: 'INR', name: 'INR', category: 'Hematology', price: 60000.0, service: 'INR', components: [
    { name: 'INR', unit: '', range: '0.8-1.1' },
  ] },
  { code: 'WIDALFOR', name: 'Widal for Entrica', category: 'Serology', price: 20000.0, service: 'Widal for Entrica', components: [
    { name: 'TO (S. typhi O)', unit: 'titer', range: '<1:80' },
    { name: 'TH (S. typhi H)', unit: 'titer', range: '<1:80' },
    { name: 'AH (S. paratyphi A H)', unit: 'titer', range: '<1:80' },
    { name: 'BH (S. paratyphi B H)', unit: 'titer', range: '<1:80' },
  ] },
  { code: 'WIDALFOR2', name: 'Widal for Brucellosis', category: 'Serology', price: 20000.0, service: 'Widal for Brucellosis', components: [
    { name: 'Brucella abortus', unit: 'titer', range: '<1:80' },
    { name: 'Brucella melitensis', unit: 'titer', range: '<1:80' },
  ] },
  { code: 'RHEUMATO', name: 'Rheumatoid Factor', category: 'Serology', price: 20000.0, service: 'Rheumatoid Factor', components: [
    { name: 'Rheumatoid Factor', unit: 'IU/mL', range: '0-14' },
  ] },
  { code: 'ASOTITER', name: 'ASO TITER', category: 'Serology', price: 20000.0, service: 'ASO TITER', components: [
    { name: 'ASO Titer', unit: 'IU/mL', range: '0-200' },
  ] },
  { code: 'CRP', name: 'CRP', category: 'Chemistry', price: 70000.0, service: 'CRP', components: [
    { name: 'CRP', unit: 'mg/L', range: '0-10' },
  ] },
  { code: 'RBG', name: 'RBG', category: 'Chemistry', price: 25000.0, service: 'RBG', components: [
    { name: 'Random Blood Glucose', unit: 'mg/dL', range: '70-140' },
  ] },
  { code: 'FBG', name: 'FBG', category: 'Chemistry', price: 25000.0, service: 'FBG', components: [
    { name: 'Fasting Blood Glucose', unit: 'mg/dL', range: '70-100' },
  ] },
  { code: '2HPP', name: '2HPP', category: 'Chemistry', price: 25000.0, service: '2HPP', components: [
    { name: '2-Hour Postprandial Glucose', unit: 'mg/dL', range: '70-140' },
  ] },
  { code: 'HBALC', name: 'HbAlc', category: 'Chemistry', price: 70000.0, service: 'HbA1c', components: [
    { name: 'HbA1c', unit: '%', range: '4.0-5.6' },
  ] },
  { code: 'CKMB', name: 'CK-MB', category: 'Chemistry', price: 90000.0, service: 'CK-MB', components: [
    { name: 'CK-MB', unit: 'U/L', range: '0-25' },
  ] },
  { code: 'TSH', name: 'TSH', category: 'Chemistry', price: 80000.0, service: 'TSH', components: [
    { name: 'TSH', unit: 'mIU/L', range: '0.4-4.0' },
  ] },
  { code: 'T3', name: 'T3', category: 'Chemistry', price: 80000.0, service: 'T3', components: [
    { name: 'T3', unit: 'ng/dL', range: '80-200' },
  ] },
  { code: 'T4', name: 'T4', category: 'Chemistry', price: 80000.0, service: 'T4', components: [
    { name: 'T4', unit: 'µg/dL', range: '5.0-12.0' },
  ] },
  { code: 'PRL', name: 'PRL', category: 'Chemistry', price: 75000.0, service: 'PRL', components: [
    { name: 'Prolactin', unit: 'ng/mL', range: '2.0-29.0' },
  ] },
  { code: 'FSH', name: 'FSH', category: 'Chemistry', price: 70000.0, service: 'FSH', components: [
    { name: 'FSH', unit: 'mIU/mL', range: '1.5-12.4' },
  ] },
  { code: 'LH', name: 'LH', category: 'Chemistry', price: 70000.0, service: 'LH', components: [
    { name: 'LH', unit: 'mIU/mL', range: '1.7-8.6' },
  ] },
  { code: 'AMH', name: 'AMH', category: 'Chemistry', price: 80000.0, service: 'AMH', components: [
    { name: 'AMH', unit: 'ng/mL', range: '1.0-4.0' },
  ] },
  { code: 'SEMENANA', name: 'Semen analysis', category: 'Chemistry', price: 300000.0, service: 'Semen analysis', components: [
    { name: 'Volume', unit: 'mL', range: '1.5-5.0' },
    { name: 'pH', unit: '', range: '7.2-8.0' },
    { name: 'Sperm Count', unit: 'million/mL', range: '15-200' },
    { name: 'Motility', unit: '%', range: '40-100' },
    { name: 'Normal Morphology', unit: '%', range: '4-100' },
  ] },
  { code: 'VIRALLOA', name: 'Viral Load for HBV', category: 'Serology', price: 350000.0, service: 'Viral Load For HBV', components: [
    { name: 'HBV Viral Load', unit: 'IU/mL', range: '<20' },
  ] },
  { code: 'VIRALLOA2', name: 'Viral Load for HCV', category: 'Serology', price: 350000.0, service: 'Viral Load For HCV', components: [
    { name: 'HCV Viral Load', unit: 'IU/mL', range: '<15' },
  ] },
  { code: 'RENALFUN', name: 'Renal Functions Test', category: 'Chemistry', price: 75000.0, service: 'Renal Functions Test', components: [
    { name: 'Urea', unit: 'mg/dL', range: '15-50' },
    { name: 'Creatinine', unit: 'mg/dL', range: '0.6-1.3' },
    { name: 'Uric Acid', unit: 'mg/dL', range: '3.4-7.0' },
    { name: 'Sodium (Na)', unit: 'mmol/L', range: '135-145' },
    { name: 'Potassium (K)', unit: 'mmol/L', range: '3.5-5.1' },
  ] },
  // Not their own priced line in the source sheet — it only lists the
  // individual liver enzymes/lipids below at Rate=0 under a "Liver Function
  // Test: ..." prefix — but a bundled panel order is standard real-lab
  // practice, so these two are added as their own billable tests, bundling
  // the same analytes already seeded individually above.
  { code: 'LIVERPROF', name: 'Liver Profile', category: 'Chemistry', price: 150000.0, service: 'Liver Profile', components: [
    { name: 'ALT', unit: 'U/L', range: '7-56' },
    { name: 'AST', unit: 'U/L', range: '10-40' },
    { name: 'ALP', unit: 'U/L', range: '44-147' },
    { name: 'Total Protein', unit: 'g/dL', range: '6.0-8.3' },
    { name: 'Albumin', unit: 'g/dL', range: '3.5-5.0' },
    { name: 'Total Bilirubin', unit: 'mg/dL', range: '0.1-1.2' },
    { name: 'Direct Bilirubin', unit: 'mg/dL', range: '0.0-0.3' },
  ] },
  { code: 'LIPIDPROF', name: 'Lipid Profile', category: 'Chemistry', price: 80000.0, service: 'Lipid Profile', components: [
    { name: 'Total Cholesterol', unit: 'mg/dL', range: '125-200' },
    { name: 'Triglyceride', unit: 'mg/dL', range: '0-150' },
    { name: 'HDL Cholesterol', unit: 'mg/dL', range: '40-60' },
    { name: 'LDL Cholesterol', unit: 'mg/dL', range: '0-100' },
  ] },
];

module.exports = { labTestsSeed };

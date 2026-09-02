-- Link Lab Tests to Services
-- This script matches lab tests with their corresponding services based on name similarity

DO $$
DECLARE
  lab_test_rec RECORD;
  service_rec RECORD;
BEGIN

-- FBC -> Complete Blood Count (CBC)
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Complete Blood Count%' OR service_name ILIKE '%CBC%' LIMIT 1)
WHERE test_code = 'FBC' AND clinic_id = 1;

-- Blood Group & Rh -> Blood Group & Rh
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Blood Group%Rh%' LIMIT 1)
WHERE test_code = 'BG-RH' AND clinic_id = 1;

-- Cross Matching -> Blood Group & Crossmatch
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Crossmatch%' LIMIT 1)
WHERE test_code = 'XM' AND clinic_id = 1;

-- Coagulation Profile
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Coagulation%' LIMIT 1)
WHERE test_code = 'COAG' AND clinic_id = 1;

-- FBS -> Blood Glucose (Fasting) or Fasting Blood Sugar
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Fasting%' AND service_name ILIKE '%Blood%' LIMIT 1)
WHERE test_code = 'FBS' AND clinic_id = 1;

-- RBS -> Random Blood Sugar
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Random%Blood%' LIMIT 1)
WHERE test_code = 'RBS' AND clinic_id = 1;

-- HbA1c
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%HbA1c%' OR service_name ILIKE '%Glycated%' LIMIT 1)
WHERE test_code = 'HBA1C' AND clinic_id = 1;

-- OGTT -> 2hrs Post Prandial or Glucose Tolerance
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Post Prandial%' OR service_name ILIKE '%Glucose Tolerance%' LIMIT 1)
WHERE test_code = 'OGTT' AND clinic_id = 1;

-- ALT/SGPT
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%ALT%' OR service_name ILIKE '%SGOT%' LIMIT 1)
WHERE test_code = 'ALT' AND clinic_id = 1;

-- AST/SGOT
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%AST%' OR service_name ILIKE '%SGOT%' LIMIT 1)
WHERE test_code = 'AST' AND clinic_id = 1;

-- ALP
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%ALP%' LIMIT 1)
WHERE test_code = 'ALP' AND clinic_id = 1;

-- Albumin
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Albumin%' LIMIT 1)
WHERE test_code = 'ALB' AND clinic_id = 1;

-- Blood Urea
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Blood Urea%' LIMIT 1)
WHERE test_code = 'UREA' AND clinic_id = 1;

-- Creatinine
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Creatinine%' LIMIT 1)
WHERE test_code = 'CREAT' AND clinic_id = 1;

-- CK-MB
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%CK-MB%' OR service_name ILIKE '%Creatinine Kinase%' LIMIT 1)
WHERE test_code = 'CKMB' AND clinic_id = 1;

-- CK Total
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name = 'CK' LIMIT 1)
WHERE test_code = 'CK' AND clinic_id = 1;

-- Troponin I
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Troponin%' LIMIT 1)
WHERE test_code = 'TROP-I' AND clinic_id = 1;

-- CRP
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%CRP%' LIMIT 1)
WHERE test_code = 'CRP' AND clinic_id = 1;

-- ASO
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%ASO%' LIMIT 1)
WHERE test_code = 'ASO' AND clinic_id = 1;

-- HIV
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%HIV%' LIMIT 1)
WHERE test_code = 'HIV' AND clinic_id = 1;

-- HBsAg
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Hepatitis B%' OR service_name ILIKE '%HBsAg%' LIMIT 1)
WHERE test_code = 'HBSAG' AND clinic_id = 1;

-- HCV
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Hepatitis C%' OR service_name ILIKE '%HCV%' LIMIT 1)
WHERE test_code = 'HCV' AND clinic_id = 1;

-- Widal
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Widal%' OR service_name ILIKE '%Typhoid%' LIMIT 1)
WHERE test_code = 'WIDAL' AND clinic_id = 1;

-- Malaria
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Malaria%' OR service_name ILIKE '%BF%Malaria%' LIMIT 1)
WHERE test_code = 'MALARIA' AND clinic_id = 1;

-- BHCG
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%BHCG%' OR service_name ILIKE '%Human Chorionic%' LIMIT 1)
WHERE test_code = 'BHCG' AND clinic_id = 1;

-- HCG Rapid (Pregnancy Test)
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Pregnancy Test%' OR service_name ILIKE '%HCG%' LIMIT 1)
WHERE test_code = 'HCG-RAPID' AND clinic_id = 1;

-- TSH
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%TSH%' OR service_name ILIKE '%Thyroid%' LIMIT 1)
WHERE test_code = 'TSH' AND clinic_id = 1;

-- FSH
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%FSH%' LIMIT 1)
WHERE test_code = 'FSH' AND clinic_id = 1;

-- LH
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%LH%' LIMIT 1)
WHERE test_code = 'LH' AND clinic_id = 1;

-- Prolactin
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Prolactin%' LIMIT 1)
WHERE test_code = 'PROL' AND clinic_id = 1;

-- Testosterone
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Testosterone%' LIMIT 1)
WHERE test_code = 'TESTO' AND clinic_id = 1;

-- Estradiol
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Estradiol%' OR service_name ILIKE '%E2%' LIMIT 1)
WHERE test_code = 'E2' AND clinic_id = 1;

-- Progesterone
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Progesterone%' LIMIT 1)
WHERE test_code = 'PROG' AND clinic_id = 1;

-- PSA
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%PSA%' OR service_name ILIKE '%Prostate%' LIMIT 1)
WHERE test_code = 'PSA' AND clinic_id = 1;

-- CA-125
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%CA-125%' OR service_name ILIKE '%Ovarian%' LIMIT 1)
WHERE test_code = 'CA-125' AND clinic_id = 1;

-- CA 19-9
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%CA19-9%' OR service_name ILIKE '%CA 19-9%' LIMIT 1)
WHERE test_code = 'CA19-9' AND clinic_id = 1;

-- CA 15-3
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%CA15-3%' OR service_name ILIKE '%CA 15-3%' LIMIT 1)
WHERE test_code = 'CA15-3' AND clinic_id = 1;

-- AFP
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%AFP%' OR service_name ILIKE '%Alpha-Fetoprotein%' LIMIT 1)
WHERE test_code = 'AFP' AND clinic_id = 1;

-- CEA
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%CEA%' LIMIT 1)
WHERE test_code = 'CEA' AND clinic_id = 1;

-- Chlamydia
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%Chlamydia%' LIMIT 1)
WHERE test_code = 'CHLAMYDIA' AND clinic_id = 1;

-- AMH
UPDATE lab_tests SET service_id = (SELECT id FROM services WHERE service_name ILIKE '%AMH%' OR service_name ILIKE '%Mullerian%' LIMIT 1)
WHERE test_code = 'AMH' AND clinic_id = 1;

RAISE NOTICE 'Lab tests linked to services successfully!';

END $$;

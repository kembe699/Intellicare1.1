-- Universal Hospital Lab Tests - PART 1 (Haematology to Lipid)
-- Safe to run multiple times
DO $$
DECLARE
  v uuid;
BEGIN


-- ESR
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('ESR (Erythrocyte Sedimentation Rate)','ESR','Haematology',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='ESR (Erythrocyte Sedimentation Rate)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'ESR','mm/hr','M:0-15 | F:0-20');

-- Peripheral Blood Film
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Peripheral Blood Film','PBF','Haematology',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Peripheral Blood Film' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'RBC Morphology','','Normal'),(v,'WBC Morphology','','Normal'),
(v,'Platelet Estimate','','Adequate'),(v,'Parasites','','None Seen');


-- Coagulation Profile
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Coagulation Profile','COAG','Haematology',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Coagulation Profile' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'PT (Prothrombin Time)','seconds','11.0 - 13.5'),(v,'APTT','seconds','25 - 35'),
(v,'INR','','0.8 - 1.2'),(v,'Fibrinogen','mg/dL','200 - 400'),
(v,'Bleeding Time (BT)','minutes','2 - 7'),(v,'Clotting Time (CT)','minutes','5 - 11');


-- Blood Group & Rh
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Blood Group & Rh Factor','BG-RH','Blood Bank',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Blood Group & Rh Factor' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'ABO Blood Group','','A / B / AB / O'),(v,'Rh Factor','','Positive / Negative');


-- Cross Matching
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Cross Matching','XM','Blood Bank',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Cross Matching' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Major Cross Match','','Compatible'),(v,'Minor Cross Match','','Compatible');


-- Direct Coombs Test
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Direct Coombs Test (DCT)','DCT','Blood Bank',20000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Direct Coombs Test (DCT)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Direct Coombs Test','','Negative');

-- Urine Analysis
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Urine Analysis (Urinalysis)','UA','Clinical Chemistry',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Urine Analysis (Urinalysis)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Colour','','Pale Yellow - Amber'),(v,'Clarity','','Clear'),
(v,'pH','','4.5 - 8.0'),(v,'Specific Gravity','','1.005 - 1.030'),
(v,'Protein','','Negative'),(v,'Glucose','','Negative'),
(v,'Ketones','','Negative'),(v,'Blood','','Negative'),
(v,'Bilirubin','','Negative'),(v,'Urobilinogen','EU/dL','0.1 - 1.0'),
(v,'Nitrite','','Negative'),(v,'Leukocyte Esterase','','Negative'),
(v,'WBC (Microscopy)','/HPF','0 - 5'),(v,'RBC (Microscopy)','/HPF','0 - 2'),
(v,'Epithelial Cells','/HPF','0 - 5'),(v,'Casts','','None'),(v,'Bacteria','','None/Rare');


-- ALT/SGPT
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('ALT/SGPT (Alanine Aminotransferase)','ALT','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='ALT/SGPT (Alanine Aminotransferase)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'ALT (SGPT)','U/L','M:7-56 | F:7-45');

-- AST/SGOT
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('AST/SGOT (Aspartate Aminotransferase)','AST','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='AST/SGOT (Aspartate Aminotransferase)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'AST (SGOT)','U/L','M:10-40 | F:9-32');

-- ALP
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('ALP (Alkaline Phosphatase)','ALP','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='ALP (Alkaline Phosphatase)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'ALP','U/L','44 - 147');

-- Total Bilirubin
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Total Bilirubin','TBIL','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Total Bilirubin' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Total Bilirubin','mg/dL','0.2 - 1.2'),(v,'Direct Bilirubin','mg/dL','0.0 - 0.3'),(v,'Indirect Bilirubin','mg/dL','0.1 - 1.0');


-- Total Protein
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Total Protein','TP','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Total Protein' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Total Protein','g/dL','6.4 - 8.3'),(v,'Albumin','g/dL','3.5 - 5.0'),
(v,'Globulin','g/dL','2.3 - 3.5'),(v,'A/G Ratio','','1.1 - 2.5');


-- GGT
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('GGT (Gamma-Glutamyl Transferase)','GGT','Clinical Chemistry',35000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='GGT (Gamma-Glutamyl Transferase)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'GGT','U/L','M:9-48 | F:5-29');

-- Serum Albumin
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Serum Albumin','ALB','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Serum Albumin' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Albumin','g/dL','3.5 - 5.0');

-- Urea
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Urea (Blood Urea Nitrogen)','UREA','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Urea (Blood Urea Nitrogen)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Blood Urea','mg/dL','15 - 45'),(v,'BUN','mg/dL','7 - 20');


-- Uric Acid
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Uric Acid','URIC','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Uric Acid' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Uric Acid','mg/dL','M:3.4-7.0 | F:2.4-6.0');

-- Serum Creatinine
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Serum Creatinine','CREAT','Clinical Chemistry',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Serum Creatinine' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Serum Creatinine','mg/dL','M:0.7-1.3 | F:0.6-1.1'),(v,'eGFR','mL/min/1.73m²','> 60');


-- RBS
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Random Blood Sugar (RBS)','RBS','Glucose',20000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Random Blood Sugar (RBS)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Random Blood Sugar','mg/dL','Normal: < 200');

-- FBS
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Fasting Blood Sugar (FBS)','FBS','Glucose',20000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Fasting Blood Sugar (FBS)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Fasting Blood Sugar','mg/dL','Normal:70-99 | Pre-DM:100-125 | DM:>=126');

-- OGTT
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Glucose Tolerance Test (OGTT)','OGTT','Glucose',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Glucose Tolerance Test (OGTT)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Fasting (0 hr)','mg/dL','70 - 99'),(v,'1 Hour','mg/dL','< 180'),
(v,'2 Hours','mg/dL','Normal:<140 | Pre-DM:140-199 | DM:>=200');


-- HbA1c
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('HbA1c (Glycated Haemoglobin)','HBA1C','Glucose',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='HbA1c (Glycated Haemoglobin)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'HbA1c','%','Normal:<5.7 | Pre-DM:5.7-6.4 | DM:>=6.5'),
(v,'Estimated Average Glucose (eAG)','mg/dL','< 114');


-- Total Cholesterol
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Total Cholesterol','TCHOL','Lipid',35000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Total Cholesterol' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Total Cholesterol','mg/dL','Desirable:<200 | Borderline:200-239 | High:>=240');

-- Triglycerides
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Triglycerides','TG','Lipid',35000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Triglycerides' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Triglycerides','mg/dL','Normal:<150 | Borderline:150-199 | High:200-499');

-- HDL Cholesterol
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('HDL Cholesterol','HDL','Lipid',35000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='HDL Cholesterol' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'HDL Cholesterol','mg/dL','M:>40 | F:>50 (Higher is better)'),
(v,'LDL Cholesterol','mg/dL','Optimal:<100 | Near Optimal:100-129'),
(v,'VLDL','mg/dL','5 - 40'),(v,'TC/HDL Ratio','','< 5.0');


END $$;

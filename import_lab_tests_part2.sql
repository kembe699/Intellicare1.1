-- Universal Hospital Lab Tests - PART 2 (Cardiac to Tumour Markers)
-- Safe to run multiple times
DO $$
DECLARE
  v uuid;
BEGIN

-- Troponin I
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Troponin I (cTnI)','TROP-I','Cardiac Marker',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Troponin I (cTnI)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Troponin I (cTnI)','ng/mL','Normal:<0.04 | Elevated:>=0.04');


-- CK-MB
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('CK-MB (Creatine Kinase-MB)','CKMB','Cardiac Marker',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='CK-MB (Creatine Kinase-MB)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'CK-MB','U/L','< 25'),(v,'CK Total','U/L','M:52-336 | F:38-176'),(v,'CK-MB Index','%','< 3.5');


-- Amylase
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Amylase','AMY','Pancreatic Profile',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Amylase' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Serum Amylase','U/L','28 - 100');

-- Lipase
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Lipase','LIP','Pancreatic Profile',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Lipase' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Serum Lipase','U/L','10 - 140');

-- HIV
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('HIV Test (HIV 1 & 2)','HIV','Serology & Immunology',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='HIV Test (HIV 1 & 2)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'HIV 1/2 Antibodies','','Non-Reactive');

-- HBsAg
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Hepatitis B Surface Antigen (HBsAg)','HBSAG','Serology & Immunology',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Hepatitis B Surface Antigen (HBsAg)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'HBsAg','','Non-Reactive');

-- HCV
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Hepatitis C Antibody (Anti-HCV)','HCV','Serology & Immunology',15000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Hepatitis C Antibody (Anti-HCV)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Anti-HCV Antibodies','','Non-Reactive');

-- Widal Test
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Widal Test (Typhoid)','WIDAL','Serology & Immunology',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Widal Test (Typhoid)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'S. typhi O','Titre','< 1:80 (Negative)'),(v,'S. typhi H','Titre','< 1:80 (Negative)'),
(v,'S. paratyphi AO','Titre','< 1:80 (Negative)'),(v,'S. paratyphi BH','Titre','< 1:80 (Negative)');


-- CRP
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('CRP (C-Reactive Protein)','CRP','Serology & Immunology',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='CRP (C-Reactive Protein)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'CRP Qualitative','','Negative'),(v,'CRP Quantitative','mg/L','< 6.0');


-- Rheumatoid Factor
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Rheumatoid Factor (RF)','RF','Serology & Immunology',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Rheumatoid Factor (RF)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Rheumatoid Factor','IU/mL','Negative: < 14');

-- Anti-CCP
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Anti-CCP (Anti-Cyclic Citrullinated Peptide)','ANTI-CCP','Serology & Immunology',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Anti-CCP (Anti-Cyclic Citrullinated Peptide)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Anti-CCP','U/mL','Negative: < 20');

-- Procalcitonin
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Procalcitonin (PCT)','PCT','Serology & Immunology',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Procalcitonin (PCT)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Procalcitonin','ng/mL','Normal:<0.5 | Possible Sepsis:0.5-2.0 | High Sepsis:>2.0');


-- Dengue
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Dengue NS1 Antigen & Antibody','DENGUE','Serology & Immunology',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Dengue NS1 Antigen & Antibody' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Dengue NS1 Antigen','','Non-Reactive'),(v,'Dengue IgM Antibody','','Non-Reactive'),(v,'Dengue IgG Antibody','','Non-Reactive');


-- H. Pylori
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('H. Pylori (Helicobacter Pylori)','H-PYLORI','Serology & Immunology',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='H. Pylori (Helicobacter Pylori)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'H. Pylori IgG Antibody','U/mL','Negative: < 12'),(v,'H. Pylori Stool Antigen','','Negative');


-- Malaria
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Malaria Antigen Test (RDT)','MALARIA','RIDT',20000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Malaria Antigen Test (RDT)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Plasmodium falciparum','','Negative'),(v,'Plasmodium vivax','','Negative'),(v,'Pan-Plasmodium','','Negative');


-- COVID-19
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('COVID-19 Antigen Test','COVID19','RIDT',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='COVID-19 Antigen Test' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'SARS-CoV-2 Antigen','','Negative');

-- Strep A
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Strep A (Group A Streptococcus)','STREP-A','RIDT',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Strep A (Group A Streptococcus)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Group A Streptococcus Antigen','','Negative');

-- HCG Rapid
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('HCG Pregnancy Test (Rapid)','HCG-RAPID','RIDT',20000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='HCG Pregnancy Test (Rapid)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'HCG (Urine)','','Negative (Non-Pregnant)');

-- Urine Culture & Sensitivity
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Urine Culture & Sensitivity','UCS','Microbiology & Parasitology',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Urine Culture & Sensitivity' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Colony Count','CFU/mL','< 10,000 (No Significant Growth)'),
(v,'Organism Identified','','No Growth'),(v,'Antibiotic Sensitivity','','N/A');


-- Stool M/E
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Stool Microscopy & Examination (M/E)','STOOL-ME','Microbiology & Parasitology',20000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Stool Microscopy & Examination (M/E)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Consistency','','Formed'),(v,'Colour','','Brown'),(v,'Blood','','Negative'),
(v,'Mucus','','Negative'),(v,'Ova / Cysts','','None Seen'),(v,'Parasites','','None Seen'),
(v,'Occult Blood','','Negative'),(v,'WBC','/HPF','0 - 2'),(v,'RBC','/HPF','0 - 2');


-- Sputum AFB
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Sputum AFB (Acid-Fast Bacilli)','AFB','Microbiology & Parasitology',25000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Sputum AFB (Acid-Fast Bacilli)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'AFB Smear (ZN Stain)','','Negative (No AFB Seen)'),(v,'Sputum Quality','','Adequate/Mucoid');


-- Vaginal Culture & Sensitivity
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Vaginal Culture & Sensitivity','VAG-CS','Microbiology & Parasitology',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Vaginal Culture & Sensitivity' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Gram Stain','','Normal Flora'),(v,'Culture Result','','No Significant Growth'),
(v,'Organism Identified','','None'),(v,'Antibiotic Sensitivity','','N/A'),
(v,'Clue Cells','','Absent'),(v,'Yeast/Hyphae','','Not Seen');


-- TB Gene Xpert
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('TB Gene Xpert (MTB/RIF)','GENEXPERT','Microbiology & Parasitology',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='TB Gene Xpert (MTB/RIF)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'MTB Detection','','Not Detected'),(v,'Rifampicin Resistance','','Not Detected');


-- TSH
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('TSH (Thyroid Stimulating Hormone)','TSH','Thyroid Function Test',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='TSH (Thyroid Stimulating Hormone)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'TSH','mIU/L','0.4 - 4.0');

-- Free T4
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Free T4 (Free Thyroxine)','FT4','Thyroid Function Test',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Free T4 (Free Thyroxine)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Free T4','pmol/L','9.0 - 24.0'),(v,'Free T3','pmol/L','3.5 - 7.8');


-- Testosterone
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Testosterone (Total)','TESTO','Reproductive Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Testosterone (Total)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Total Testosterone','ng/dL','M:300-1000 | F:15-70');

-- FSH
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('FSH (Follicle Stimulating Hormone)','FSH','Reproductive Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='FSH (Follicle Stimulating Hormone)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'FSH','mIU/mL','M:1.5-12.4 | F-Fol:3.5-12.5 | F-Mid:4.7-21.5 | F-Lut:1.7-7.7 | PM:25.8-134.8');


-- LH
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('LH (Luteinizing Hormone)','LH','Reproductive Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='LH (Luteinizing Hormone)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'LH','mIU/mL','M:1.7-8.6 | F-Fol:2.4-12.6 | F-Mid:14.0-95.6 | F-Lut:1.0-11.4 | PM:7.7-58.5');


-- Prolactin
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Prolactin','PROL','Reproductive Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Prolactin' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Prolactin','ng/mL','M:2.0-18.0 | F:2.8-29.2 | Pregnant:10-209');


-- Estradiol
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Estradiol (E2)','E2','Reproductive Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Estradiol (E2)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Estradiol (E2)','pg/mL','M:20-55 | F-Fol:20-350 | F-Mid:135-860 | F-Lut:35-570 | PM:<20');


-- Serum Beta HCG
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Serum Beta-HCG (Pregnancy)','BHCG','Reproductive Hormones',30000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Serum Beta-HCG (Pregnancy)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Beta-HCG','mIU/mL','Non-Pregnant: < 5 | Varies by gestational week');


-- Progesterone
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('Progesterone','PROG','Reproductive Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='Progesterone' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Progesterone','ng/mL','M:0.2-1.4 | F-Fol:0.1-0.9 | F-Lut:1.8-24.0 | PM:0.1-0.8');


-- PSA
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('PSA (Prostate Specific Antigen)','PSA','Fertility & Pregnancy Hormones',45000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='PSA (Prostate Specific Antigen)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'Total PSA','ng/mL','< 4.0'),(v,'Free PSA','ng/mL','> 25% of Total PSA'),
(v,'Free/Total PSA Ratio','%','> 25%');


-- CA-125
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('CA-125 (Ovarian Tumour Marker)','CA-125','Female Specific Tumour Markers',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='CA-125 (Ovarian Tumour Marker)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'CA-125','U/mL','< 35');

-- CA 19-9
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('CA 19-9 (Pancreatic/GI Tumour Marker)','CA19-9','Female Specific Tumour Markers',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='CA 19-9 (Pancreatic/GI Tumour Marker)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'CA 19-9','U/mL','< 37');

-- CA 15-3
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('CA 15-3 (Breast Tumour Marker)','CA15-3','General Tumour Markers',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='CA 15-3 (Breast Tumour Marker)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'CA 15-3','U/mL','< 31.3');

-- CEA
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('CEA (Carcinoembryonic Antigen)','CEA','General Tumour Markers',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='CEA (Carcinoembryonic Antigen)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'CEA','ng/mL','Non-smoker: < 3.0 | Smoker: < 5.0');

-- AFP
INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active) VALUES ('AFP (Alpha-Fetoprotein)','AFP','General Tumour Markers',65000,1,true) ON CONFLICT DO NOTHING RETURNING id INTO v;
IF v IS NULL THEN SELECT id INTO v FROM lab_tests WHERE test_name='AFP (Alpha-Fetoprotein)' AND clinic_id=1 LIMIT 1; END IF;
INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
(v,'AFP','ng/mL','< 7.0');

END $$;

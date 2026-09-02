DO $$
DECLARE
  v uuid;
BEGIN
  INSERT INTO lab_tests (test_name,test_code,category,price,clinic_id,is_active)
  VALUES ('Full Blood Count (FBC)','FBC','Haematology',20000,1,true)
  ON CONFLICT DO NOTHING RETURNING id INTO v;
  IF v IS NULL THEN
    SELECT id INTO v FROM lab_tests WHERE test_name='Full Blood Count (FBC)' AND clinic_id=1 LIMIT 1;
  END IF;

  INSERT INTO lab_test_components (lab_test_id,component_name,unit,reference_range) VALUES
  (v,'WBC (White Blood Cells)','x10³/µL','4.5 - 11.0'),
  (v,'RBC (Red Blood Cells)','x10⁶/µL','M: 4.5-5.5 | F: 3.8-5.2'),
  (v,'Haemoglobin (HGB)','g/dL','M: 13.5-17.5 | F: 12.0-16.0'),
  (v,'Haematocrit (HCT)','%','M: 41-53 | F: 36-46'),
  (v,'MCV','fL','80 - 100'),
  (v,'MCH','pg','27 - 33'),
  (v,'MCHC','g/dL','32 - 36'),
  (v,'RDW','%','11.5 - 14.5'),
  (v,'Platelets (PLT)','x10³/µL','150 - 400'),
  (v,'MPV (Mean Platelet Volume)','fL','7.5 - 12.5'),
  (v,'Neutrophils','%','50 - 70'),
  (v,'Neutrophils (Abs)','x10³/µL','1.8 - 7.7'),
  (v,'Lymphocytes','%','20 - 40'),
  (v,'Lymphocytes (Abs)','x10³/µL','1.0 - 4.8'),
  (v,'Monocytes','%','2 - 8'),
  (v,'Monocytes (Abs)','x10³/µL','0.0 - 0.8'),
  (v,'Eosinophils','%','1 - 4'),
  (v,'Eosinophils (Abs)','x10³/µL','0.0 - 0.45'),
  (v,'Basophils','%','0 - 1'),
  (v,'Basophils (Abs)','x10³/µL','0.0 - 0.2');
END $$;

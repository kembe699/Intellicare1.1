-- 1. Patient Bills
ALTER TABLE patient_bills ADD INDEX idx_pb_clinic_branch (clinic_id, branch_id);
ALTER TABLE patient_bills ADD INDEX idx_pb_status (status);
ALTER TABLE patient_bills ADD INDEX idx_pb_dates (created_at, due_date);
ALTER TABLE patient_bills ADD INDEX idx_pb_patient (patient_id);

-- 2. Invoices
ALTER TABLE invoices ADD INDEX idx_inv_clinic_branch (clinic_id, branch_id);
ALTER TABLE invoices ADD INDEX idx_inv_status (status);
ALTER TABLE invoices ADD INDEX idx_inv_dates (created_at, due_date);
ALTER TABLE invoices ADD INDEX idx_inv_patient (patient_id);

-- 3. Visits
ALTER TABLE visits ADD INDEX idx_v_branch (branch_id);
ALTER TABLE visits ADD INDEX idx_v_status (status);
ALTER TABLE visits ADD INDEX idx_v_date (visit_date);
ALTER TABLE visits ADD INDEX idx_v_clinic_date (clinic_id, visit_date);

-- 4. Lab Requests
ALTER TABLE lab_requests ADD INDEX idx_lr_branch (branch_id);
ALTER TABLE lab_requests ADD INDEX idx_lr_status (status);
ALTER TABLE lab_requests ADD INDEX idx_lr_dates (requested_at);
ALTER TABLE lab_requests ADD INDEX idx_lr_clinic_status (clinic_id, status);

-- 5. Patients
ALTER TABLE patients ADD INDEX idx_p_branch (branch_id);
ALTER TABLE patients ADD INDEX idx_p_created_at (created_at);

-- 6. Receipts
ALTER TABLE receipts ADD INDEX idx_rec_branch (branch_id);
ALTER TABLE receipts ADD INDEX idx_rec_clinic (clinic_id);
ALTER TABLE receipts ADD INDEX idx_rec_date (payment_date);

-- 7. Users
ALTER TABLE users ADD INDEX idx_u_branch (branch_id);
ALTER TABLE users ADD INDEX idx_u_clinic_role (clinic_id, role);

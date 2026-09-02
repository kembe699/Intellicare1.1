-- MySQL Schema for Universal HMIS
-- Based on the Sequelize models

-- Create database (uncomment if needed)
-- CREATE DATABASE IF NOT EXISTS universal_hmis;
-- USE universal_hmis;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  firebase_uid VARCHAR(50),
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  clinic_id INT,
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(50) DEFAULT 'active',
  last_login DATETIME,
  password_set_at DATETIME,
  created_at DATETIME NOT NULL,
  created_by VARCHAR(255),
  updated_at DATETIME,
  updated_by VARCHAR(255)
);

-- Clinic names table
CREATE TABLE IF NOT EXISTS clinic_names (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME
);

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
  id VARCHAR(36) PRIMARY KEY,
  patient_id VARCHAR(20) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  gender VARCHAR(10) NOT NULL,
  date_of_birth DATE,
  phone_number VARCHAR(20),
  address TEXT,
  next_of_kin_name VARCHAR(255),
  next_of_kin_phone VARCHAR(20),
  insurance_type VARCHAR(50),
  insurance_number VARCHAR(50),
  registration_date DATETIME NOT NULL,
  clinic_id INT,
  registered_by VARCHAR(36),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id),
  FOREIGN KEY (registered_by) REFERENCES users(id)
);

-- Visits table
CREATE TABLE IF NOT EXISTS visits (
  id VARCHAR(36) PRIMARY KEY,
  visit_date DATETIME NOT NULL,
  patient_id VARCHAR(36) NOT NULL,
  chief_complaint TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  completed_at DATETIME,
  clinic_id INT,
  doctor_id VARCHAR(36),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id),
  FOREIGN KEY (doctor_id) REFERENCES users(id)
);

-- Vitals table
CREATE TABLE IF NOT EXISTS vitals (
  id VARCHAR(36) PRIMARY KEY,
  visit_id VARCHAR(36) NOT NULL,
  blood_pressure VARCHAR(20),
  pulse_rate INT,
  respiratory_rate INT,
  temperature DECIMAL(5,2),
  oxygen_saturation INT,
  height DECIMAL(5,2),
  weight DECIMAL(5,2),
  bmi DECIMAL(5,2),
  blood_sugar DECIMAL(5,2),
  taken_at DATETIME,
  taken_by VARCHAR(36),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (taken_by) REFERENCES users(id)
);

-- Physical examination table
CREATE TABLE IF NOT EXISTS physical_examination (
  id VARCHAR(36) PRIMARY KEY,
  visit_id VARCHAR(36) NOT NULL,
  general_appearance TEXT,
  skin TEXT,
  head_and_neck TEXT,
  chest TEXT,
  cardiovascular TEXT,
  abdomen TEXT,
  genitourinary TEXT,
  rectal TEXT,
  extremities TEXT,
  neurological TEXT,
  other_findings TEXT,
  examined_by VARCHAR(36),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (examined_by) REFERENCES users(id)
);

-- Treatment plan table
CREATE TABLE IF NOT EXISTS treatment_plan (
  id VARCHAR(36) PRIMARY KEY,
  visit_id VARCHAR(36) NOT NULL,
  plan_details TEXT,
  created_by VARCHAR(36),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Treatment plan medications table
CREATE TABLE IF NOT EXISTS treatment_plan_medications (
  id VARCHAR(36) PRIMARY KEY,
  treatment_plan_id VARCHAR(36) NOT NULL,
  medication_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100),
  frequency VARCHAR(100),
  duration VARCHAR(100),
  instructions TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (treatment_plan_id) REFERENCES treatment_plan(id)
);

-- Treatment plan procedures table
CREATE TABLE IF NOT EXISTS treatment_plan_procedures (
  id VARCHAR(36) PRIMARY KEY,
  treatment_plan_id VARCHAR(36) NOT NULL,
  procedure_name VARCHAR(255) NOT NULL,
  instructions TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (treatment_plan_id) REFERENCES treatment_plan(id)
);

-- Diagnoses table
CREATE TABLE IF NOT EXISTS diagnoses (
  id VARCHAR(36) PRIMARY KEY,
  visit_id VARCHAR(36) NOT NULL,
  patient_id VARCHAR(36) NOT NULL,
  diagnosis_name VARCHAR(255) NOT NULL,
  diagnosis_type VARCHAR(50),
  category VARCHAR(100),
  notes TEXT,
  clinic_id INT,
  doctor_id VARCHAR(36),
  status VARCHAR(20) DEFAULT 'active',
  is_primary BOOLEAN DEFAULT false,
  diagnosed_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id),
  FOREIGN KEY (doctor_id) REFERENCES users(id)
);

-- Lab test categories table
CREATE TABLE IF NOT EXISTS lab_test_categories (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME
);

-- Lab tests table
CREATE TABLE IF NOT EXISTS lab_tests (
  id VARCHAR(36) PRIMARY KEY,
  test_name VARCHAR(255) NOT NULL,
  test_code VARCHAR(20) NOT NULL,
  category VARCHAR(100),
  category_id VARCHAR(36),
  clinic_id INT,
  created_by VARCHAR(36),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (category_id) REFERENCES lab_test_categories(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Lab test components table
CREATE TABLE IF NOT EXISTS lab_test_components (
  id VARCHAR(36) PRIMARY KEY,
  test_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50),
  normal_range_min DECIMAL(10,2),
  normal_range_max DECIMAL(10,2),
  normal_range_text TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (test_id) REFERENCES lab_tests(id)
);

-- Lab requests table
CREATE TABLE IF NOT EXISTS lab_requests (
  id VARCHAR(36) PRIMARY KEY,
  patient_id VARCHAR(36) NOT NULL,
  visit_id VARCHAR(36) NOT NULL,
  test_code VARCHAR(20) NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'routine',
  requested_at DATETIME NOT NULL,
  requested_by VARCHAR(36),
  clinic_id INT,
  notes TEXT,
  completed_at DATETIME,
  completed_by VARCHAR(36),
  component_values JSON,
  mindray_imported BOOLEAN DEFAULT false,
  mindray_imported_at DATETIME,
  last_saved_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (completed_by) REFERENCES users(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id)
);

-- Lab results table
CREATE TABLE IF NOT EXISTS lab_results (
  id VARCHAR(36) PRIMARY KEY,
  lab_request_id VARCHAR(36) NOT NULL,
  patient_id VARCHAR(36) NOT NULL,
  test_code VARCHAR(20) NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'complete',
  result_date DATETIME NOT NULL,
  performed_by VARCHAR(36),
  verified_by VARCHAR(36),
  clinic_id INT,
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (lab_request_id) REFERENCES lab_requests(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (performed_by) REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES users(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id)
);

-- Lab result component values table
CREATE TABLE IF NOT EXISTS lab_result_component_values (
  id VARCHAR(36) PRIMARY KEY,
  result_id VARCHAR(36) NOT NULL,
  component_name VARCHAR(255) NOT NULL,
  value VARCHAR(255) NOT NULL,
  unit VARCHAR(50),
  normal_range TEXT,
  is_abnormal BOOLEAN DEFAULT false,
  remark VARCHAR(50),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (result_id) REFERENCES lab_results(id)
);

-- Drug inventory table
CREATE TABLE IF NOT EXISTS drug_inventory (
  id VARCHAR(36) PRIMARY KEY,
  drug_name VARCHAR(255) NOT NULL,
  unit_of_measure VARCHAR(50) NOT NULL,
  quantity_received INT NOT NULL,
  current_stock INT NOT NULL,
  expiry_date DATE,
  batch_number VARCHAR(100),
  reorder_level INT DEFAULT 50,
  clinic_id INT,
  date_received DATETIME,
  received_by VARCHAR(255),
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id)
);

-- Prescriptions table
CREATE TABLE IF NOT EXISTS prescriptions (
  id VARCHAR(36) PRIMARY KEY,
  patient_id VARCHAR(36) NOT NULL,
  visit_id VARCHAR(36) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  prescribed_at DATETIME NOT NULL,
  prescribed_by VARCHAR(36),
  clinic_id INT,
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (prescribed_by) REFERENCES users(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id)
);

-- Prescription items table
CREATE TABLE IF NOT EXISTS prescription_items (
  id VARCHAR(36) PRIMARY KEY,
  prescription_id VARCHAR(36) NOT NULL,
  drug_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL,
  dosage VARCHAR(100),
  frequency VARCHAR(100),
  duration VARCHAR(100),
  instructions TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
);

-- Pharmacy dispensing table
CREATE TABLE IF NOT EXISTS pharmacy_dispensing (
  id VARCHAR(36) PRIMARY KEY,
  drug_id VARCHAR(36) NOT NULL,
  patient_id VARCHAR(36) NOT NULL,
  visit_id VARCHAR(36) NOT NULL,
  prescription_id VARCHAR(36),
  quantity_dispensed INT NOT NULL,
  unit_of_measure VARCHAR(50),
  dosage VARCHAR(100),
  frequency VARCHAR(100),
  duration VARCHAR(100),
  instructions TEXT,
  dispensed_at DATETIME NOT NULL,
  dispensed_by VARCHAR(36),
  clinic_id INT,
  status VARCHAR(20) DEFAULT 'dispensed',
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (drug_id) REFERENCES drug_inventory(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(id),
  FOREIGN KEY (dispensed_by) REFERENCES users(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id)
);

-- Pharmacy returns table
CREATE TABLE IF NOT EXISTS pharmacy_returns (
  id VARCHAR(36) PRIMARY KEY,
  dispensing_id VARCHAR(36) NOT NULL,
  quantity_returned INT NOT NULL,
  reason TEXT,
  returned_at DATETIME NOT NULL,
  returned_by VARCHAR(36),
  clinic_id INT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (dispensing_id) REFERENCES pharmacy_dispensing(id),
  FOREIGN KEY (returned_by) REFERENCES users(id),
  FOREIGN KEY (clinic_id) REFERENCES clinic_names(id)
);

-- Patient queue table
CREATE TABLE IF NOT EXISTS patient_queue (
  id VARCHAR(36) PRIMARY KEY,
  patient_id VARCHAR(36) NOT NULL,
  visit_id VARCHAR(36) NOT NULL,
  queue_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'waiting',
  priority VARCHAR(20) DEFAULT 'normal',
  assigned_to VARCHAR(36),
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- Insert initial clinic names
INSERT INTO clinic_names (name, created_at) VALUES 
('Paloch OBC', NOW()),
('Moleeta', NOW()),
('Adar', NOW()),
('Gumry', NOW()),
('Friendship', NOW());

-- Insert initial lab test categories
INSERT INTO lab_test_categories (id, name, created_at) VALUES 
(UUID(), 'Hematology', NOW()),
(UUID(), 'Chemistry', NOW()),
(UUID(), 'Microbiology', NOW()),
(UUID(), 'Urinalysis', NOW()),
(UUID(), 'Serology', NOW()),
(UUID(), 'Parasitology', NOW()),
(UUID(), 'Other', NOW());

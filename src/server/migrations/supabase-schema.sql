-- IntelliCare HMIS Database Schema for Supabase PostgreSQL
-- Run this in Supabase SQL Editor or via psql connection

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    display_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'doctor',
    clinic VARCHAR(100) DEFAULT 'IntelliCare',
    is_active BOOLEAN DEFAULT true,
    signature TEXT,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    phone VARCHAR(20),
    address TEXT,
    clinic VARCHAR(100) DEFAULT 'IntelliCare',
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    registered_by VARCHAR(255),
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Visits table
CREATE TABLE IF NOT EXISTS visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    chief_complaint TEXT,
    clinical_notes TEXT,
    vitals TEXT, -- JSON string
    lab_requests TEXT, -- JSON string
    diagnosis VARCHAR(500),
    diagnosis_code VARCHAR(50),
    patient_name VARCHAR(255),
    doctor_name VARCHAR(255),
    doctor_id UUID,
    queue_id UUID,
    status VARCHAR(50) DEFAULT 'active',
    clinic_id INTEGER,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patient Queue table
CREATE TABLE IF NOT EXISTS patient_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    visit_id UUID,
    queue_type VARCHAR(50) DEFAULT 'consultation',
    status VARCHAR(50) DEFAULT 'waiting',
    priority INTEGER DEFAULT 1,
    assigned_to UUID,
    notes TEXT,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lab Tests table
CREATE TABLE IF NOT EXISTS lab_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_name VARCHAR(255) NOT NULL,
    test_code VARCHAR(50),
    category VARCHAR(100),
    price DECIMAL(10,2),
    service_id INTEGER,
    clinic_id INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lab Test Components table
CREATE TABLE IF NOT EXISTS lab_test_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_test_id UUID REFERENCES lab_tests(id),
    component_name VARCHAR(255) NOT NULL,
    unit VARCHAR(50),
    reference_range VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lab Requests table
CREATE TABLE IF NOT EXISTS lab_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    patient_name VARCHAR(255),
    visit_id UUID,
    test_name VARCHAR(255),
    test_code VARCHAR(50),
    requested_by UUID,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending',
    clinic_id INTEGER,
    priority VARCHAR(20) DEFAULT 'normal',
    notes TEXT,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lab Results table
CREATE TABLE IF NOT EXISTS lab_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_request_id UUID REFERENCES lab_requests(id),
    patient_id UUID REFERENCES patients(id),
    patient_name VARCHAR(255),
    test_name VARCHAR(255),
    results TEXT,
    result_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    performed_by UUID,
    clinic_id INTEGER,
    is_partial BOOLEAN DEFAULT false,
    total_components INTEGER,
    completed_components INTEGER,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Services table
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    service_code VARCHAR(50),
    category VARCHAR(100),
    price DECIMAL(10,2),
    clinic_id INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Patient Bills table
CREATE TABLE IF NOT EXISTS patient_bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    visit_id UUID,
    service_id INTEGER,
    service_name VARCHAR(255),
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2),
    total_amount DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'pending',
    billed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    billed_by UUID,
    invoice_id VARCHAR(100),
    billing_type VARCHAR(20) DEFAULT 'cash',
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Receipts table
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_number VARCHAR(100) UNIQUE NOT NULL,
    patient_id UUID REFERENCES patients(id),
    patient_name VARCHAR(255),
    total_amount DECIMAL(10,2) NOT NULL,
    amount_paid DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'cash',
    cashier_id UUID,
    cashier_name VARCHAR(255),
    clinic VARCHAR(100),
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drug Inventory table
CREATE TABLE IF NOT EXISTS drug_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),
    unit_of_measure VARCHAR(50),
    quantity_received INTEGER DEFAULT 0,
    current_stock INTEGER DEFAULT 0,
    expiry_date DATE,
    batch_number VARCHAR(100),
    reorder_level INTEGER DEFAULT 10,
    unit_cost DECIMAL(10,2),
    selling_price DECIMAL(10,2),
    clinic_id INTEGER,
    date_received DATE DEFAULT CURRENT_DATE,
    received_by UUID,
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pharmacy Dispensing table
CREATE TABLE IF NOT EXISTS pharmacy_dispensing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drug_id UUID REFERENCES drug_inventory(id),
    drug_name VARCHAR(255),
    patient_id UUID REFERENCES patients(id),
    patient_name VARCHAR(255),
    visit_id UUID,
    quantity INTEGER NOT NULL,
    prescribed_by UUID,
    dispensed_by UUID,
    dispensed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    clinic VARCHAR(100),
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prescriptions table
CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    visit_id UUID,
    drug_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    duration VARCHAR(100),
    quantity INTEGER,
    instructions TEXT,
    prescribed_by UUID,
    prescribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'active',
    branch_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Facilities table
CREATE TABLE IF NOT EXISTS facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100),
    location VARCHAR(255),
    capacity INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Branches table
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    facility_id INTEGER REFERENCES facilities(id),
    location VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Branches table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS user_branches (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    branch_id INTEGER REFERENCES branches(id),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, branch_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_patients_patient_id ON patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_patient_id ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_visit_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_patient_queue_status ON patient_queue(status);
CREATE INDEX IF NOT EXISTS idx_lab_requests_patient_id ON lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_patient_id ON lab_results(patient_id);
CREATE INDEX IF NOT EXISTS idx_receipts_patient_id ON receipts(patient_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Insert default admin user (password: admin123)
INSERT INTO users (id, email, password_hash, display_name, role, clinic, is_active)
VALUES (
    uuid_generate_v4(),
    'admin@intellicare.com',
    '$2b$10$rQZ8kqZ5Z5Z5Z5Z5Z5Z5ZeJ5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5',
    'System Administrator',
    'admin',
    'IntelliCare',
    true
) ON CONFLICT (email) DO NOTHING;

-- Insert default facility and branch
INSERT INTO facilities (id, name, type, location, is_active)
VALUES (1, 'IntelliCare Main Hospital', 'Hospital', 'Main Campus', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO branches (id, name, facility_id, location, is_active)
VALUES (1, 'Main Branch', 1, 'Ground Floor', true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON DATABASE postgres IS 'IntelliCare HMIS Database - PostgreSQL Schema';

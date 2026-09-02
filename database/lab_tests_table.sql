-- Create lab_tests table
CREATE TABLE IF NOT EXISTS lab_tests (
    id VARCHAR(36) PRIMARY KEY,
    test_name VARCHAR(255) NOT NULL,
    test_code VARCHAR(50) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NULL,
    service_id INT NULL,
    clinic_id INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create lab_test_components table
CREATE TABLE IF NOT EXISTS lab_test_components (
    id VARCHAR(36) PRIMARY KEY,
    lab_test_id VARCHAR(36) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    unit VARCHAR(50),
    reference_range VARCHAR(255),
    sort_order INT DEFAULT 0,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lab_test_id) REFERENCES lab_tests(id) ON DELETE CASCADE
);

-- Insert sample lab tests
INSERT IGNORE INTO lab_tests (id, test_name, test_code, category, price, clinic_id, is_active) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'Complete Blood Count', 'CBC', 'Hematology', 25.00, 1, TRUE),
('550e8400-e29b-41d4-a716-446655440002', 'Lipid Profile', 'LP', 'Chemistry', 35.00, 1, TRUE),
('550e8400-e29b-41d4-a716-446655440003', 'Blood Film for Malaria', 'BFFM', 'Parasitology', 15.00, 1, TRUE),
('550e8400-e29b-41d4-a716-446655440004', 'ICT for Malaria', 'ICTM', 'Serology', 20.00, 1, TRUE),
('550e8400-e29b-41d4-a716-446655440005', 'Renal Function Tests', 'RFT', 'Chemistry', 40.00, 1, TRUE);

-- Insert sample components for CBC
INSERT IGNORE INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, sort_order) VALUES
('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', 'WBC', '10^9/L', '4.0-10.0', 1),
('660e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', 'RBC', '10^12/L', '3.5-5.5', 2),
('660e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440001', 'HGB', 'g/dL', '11.0-16.0', 3),
('660e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440001', 'HCT', '%', '37.0-54.0', 4),
('660e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440001', 'PLT', '10^9/L', '150-450', 5);

-- Insert sample components for Lipid Profile
INSERT IGNORE INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, sort_order) VALUES
('660e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440002', 'Total Cholesterol', 'mg/dL', '<200', 1),
('660e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440002', 'HDL Cholesterol', 'mg/dL', '40-60', 2),
('660e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440002', 'LDL Cholesterol', 'mg/dL', '<130', 3),
('660e8400-e29b-41d4-a716-446655440009', '550e8400-e29b-41d4-a716-446655440002', 'Triglycerides', 'mg/dL', '<150', 4);

-- Insert sample components for Malaria tests
INSERT IGNORE INTO lab_test_components (id, lab_test_id, component_name, unit, reference_range, sort_order) VALUES
('660e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440003', 'Malaria Parasite', '', 'Not seen', 1),
('660e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440004', 'P.falciparum Antigen', '', 'Negative', 1),
('660e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440004', 'P.vivax Antigen', '', 'Negative', 2);

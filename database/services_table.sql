-- Services table for hospital service management
-- This table stores all services offered by the hospital with pricing information

CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    clinic_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes for better performance
    INDEX idx_clinic_id (clinic_id),
    INDEX idx_category (category),
    INDEX idx_department (department),
    INDEX idx_name (name),
    
    -- Constraints
    CONSTRAINT chk_price_positive CHECK (price >= 0),
    CONSTRAINT chk_name_not_empty CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_category_not_empty CHECK (CHAR_LENGTH(TRIM(category)) > 0),
    CONSTRAINT chk_department_not_empty CHECK (CHAR_LENGTH(TRIM(department)) > 0)
);

-- Insert some sample services for testing
INSERT INTO services (name, category, department, price, clinic_id) VALUES
('General Consultation', 'Consultation', 'General Medicine', 50.00, 1),
('Pediatric Consultation', 'Consultation', 'Pediatrics', 60.00, 1),
('X-Ray Chest', 'Diagnostic', 'Radiology', 80.00, 1),
('Blood Test - CBC', 'Diagnostic', 'Laboratory', 25.00, 1),
('Minor Surgery', 'Surgery', 'Surgery', 200.00, 1),
('Physical Therapy Session', 'Therapy', 'Orthopedics', 40.00, 1),
('Emergency Consultation', 'Emergency', 'Emergency', 100.00, 1),
('Ultrasound Scan', 'Diagnostic', 'Radiology', 120.00, 1),
('Dental Cleaning', 'Procedure', 'General Medicine', 75.00, 1),
('ECG Test', 'Diagnostic', 'Cardiology', 35.00, 1);

-- Add comment to table
ALTER TABLE services COMMENT = 'Hospital services with categories, departments, and pricing information';

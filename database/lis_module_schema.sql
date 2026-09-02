-- ==============================================================================
-- Intellica LIS Module — Research/Chain-of-Custody Schema Additions
-- ==============================================================================

-- 1. Participants Table
-- Separated from the billing-linked patients table
CREATE TABLE IF NOT EXISTS `lis_participants` (
  `id` VARCHAR(36) NOT NULL,
  `participant_number` VARCHAR(50) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `gender` VARCHAR(20) DEFAULT NULL,
  `date_of_birth` DATE DEFAULT NULL,
  `demographics` JSON DEFAULT NULL,
  `study_ref` VARCHAR(100) DEFAULT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `residence` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_participant_num` (`participant_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Test Orders Table
-- Created by doctor during consultation
CREATE TABLE IF NOT EXISTS `lis_test_orders` (
  `id` VARCHAR(36) NOT NULL,
  `participant_id` VARCHAR(36) NOT NULL,
  `visit_id` VARCHAR(36) DEFAULT NULL,
  `doctor_id` INT DEFAULT NULL,
  `status` VARCHAR(50) DEFAULT 'ordered', -- ordered, completed, reviewed
  `clinical_notes` TEXT,
  `vitals` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_participant` (`participant_id`),
  KEY `idx_doctor` (`doctor_id`),
  CONSTRAINT `fk_lis_participant` FOREIGN KEY (`participant_id`) REFERENCES `lis_participants` (`id`),
  CONSTRAINT `fk_lis_doctor` FOREIGN KEY (`doctor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. Specimens Table
-- Represents physical tubes/samples collected
CREATE TABLE IF NOT EXISTS `lis_specimens` (
  `id` VARCHAR(36) NOT NULL,
  `order_id` VARCHAR(36) NOT NULL,
  `test_code` VARCHAR(50) NOT NULL,
  `test_name` VARCHAR(255) NOT NULL,
  `barcode` VARCHAR(255) NOT NULL,
  `department` VARCHAR(100) DEFAULT NULL,
  `status` VARCHAR(50) DEFAULT 'pending_collection', 
  -- pending_collection, collected, label_printed, in_transit, accepted, rejected, recollection_required, routed, analyzing, result_captured
  `collected_by` INT DEFAULT NULL,
  `collection_time` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_barcode` (`barcode`),
  KEY `idx_order` (`order_id`),
  CONSTRAINT `fk_lis_order` FOREIGN KEY (`order_id`) REFERENCES `lis_test_orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. Specimen QC Log Table
-- Audit trail for accept/reject at Lab Reception
CREATE TABLE IF NOT EXISTS `lis_specimen_qc` (
  `id` VARCHAR(36) NOT NULL,
  `specimen_id` VARCHAR(36) NOT NULL,
  `action` VARCHAR(20) NOT NULL, -- accepted, rejected
  `reason` TEXT,
  `checked_by` INT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_specimen_qc` (`specimen_id`),
  CONSTRAINT `fk_lis_qc_specimen` FOREIGN KEY (`specimen_id`) REFERENCES `lis_specimens` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. Results Table
-- Mapped directly to specimens
CREATE TABLE IF NOT EXISTS `lis_results` (
  `id` VARCHAR(36) NOT NULL,
  `specimen_id` VARCHAR(36) NOT NULL,
  `test_code` VARCHAR(50) NOT NULL,
  `analyte` VARCHAR(100) DEFAULT NULL,
  `value` VARCHAR(255) DEFAULT NULL,
  `unit` VARCHAR(50) DEFAULT NULL,
  `flag` VARCHAR(20) DEFAULT NULL, -- High, Low, Abnormal
  `status` VARCHAR(50) DEFAULT 'pending_manager_review', -- pending_manager_review, approved, queried, released
  `manager_review_by` INT DEFAULT NULL,
  `manager_review_at` DATETIME DEFAULT NULL,
  `manager_notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_result_specimen` (`specimen_id`),
  CONSTRAINT `fk_lis_result_specimen` FOREIGN KEY (`specimen_id`) REFERENCES `lis_specimens` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Note: We also need to map the auto analyzer to write to `lis_results` instead of `lab_machine_raw_results`
-- OR modify `lab_machine_raw_results` to allow `specimen_id`
ALTER TABLE `lab_machine_raw_results` ADD COLUMN `specimen_id` VARCHAR(36) DEFAULT NULL AFTER `sample_id`;

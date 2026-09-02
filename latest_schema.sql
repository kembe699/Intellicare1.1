-- MySQL dump 10.13  Distrib 8.0.45, for Linux (x86_64)
--
-- Host: localhost    Database: universal_hmis
-- ------------------------------------------------------
-- Server version	8.0.45-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `cash_transfers`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_transfers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `from_account_id` int NOT NULL,
  `from_account_name` varchar(255) NOT NULL,
  `to_account_id` int NOT NULL,
  `to_account_name` varchar(255) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `notes` text,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cashier_shifts`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cashier_shifts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `cashier_id` varchar(36) NOT NULL,
  `cashier_name` varchar(255) NOT NULL,
  `start_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `end_time` datetime DEFAULT NULL,
  `opening_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `closing_balance` decimal(15,2) DEFAULT NULL,
  `total_receipts` int NOT NULL DEFAULT '0',
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `notes` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cashier_status` (`cashier_id`,`status`),
  KEY `idx_start_time` (`start_time`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `clinic_names`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clinic_names` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `daily_expenses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expense_date` datetime NOT NULL,
  `description` varchar(255) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `account_id` int NOT NULL,
  `account_name` varchar(255) DEFAULT NULL,
  `category` varchar(255) DEFAULT NULL,
  `notes` text,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `diagnoses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `diagnoses` (
  `id` varchar(36) NOT NULL,
  `visit_id` varchar(36) NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `diagnosis_name` varchar(255) NOT NULL,
  `diagnosis_type` varchar(50) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `notes` text,
  `clinic_id` int DEFAULT NULL,
  `doctor_id` varchar(36) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'active',
  `is_primary` tinyint(1) DEFAULT '0',
  `diagnosed_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `visit_id` (`visit_id`),
  KEY `patient_id` (`patient_id`),
  KEY `clinic_id` (`clinic_id`),
  KEY `doctor_id` (`doctor_id`),
  CONSTRAINT `diagnoses_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `diagnoses_ibfk_2` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `diagnoses_ibfk_3` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`),
  CONSTRAINT `diagnoses_ibfk_4` FOREIGN KEY (`doctor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dr_clinics`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dr_clinics` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `department` varchar(255) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(255) DEFAULT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `service` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `dr_clinics_name` (`name`),
  KEY `dr_clinics_department` (`department`),
  KEY `dr_clinics_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `drug_inventory`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `drug_inventory` (
  `id` varchar(36) NOT NULL,
  `drug_name` varchar(255) NOT NULL,
  `generic_name` varchar(255) DEFAULT NULL,
  `unit_of_measure` varchar(50) NOT NULL,
  `quantity_received` int NOT NULL,
  `current_stock` int NOT NULL,
  `expiry_date` date DEFAULT NULL,
  `batch_number` varchar(100) DEFAULT NULL,
  `reorder_level` int DEFAULT '50',
  `clinic_id` int DEFAULT NULL,
  `date_received` datetime DEFAULT NULL,
  `received_by` varchar(255) DEFAULT NULL,
  `unit_cost` decimal(10,2) DEFAULT '0.00',
  `selling_price` decimal(10,2) DEFAULT '0.00',
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `clinic_id` (`clinic_id`),
  CONSTRAINT `drug_inventory_ibfk_1` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `drug_inventory_backup_20260223`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `drug_inventory_backup_20260223` (
  `id` varchar(36) NOT NULL,
  `drug_name` varchar(255) NOT NULL,
  `generic_name` varchar(255) DEFAULT NULL,
  `unit_of_measure` varchar(50) NOT NULL,
  `quantity_received` int NOT NULL,
  `current_stock` int NOT NULL,
  `expiry_date` date DEFAULT NULL,
  `batch_number` varchar(100) DEFAULT NULL,
  `reorder_level` int DEFAULT '50',
  `clinic_id` int DEFAULT NULL,
  `date_received` datetime DEFAULT NULL,
  `received_by` varchar(255) DEFAULT NULL,
  `unit_cost` decimal(10,2) DEFAULT '0.00',
  `selling_price` decimal(10,2) DEFAULT '0.00',
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lab_requests`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lab_requests` (
  `id` varchar(36) NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `visit_id` varchar(36) NOT NULL,
  `test_code` varchar(20) NOT NULL,
  `test_name` varchar(255) NOT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `priority` varchar(20) DEFAULT 'routine',
  `requested_at` datetime NOT NULL,
  `requested_by` varchar(36) DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `notes` text,
  `completed_at` datetime DEFAULT NULL,
  `completed_by` varchar(36) DEFAULT NULL,
  `component_values` json DEFAULT NULL,
  `mindray_imported` tinyint(1) DEFAULT '0',
  `mindray_imported_at` datetime DEFAULT NULL,
  `last_saved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `patient_id` (`patient_id`),
  KEY `visit_id` (`visit_id`),
  KEY `requested_by` (`requested_by`),
  KEY `completed_by` (`completed_by`),
  KEY `clinic_id` (`clinic_id`),
  CONSTRAINT `lab_requests_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `lab_requests_ibfk_2` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `lab_requests_ibfk_3` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `lab_requests_ibfk_4` FOREIGN KEY (`completed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `lab_requests_ibfk_5` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lab_result_component_values`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lab_result_component_values` (
  `id` varchar(36) NOT NULL,
  `result_id` varchar(36) NOT NULL,
  `component_name` varchar(255) NOT NULL,
  `value` varchar(255) NOT NULL,
  `unit` varchar(50) DEFAULT NULL,
  `normal_range` text,
  `is_abnormal` tinyint(1) DEFAULT '0',
  `remark` varchar(50) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `result_id` (`result_id`),
  CONSTRAINT `lab_result_component_values_ibfk_1` FOREIGN KEY (`result_id`) REFERENCES `lab_results` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lab_results`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lab_results` (
  `id` varchar(36) NOT NULL,
  `lab_request_id` varchar(36) NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `test_code` varchar(20) NOT NULL,
  `test_name` varchar(255) NOT NULL,
  `status` varchar(20) DEFAULT 'complete',
  `result_date` datetime NOT NULL,
  `performed_by` varchar(36) DEFAULT NULL,
  `verified_by` varchar(36) DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `notes` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `lab_request_id` (`lab_request_id`),
  KEY `patient_id` (`patient_id`),
  KEY `performed_by` (`performed_by`),
  KEY `verified_by` (`verified_by`),
  KEY `clinic_id` (`clinic_id`),
  CONSTRAINT `lab_results_ibfk_1` FOREIGN KEY (`lab_request_id`) REFERENCES `lab_requests` (`id`),
  CONSTRAINT `lab_results_ibfk_2` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `lab_results_ibfk_3` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `lab_results_ibfk_4` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`),
  CONSTRAINT `lab_results_ibfk_5` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lab_test_categories`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lab_test_categories` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lab_test_components`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lab_test_components` (
  `id` varchar(36) NOT NULL,
  `lab_test_id` varchar(36) NOT NULL,
  `component_name` varchar(255) NOT NULL,
  `unit` varchar(50) DEFAULT NULL,
  `reference_range` varchar(255) DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `createdAt` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lab_test_id` (`lab_test_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lab_tests`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lab_tests` (
  `id` varchar(36) NOT NULL,
  `test_name` varchar(255) NOT NULL,
  `test_code` varchar(20) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `category_id` varchar(36) DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `service_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  KEY `clinic_id` (`clinic_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `lab_tests_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `lab_test_categories` (`id`),
  CONSTRAINT `lab_tests_ibfk_2` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`),
  CONSTRAINT `lab_tests_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ledger_accounts`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ledger_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_type` enum('asset','liability','equity','revenue','expense') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'asset',
  `parent_account_id` int DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `account_code` (`account_code`),
  KEY `idx_parent_account` (`parent_account_id`),
  KEY `idx_account_type` (`account_type`),
  KEY `idx_account_code` (`account_code`),
  CONSTRAINT `ledger_accounts_ibfk_1` FOREIGN KEY (`parent_account_id`) REFERENCES `ledger_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patient_bills`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patient_bills` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `bill_number` varchar(255) NOT NULL,
  `patient_id` varchar(255) NOT NULL,
  `patient_name` varchar(255) NOT NULL,
  `clinic_id` int NOT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `paid_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `balance_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` enum('pending','partial','paid','overdue','active') DEFAULT 'pending',
  `bill_date` datetime NOT NULL,
  `due_date` datetime DEFAULT NULL,
  `services` json DEFAULT NULL,
  `notes` text,
  `created_by` varchar(255) NOT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bill_number` (`bill_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patient_queue`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patient_queue` (
  `id` varchar(36) NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `visit_id` varchar(36) DEFAULT NULL,
  `queue_type` varchar(50) NOT NULL,
  `status` varchar(20) DEFAULT 'waiting',
  `priority` varchar(20) DEFAULT 'normal',
  `assigned_to` varchar(36) DEFAULT NULL,
  `notes` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `patient_id` (`patient_id`),
  KEY `visit_id` (`visit_id`),
  KEY `assigned_to` (`assigned_to`),
  CONSTRAINT `patient_queue_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `patient_queue_ibfk_2` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `patient_queue_ibfk_3` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patients`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patients` (
  `id` varchar(36) NOT NULL,
  `patient_id` varchar(20) NOT NULL,
  `first_name` varchar(255) NOT NULL,
  `last_name` varchar(255) NOT NULL,
  `gender` varchar(10) NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `phone_number` varchar(20) DEFAULT NULL,
  `address` text,
  `next_of_kin_name` varchar(255) DEFAULT NULL,
  `next_of_kin_phone` varchar(20) DEFAULT NULL,
  `insurance_type` varchar(50) DEFAULT NULL,
  `insurance_number` varchar(50) DEFAULT NULL,
  `registration_date` datetime NOT NULL,
  `clinic_id` int DEFAULT NULL,
  `registered_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `clinic_id` (`clinic_id`),
  KEY `registered_by` (`registered_by`),
  CONSTRAINT `patients_ibfk_1` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`),
  CONSTRAINT `patients_ibfk_2` FOREIGN KEY (`registered_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pharmacy_dispensing`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pharmacy_dispensing` (
  `id` varchar(36) NOT NULL,
  `drug_id` varchar(36) NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `visit_id` varchar(36) NOT NULL,
  `prescription_id` varchar(36) DEFAULT NULL,
  `quantity_dispensed` int NOT NULL,
  `unit_of_measure` varchar(50) DEFAULT NULL,
  `dosage` varchar(100) DEFAULT NULL,
  `frequency` varchar(100) DEFAULT NULL,
  `duration` varchar(100) DEFAULT NULL,
  `instructions` text,
  `dispensed_at` datetime NOT NULL,
  `dispensed_by` varchar(36) DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `status` varchar(20) DEFAULT 'dispensed',
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `drug_id` (`drug_id`),
  KEY `patient_id` (`patient_id`),
  KEY `visit_id` (`visit_id`),
  KEY `prescription_id` (`prescription_id`),
  KEY `dispensed_by` (`dispensed_by`),
  KEY `clinic_id` (`clinic_id`),
  CONSTRAINT `pharmacy_dispensing_ibfk_1` FOREIGN KEY (`drug_id`) REFERENCES `drug_inventory` (`id`),
  CONSTRAINT `pharmacy_dispensing_ibfk_2` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `pharmacy_dispensing_ibfk_3` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `pharmacy_dispensing_ibfk_4` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`),
  CONSTRAINT `pharmacy_dispensing_ibfk_5` FOREIGN KEY (`dispensed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `pharmacy_dispensing_ibfk_6` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pharmacy_returns`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pharmacy_returns` (
  `id` varchar(36) NOT NULL,
  `dispensing_id` varchar(36) NOT NULL,
  `quantity_returned` int NOT NULL,
  `reason` text,
  `returned_at` datetime NOT NULL,
  `returned_by` varchar(36) DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `dispensing_id` (`dispensing_id`),
  KEY `returned_by` (`returned_by`),
  KEY `clinic_id` (`clinic_id`),
  CONSTRAINT `pharmacy_returns_ibfk_1` FOREIGN KEY (`dispensing_id`) REFERENCES `pharmacy_dispensing` (`id`),
  CONSTRAINT `pharmacy_returns_ibfk_2` FOREIGN KEY (`returned_by`) REFERENCES `users` (`id`),
  CONSTRAINT `pharmacy_returns_ibfk_3` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `physical_examination`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_examination` (
  `id` varchar(36) NOT NULL,
  `visit_id` varchar(36) NOT NULL,
  `general_appearance` text,
  `skin` text,
  `head_and_neck` text,
  `chest` text,
  `cardiovascular` text,
  `abdomen` text,
  `genitourinary` text,
  `rectal` text,
  `extremities` text,
  `neurological` text,
  `other_findings` text,
  `examined_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `visit_id` (`visit_id`),
  KEY `examined_by` (`examined_by`),
  CONSTRAINT `physical_examination_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `physical_examination_ibfk_2` FOREIGN KEY (`examined_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `prescription_items`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `prescription_items` (
  `id` varchar(36) NOT NULL,
  `prescription_id` varchar(36) NOT NULL,
  `drug_name` varchar(255) NOT NULL,
  `quantity` int NOT NULL,
  `dosage` varchar(100) DEFAULT NULL,
  `frequency` varchar(100) DEFAULT NULL,
  `duration` varchar(100) DEFAULT NULL,
  `instructions` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `prescription_id` (`prescription_id`),
  CONSTRAINT `prescription_items_ibfk_1` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `prescriptions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `prescriptions` (
  `id` varchar(36) NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `patient_name` varchar(255) DEFAULT NULL,
  `medication_name` varchar(255) DEFAULT NULL,
  `take_instructions` varchar(100) DEFAULT NULL,
  `frequency` varchar(100) DEFAULT NULL,
  `duration` varchar(100) DEFAULT NULL,
  `instructions` text,
  `quantity` int DEFAULT NULL,
  `visit_id` varchar(36) NOT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `prescribed_at` datetime NOT NULL,
  `prescribed_by` varchar(36) DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `notes` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `prescribed_by` (`prescribed_by`),
  KEY `prescriptions_visit_id` (`visit_id`),
  KEY `prescriptions_patient_id` (`patient_id`),
  KEY `prescriptions_clinic_id` (`clinic_id`),
  KEY `prescriptions_status` (`status`),
  KEY `prescriptions_prescribed_at` (`prescribed_at`),
  CONSTRAINT `prescriptions_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `prescriptions_ibfk_2` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `prescriptions_ibfk_4` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `purchase_orders`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_number` varchar(255) NOT NULL,
  `supplier_id` int NOT NULL,
  `order_date` datetime NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `status` enum('pending','approved','received','cancelled') DEFAULT 'pending',
  `notes` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `po_number` (`po_number`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `receipts`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `receipts` (
  `id` varchar(36) NOT NULL,
  `receipt_number` varchar(50) NOT NULL,
  `bill_id` varchar(36) NOT NULL,
  `patient_id` varchar(255) NOT NULL,
  `patient_name` varchar(255) NOT NULL,
  `clinic_id` int NOT NULL,
  `payment_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `payment_method` enum('cash','card','check','lease','insurance') NOT NULL DEFAULT 'cash',
  `payment_date` datetime NOT NULL,
  `paid_services` json DEFAULT NULL COMMENT 'Array of service indexes that were paid for in this receipt',
  `service_details` json DEFAULT NULL COMMENT 'Detailed information about the services paid for',
  `notes` text,
  `from_lease` tinyint(1) NOT NULL DEFAULT '0',
  `lease_details` text,
  `cashier_name` varchar(255) DEFAULT NULL,
  `cashier_id` varchar(36) DEFAULT NULL,
  `status` enum('active','voided','refunded') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `receipt_number` (`receipt_number`),
  KEY `receipts_bill_id` (`bill_id`),
  KEY `receipts_patient_id` (`patient_id`),
  KEY `receipts_clinic_id` (`clinic_id`),
  KEY `receipts_receipt_number` (`receipt_number`),
  KEY `receipts_payment_date` (`payment_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `services`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `services` (
  `id` varchar(36) NOT NULL,
  `service_name` varchar(255) NOT NULL,
  `category` varchar(100) NOT NULL,
  `price` decimal(10,2) DEFAULT '0.00',
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` varchar(255) DEFAULT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `service_name` (`service_name`),
  KEY `idx_category` (`category`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `suppliers`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `suppliers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `contact_person` varchar(255) DEFAULT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `address` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `treatment_plan`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `treatment_plan` (
  `id` varchar(36) NOT NULL,
  `visit_id` varchar(36) NOT NULL,
  `plan_details` text,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `visit_id` (`visit_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `treatment_plan_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `treatment_plan_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `treatment_plan_medications`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `treatment_plan_medications` (
  `id` varchar(36) NOT NULL,
  `treatment_plan_id` varchar(36) NOT NULL,
  `medication_name` varchar(255) NOT NULL,
  `dosage` varchar(100) DEFAULT NULL,
  `frequency` varchar(100) DEFAULT NULL,
  `duration` varchar(100) DEFAULT NULL,
  `instructions` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `treatment_plan_id` (`treatment_plan_id`),
  CONSTRAINT `treatment_plan_medications_ibfk_1` FOREIGN KEY (`treatment_plan_id`) REFERENCES `treatment_plan` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `treatment_plan_procedures`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `treatment_plan_procedures` (
  `id` varchar(36) NOT NULL,
  `treatment_plan_id` varchar(36) NOT NULL,
  `procedure_name` varchar(255) NOT NULL,
  `instructions` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `treatment_plan_id` (`treatment_plan_id`),
  CONSTRAINT `treatment_plan_procedures_ibfk_1` FOREIGN KEY (`treatment_plan_id`) REFERENCES `treatment_plan` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `firebase_uid` varchar(50) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `role` varchar(50) NOT NULL,
  `clinic_id` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `status` varchar(50) DEFAULT 'active',
  `last_login` datetime DEFAULT NULL,
  `password_set_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `visits`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `visits` (
  `id` varchar(36) NOT NULL,
  `visit_date` datetime NOT NULL,
  `patient_id` varchar(36) NOT NULL,
  `chief_complaint` text,
  `status` varchar(20) DEFAULT 'pending',
  `completed_at` datetime DEFAULT NULL,
  `clinic_id` int DEFAULT NULL,
  `doctor_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `patient_id` (`patient_id`),
  KEY `clinic_id` (`clinic_id`),
  KEY `doctor_id` (`doctor_id`),
  CONSTRAINT `visits_ibfk_1` FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`),
  CONSTRAINT `visits_ibfk_2` FOREIGN KEY (`clinic_id`) REFERENCES `clinic_names` (`id`),
  CONSTRAINT `visits_ibfk_3` FOREIGN KEY (`doctor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `vitals`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vitals` (
  `id` varchar(36) NOT NULL,
  `visit_id` varchar(36) NOT NULL,
  `blood_pressure` varchar(20) DEFAULT NULL,
  `pulse_rate` int DEFAULT NULL,
  `respiratory_rate` int DEFAULT NULL,
  `temperature` decimal(5,2) DEFAULT NULL,
  `oxygen_saturation` int DEFAULT NULL,
  `height` decimal(5,2) DEFAULT NULL,
  `weight` decimal(5,2) DEFAULT NULL,
  `bmi` decimal(5,2) DEFAULT NULL,
  `blood_sugar` decimal(5,2) DEFAULT NULL,
  `taken_at` datetime DEFAULT NULL,
  `taken_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `visit_id` (`visit_id`),
  KEY `taken_by` (`taken_by`),
  CONSTRAINT `vitals_ibfk_1` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`),
  CONSTRAINT `vitals_ibfk_2` FOREIGN KEY (`taken_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-02-26 12:40:21

-- Adds the 4 multi-currency tables referenced by tests/integration/multiCurrency.test.js
-- and tests/unit/currencies.test.js but never actually created in the live MySQL
-- database. They existed only in a stale Postgres dump (intellicare_backup.sql,
-- from an earlier abandoned Supabase migration attempt) — this ports them to MySQL.
--
-- Also adds exchange_rate/amount_in_base_currency to `invoices`, which
-- tests/setup/testData.js's createTestInvoice() and several ledger/invoice tests
-- expect. (invoices.scheme_id/scheme_name are NOT here — src/server/routes/invoices.js
-- already self-migrates those on server startup; this only covers the 2 columns
-- nothing in the app adds automatically.)

ALTER TABLE `invoices`
  ADD COLUMN IF NOT EXISTS `exchange_rate` decimal(18,6) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS `amount_in_base_currency` decimal(15,2) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `exchange_adjustments` (
  `id` varchar(36) NOT NULL,
  `clinic_id` int NOT NULL,
  `transaction_date` date NOT NULL,
  `from_currency` varchar(3) NOT NULL,
  `to_currency` varchar(3) NOT NULL,
  `original_amount` decimal(15,2) DEFAULT NULL,
  `original_rate` decimal(18,6) DEFAULT NULL,
  `original_base_amount` decimal(15,2) DEFAULT NULL,
  `settlement_date` date DEFAULT NULL,
  `settlement_rate` decimal(18,6) DEFAULT NULL,
  `settlement_base_amount` decimal(15,2) DEFAULT NULL,
  `realized_gain_loss` decimal(15,2) DEFAULT 0,
  `current_rate` decimal(18,6) DEFAULT NULL,
  `current_base_amount` decimal(15,2) DEFAULT NULL,
  `unrealized_gain_loss` decimal(15,2) DEFAULT 0,
  `adjustment_type` varchar(50) DEFAULT 'receivable',
  `adjustment_status` varchar(50) DEFAULT 'pending',
  `reference_id` varchar(100) DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `notes` text,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_exchange_adjustments_clinic` (`clinic_id`),
  KEY `idx_exchange_adjustments_currencies` (`from_currency`, `to_currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `currency_conversion_log` (
  `id` varchar(36) NOT NULL,
  `clinic_id` int NOT NULL,
  `source_transaction_id` varchar(100) DEFAULT NULL,
  `source_transaction_type` varchar(50) DEFAULT NULL,
  `from_currency` varchar(3) NOT NULL,
  `to_currency` varchar(3) NOT NULL,
  `amount_source` decimal(15,2) DEFAULT NULL,
  `rate_used` decimal(18,6) DEFAULT NULL,
  `amount_converted` decimal(15,2) DEFAULT NULL,
  `conversion_method` varchar(50) DEFAULT 'automatic',
  `conversion_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_by` varchar(36) DEFAULT NULL,
  `approval_status` varchar(50) DEFAULT 'approved',
  `approval_date` timestamp NULL DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversion_log_clinic` (`clinic_id`),
  KEY `idx_conversion_log_source` (`source_transaction_type`, `source_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_currency_balances` (
  `id` varchar(36) NOT NULL,
  `clinic_id` int NOT NULL,
  `account_id` varchar(36) NOT NULL,
  `currency_code` varchar(3) NOT NULL,
  `balance_in_currency` decimal(15,2) DEFAULT 0,
  `balance_in_base_currency` decimal(15,2) DEFAULT 0,
  `last_conversion_rate` decimal(18,6) DEFAULT NULL,
  `last_conversion_date` timestamp NULL DEFAULT NULL,
  `unrealized_gain_loss` decimal(15,2) DEFAULT 0,
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_account_currency` (`account_id`, `currency_code`),
  KEY `idx_account_currency_balances_clinic` (`clinic_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `multicurrency_report_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clinic_id` int NOT NULL,
  `base_currency_code` varchar(3) NOT NULL DEFAULT 'SSP',
  `secondary_currencies` text,
  `show_individual_currencies` tinyint(1) DEFAULT 1,
  `show_base_currency_conversion` tinyint(1) DEFAULT 1,
  `show_exchange_gains_losses` tinyint(1) DEFAULT 1,
  `date_for_rates` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_multicurrency_settings_clinic` (`clinic_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

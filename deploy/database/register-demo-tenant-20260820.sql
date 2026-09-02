-- ============================================================================
-- IntelliCare multi-tenant SaaS cutover — run on the Hostinger production DB
-- Generated 2026-08-20, verified against the real dump (u325388367_intellicare.sql)
-- by loading it into a scratch database and diffing every table/column against
-- the current multi-tenant template schema. Safe to re-run in full.
--
-- What this does:
--   PART 1 — one schema fix on `u325388367_intellicare` (the real, currently
--            -live single-tenant database, exactly as dumped in
--            u325388367_intellicare.sql). Everything else the newer codebase
--            needs (password_hash/signature/current_room_id columns, the
--            visits/lab_requests/vitals columns, the inpatient_admissions
--            active_bed_id generated column, widening users.role to include
--            'nurse'/'procurement', etc.) is already self-healed automatically
--            by src/server/models/index.js's createModels() the first time any
--            request touches this tenant's connection — confirmed by reading
--            that code, which runs in full for every tenant database lazily on
--            first use (see tenantDb.js), not just the old single default DB.
--            The ONE thing that function explicitly does NOT self-heal is the
--            'cashier' role (its own comment says so: "left alone here since
--            it's outside this change's scope") — cashier is a real,
--            actively-used role in the app's UI/permissions, so it's fixed
--            here instead. No data is dropped or modified anywhere.
--   PART 2 — creates the new control-plane database `u325388367_platform`
--            (holds platform-admin accounts, the client registry, plans,
--            invoices — never any hospital data) and registers the EXISTING
--            `u325388367_intellicare` database as a tenant with login code
--            "demo", preserving every real user and every row of real data
--            exactly as-is. No new/empty database is created for this tenant
--            — the live one just becomes reachable through the new
--            code+email+password login instead of email+password alone.
--
-- Prerequisites before running this:
--   1. Create the `u325388367_platform` database via Hostinger hPanel — a
--      shared-hosting DB user can NEVER run CREATE DATABASE via SQL, even
--      with "All Privileges" granted on that database (that grant only
--      covers operations inside an already-existing database — tables,
--      rows — not the server-level privilege CREATE DATABASE needs). This
--      script does not attempt it for that reason; it has to happen in
--      hPanel first. Then grant the existing u325388367_intellicare DB user
--      full privileges on the new database (hPanel usually forces you to
--      also create a throwaway paired user during the creation step — that
--      user is unused by the app and can be ignored).
--   2. Deploy the new backend code (see the backend zip) BEFORE running
--      this — production.env now also needs:
--        PLATFORM_DB_NAME=u325388367_platform
--        TENANT_DB_PREFIX=u325388367_client_
--      (already added to src/server/production.env in this deploy).
--   3. On first boot with those two new vars set, the app auto-creates all
--      platform-DB tables and seeds the default platform-admin login
--      (the seeded admin account — password comes from SEED_ADMIN_PASSWORD) — so start
--      the app once, THEN run PART 2 below (it needs those tables to exist).
--      PART 1 has no such dependency and can run any time before or after.
--   4. In phpMyAdmin, enter via the u325388367_intellicare user's "Enter
--      phpMyAdmin" link specifically — not any other database's user — since
--      only that user has (or should have) access to both databases this
--      script touches.
-- ============================================================================


-- ============================================================================
-- PART 1 — the one real schema gap on u325388367_intellicare
-- ============================================================================
USE `u325388367_intellicare`;

ALTER TABLE `users` MODIFY COLUMN `role`
  enum('admin','doctor','lab','pharmacy','reception','reports','accountant','finance_manager','auditor','procurement','nurse','cashier')
  NOT NULL;


-- ============================================================================
-- PART 2 — register the existing database as tenant "demo"
-- Run this only AFTER the new backend has booted at least once in production
-- (so the platform-DB tables below already exist), AND after the
-- u325388367_platform database has already been created via hPanel (see
-- prerequisite 1 above — this script deliberately does not attempt
-- CREATE DATABASE itself, since a shared-hosting DB user can never do that
-- via SQL regardless of grants).
-- ============================================================================
USE `u325388367_platform`;

-- If a row with code 'demo' already exists (e.g. from a prior test), this
-- updates it in place instead of erroring on the unique `code` constraint.
INSERT INTO `clients` (`name`, `code`, `db_name`, `admin_email`, `status`, `created_at`, `updated_at`)
VALUES ('Al-shifa', 'demo', 'u325388367_intellicare', 'levi@nilehc.tech', 'active', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `name` = 'Al-shifa',
  `db_name` = 'u325388367_intellicare',
  `admin_email` = 'levi@nilehc.tech',
  `status` = 'active',
  `suspended_at` = NULL;

-- Intentionally no invoice/subscription plan is attached — a client with
-- zero invoices is treated as manually-managed and is never auto-suspended
-- by the billing dunning sweep (see services/subscriptionBilling.js). If a
-- real billing plan is ever wanted for this tenant later, assign it from
-- the platform admin panel — don't do it here, since an unpaid pending
-- invoice would suspend the tenant on the very next dunning sweep.

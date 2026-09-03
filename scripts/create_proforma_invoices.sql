-- Create proforma_invoices in every tenant schema.
--
-- routes/proformaInvoices.js creates this table on demand, but its DDL carried
-- MySQL's `ON UPDATE CURRENT_TIMESTAMP`, which PostgreSQL rejects — so the
-- CREATE failed silently and every request to /api/proforma-invoices returned
-- 500. The DDL is fixed now, but that lazy path runs on the default connection
-- (the template) only, so existing tenants would still never get the table.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\_%' ORDER BY 1 LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.proforma_invoices (
        id CHAR(36) PRIMARY KEY,
        clinic_id INTEGER NOT NULL,
        branch_id INTEGER,
        proforma_number VARCHAR(50) UNIQUE NOT NULL,
        patient_id VARCHAR(255) NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        items JSON NOT NULL,
        subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'SSP',
        notes TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        converted_bill_id CHAR(36),
        created_by CHAR(36),
        created_by_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )$f$, s);
    RAISE NOTICE '% : proforma_invoices ready', s;
  END LOOP;
END $$;

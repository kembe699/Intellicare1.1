--
-- PostgreSQL database dump
--

\restrict YJZFd6zRJbRDoWgHVN63yBtPEQou95gHR6hhb6j2NgiN9yHFKX41Mgb0JK3174u

-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: enum_cashier_shifts_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_cashier_shifts_status AS ENUM (
    'open',
    'closed'
);


--
-- Name: enum_chart_of_accounts_account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_chart_of_accounts_account_type AS ENUM (
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense'
);


--
-- Name: enum_chart_of_accounts_balance_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_chart_of_accounts_balance_type AS ENUM (
    'debit',
    'credit'
);


--
-- Name: enum_expense_invoices_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_expense_invoices_status AS ENUM (
    'received',
    'verified',
    'approved',
    'partial_paid',
    'paid',
    'cancelled'
);


--
-- Name: enum_general_ledger_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_general_ledger_status AS ENUM (
    'draft',
    'pending_approval',
    'posted',
    'reversed'
);


--
-- Name: enum_journal_entries_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_journal_entries_status AS ENUM (
    'draft',
    'submitted',
    'approved',
    'posted',
    'rejected'
);


--
-- Name: enum_ledger_accounts_account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_ledger_accounts_account_type AS ENUM (
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense'
);


--
-- Name: enum_patient_bills_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_patient_bills_status AS ENUM (
    'pending',
    'partial',
    'paid',
    'overdue',
    'active'
);


--
-- Name: enum_patient_receivables_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_patient_receivables_status AS ENUM (
    'pending',
    'partial',
    'overdue',
    'paid',
    'written_off'
);


--
-- Name: enum_patients_gender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_patients_gender AS ENUM (
    'male',
    'female',
    'other'
);


--
-- Name: enum_prescriptions_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_prescriptions_status AS ENUM (
    'active',
    'completed',
    'cancelled'
);


--
-- Name: enum_purchase_orders_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_purchase_orders_status AS ENUM (
    'draft',
    'check',
    'approved',
    'authorized',
    'received',
    'cancelled'
);


--
-- Name: enum_receipts_payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_receipts_payment_method AS ENUM (
    'cash',
    'card',
    'check',
    'lease',
    'insurance'
);


--
-- Name: enum_receipts_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_receipts_status AS ENUM (
    'active',
    'voided',
    'refunded'
);


--
-- Name: enum_users_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_users_role AS ENUM (
    'admin',
    'doctor',
    'lab',
    'pharmacy',
    'reception',
    'reports',
    'accountant',
    'finance_manager',
    'auditor'
);


--
-- Name: enum_users_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_users_status AS ENUM (
    'pending',
    'active',
    'inactive'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_currency_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_currency_balances (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    account_id character varying(36) NOT NULL,
    currency_code character varying(3) NOT NULL,
    balance_in_currency numeric(15,2) DEFAULT 0,
    balance_in_base_currency numeric(15,2) DEFAULT 0,
    last_conversion_rate numeric(18,6),
    last_conversion_date timestamp without time zone,
    unrealized_gain_loss numeric(15,2) DEFAULT 0,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: account_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_ledger (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    account_id character varying(36) NOT NULL,
    transaction_id character varying(36),
    transaction_date date NOT NULL,
    debit_amount numeric(15,2) DEFAULT 0,
    credit_amount numeric(15,2) DEFAULT 0,
    reference_number character varying(100),
    description text,
    posted_by character varying(36),
    posted_date timestamp without time zone,
    is_posted boolean DEFAULT false,
    source_module character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: accounting_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_suppliers (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    supplier_name character varying(255) NOT NULL,
    supplier_code character varying(50),
    contact_person character varying(255),
    phone character varying(20),
    email character varying(255),
    address text,
    tax_id character varying(50),
    payment_terms character varying(50),
    opening_balance numeric(15,2) DEFAULT 0,
    currency character varying(3) DEFAULT 'KES'::character varying,
    is_active boolean DEFAULT true,
    account_id character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id character(36) NOT NULL,
    clinic_id integer,
    user_id character(36),
    user_name character varying(255),
    user_role character varying(100),
    module character varying(100) NOT NULL,
    action character varying(100) NOT NULL,
    entity_type character varying(100),
    entity_id character varying(255),
    description text,
    old_values json,
    new_values json,
    ip_address character varying(45),
    user_agent text,
    status character varying(50) DEFAULT 'success'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: batch_insurance_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_insurance_claims (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    batch_number character varying(100) NOT NULL,
    scheme_id character varying(36),
    scheme_name character varying(255),
    scheme_code character varying(50),
    claim_amount numeric(15,2) DEFAULT 0,
    invoice_count integer DEFAULT 0,
    status character varying(50) DEFAULT 'pending'::character varying,
    notes text,
    created_by character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: batch_usage_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_usage_history (
    id character varying(36) NOT NULL,
    batch_id character varying(36) NOT NULL,
    usage_date date,
    quantity_used integer DEFAULT 0,
    usage_type character varying(50) DEFAULT 'clinical_use'::character varying,
    reference_id character varying(100),
    reference_type character varying(50),
    used_by character varying(36),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: beds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beds (
    id character(36) NOT NULL,
    room_id character(36) NOT NULL,
    ward_id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    bed_number character varying(100) NOT NULL,
    bed_type character varying(100) DEFAULT 'standard'::character varying,
    status character varying(50) DEFAULT 'available'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_discounts (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    bill_id character varying(36) NOT NULL,
    discount_number character varying(100) NOT NULL,
    discount_type character varying(50) DEFAULT 'fixed_amount'::character varying,
    discount_amount numeric(15,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0,
    reason text,
    approved_by character varying(36),
    approval_date timestamp without time zone,
    approval_notes text,
    discount_gl_entry_id character varying(36),
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: bill_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_line_items (
    id character varying(36) NOT NULL,
    bill_id character varying(36) NOT NULL,
    line_number integer,
    service_category character varying(50) DEFAULT 'other'::character varying,
    service_code character varying(100),
    service_name character varying(255) NOT NULL,
    source_module character varying(50),
    source_id character varying(36),
    quantity integer DEFAULT 1,
    unit_price numeric(15,2) DEFAULT 0 NOT NULL,
    line_currency character varying(3) DEFAULT 'SSP'::character varying,
    exchange_rate numeric(15,6) DEFAULT 1.000000,
    base_currency_unit_price numeric(15,2) DEFAULT 0,
    line_total numeric(15,2) DEFAULT 0,
    base_currency_total numeric(15,2) DEFAULT 0,
    paid_amount numeric(15,2) DEFAULT 0,
    balance_amount numeric(15,2) DEFAULT 0,
    item_status character varying(20) DEFAULT 'pending'::character varying,
    patient_copay numeric(15,2) DEFAULT 0,
    insurance_coverage numeric(15,2) DEFAULT 0,
    item_discount numeric(15,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0,
    revenue_account_id character varying(36),
    gl_entry_id character varying(36),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: billing_follow_ups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_follow_ups (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    bill_id character varying(36) NOT NULL,
    patient_id character varying(255) NOT NULL,
    follow_up_date date NOT NULL,
    follow_up_type character varying(50) DEFAULT 'phone'::character varying,
    follow_up_notes text,
    outcome character varying(50),
    next_follow_up_date date,
    performed_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: billing_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_settings (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    default_currency character varying(3) DEFAULT 'SSP'::character varying,
    default_revenue_account_id character varying(36),
    default_payment_terms character varying(50) DEFAULT 'immediate'::character varying,
    default_due_date_days integer DEFAULT 30,
    allow_discounts boolean DEFAULT true,
    discount_approval_required_above numeric(15,2) DEFAULT 0,
    nhif_enabled boolean DEFAULT false,
    nhif_copay_percentage numeric(5,2) DEFAULT 10,
    auto_apply_insurance_copay boolean DEFAULT true,
    multi_currency_enabled boolean DEFAULT false,
    accepted_currencies json,
    auto_bill_on_service boolean DEFAULT true,
    auto_bill_pharmacy_dispensing boolean DEFAULT true,
    auto_bill_lab_tests boolean DEFAULT true,
    auto_bill_clinical_visits boolean DEFAULT true,
    auto_post_to_gl boolean DEFAULT true,
    post_immediately boolean DEFAULT true,
    auto_calculate_aging boolean DEFAULT true,
    send_overdue_notices boolean DEFAULT false,
    overdue_notice_days integer DEFAULT 30,
    write_off_after_days integer DEFAULT 180,
    auto_write_off boolean DEFAULT false,
    allow_refunds boolean DEFAULT true,
    refund_approval_required boolean DEFAULT true,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: branch_access_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_access_audit_logs (
    id character(36) NOT NULL,
    user_id character(36),
    branch_id integer,
    action character varying(100) NOT NULL,
    resource_type character varying(100),
    resource_id character varying(100),
    is_unauthorized boolean DEFAULT false,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    facility_id integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    description text,
    is_main_branch boolean DEFAULT false,
    phone character varying(50),
    email character varying(255),
    address text,
    city character varying(100),
    region character varying(100),
    country character varying(100) DEFAULT 'South Sudan'::character varying,
    manager_name character varying(255),
    manager_phone character varying(50),
    opening_time character varying(10) DEFAULT '08:00'::character varying,
    closing_time character varying(10) DEFAULT '17:00'::character varying,
    bed_capacity integer DEFAULT 0,
    staff_count integer DEFAULT 0
);


--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: cash_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_transfers (
    id integer NOT NULL,
    from_account_id character varying(36) NOT NULL,
    from_account_name character varying(255) NOT NULL,
    to_account_id character varying(36) NOT NULL,
    to_account_name character varying(255) NOT NULL,
    amount numeric(10,2) NOT NULL,
    notes text,
    created_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: cash_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cash_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cash_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cash_transfers_id_seq OWNED BY public.cash_transfers.id;


--
-- Name: cashier_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashier_shifts (
    id integer NOT NULL,
    cashier_id uuid NOT NULL,
    cashier_name character varying(255) NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    opening_balance numeric(15,2) DEFAULT 0 NOT NULL,
    closing_balance numeric(15,2),
    total_receipts integer DEFAULT 0 NOT NULL,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status public.enum_cashier_shifts_status DEFAULT 'open'::public.enum_cashier_shifts_status NOT NULL,
    notes text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: cashier_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cashier_shifts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cashier_shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cashier_shifts_id_seq OWNED BY public.cashier_shifts.id;


--
-- Name: chart_of_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_of_accounts (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    account_code character varying(50) NOT NULL,
    account_name character varying(255) NOT NULL,
    account_type character varying(20) NOT NULL,
    sub_account_type character varying(50),
    balance_type character varying(10) NOT NULL,
    opening_balance numeric(15,2) DEFAULT 0,
    opening_balance_date date,
    is_active boolean DEFAULT true,
    is_bank_account boolean DEFAULT false,
    is_customer_account boolean DEFAULT false,
    is_supplier_account boolean DEFAULT false,
    description text,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    currency_code character varying(3) DEFAULT NULL::character varying,
    is_multicurrency boolean DEFAULT false
);


--
-- Name: clinic_names; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinic_names (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50),
    address text,
    phone character varying(50),
    email character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: clinic_names_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clinic_names_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clinic_names_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clinic_names_id_seq OWNED BY public.clinic_names.id;


--
-- Name: cogs_posting_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cogs_posting_log (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    posting_period date,
    item_id character varying(36),
    quantity_used integer DEFAULT 0,
    quantity_dispensed integer DEFAULT 0,
    quantity_wasted integer DEFAULT 0,
    total_quantity_out integer DEFAULT 0,
    total_cost_of_goods numeric(15,2) DEFAULT 0,
    cogs_method character varying(20) DEFAULT 'weighted_average'::character varying,
    average_cost_per_unit numeric(15,4) DEFAULT 0,
    gl_entry_id character varying(36),
    gl_account_id character varying(36),
    posted_by character varying(36),
    posting_date timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: controlled_substance_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controlled_substance_log (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    drug_id character varying(36) NOT NULL,
    dispensing_record_id character varying(36),
    quantity_dispensed integer DEFAULT 0,
    patient_id uuid,
    dispensed_by uuid,
    dispensing_date date,
    balance_before integer DEFAULT 0,
    balance_after integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: cost_centers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_centers (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    cost_center_code character varying(50) NOT NULL,
    cost_center_name character varying(255) NOT NULL,
    description text,
    responsible_person_id character varying(36),
    budget_amount numeric(15,2),
    budget_period character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: credit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_notes (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    credit_note_number character varying(100) NOT NULL,
    original_bill_id character varying(36) NOT NULL,
    patient_id character varying(255) NOT NULL,
    patient_name character varying(255),
    credit_date date,
    credit_amount numeric(15,2) DEFAULT 0,
    credit_currency character varying(3) DEFAULT 'SSP'::character varying,
    reason character varying(50),
    reason_details text,
    approved_by character varying(36),
    approval_date timestamp without time zone,
    applied_to_bill_id character varying(36),
    applied_date date,
    applied_amount numeric(15,2) DEFAULT 0,
    credit_gl_entry_id character varying(36),
    reversal_gl_entry_id character varying(36),
    application_gl_entry_id character varying(36),
    status character varying(20) DEFAULT 'created'::character varying,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currencies (
    id integer NOT NULL,
    code character varying(3) NOT NULL,
    name character varying(100) NOT NULL,
    symbol character varying(5) DEFAULT ''::character varying,
    is_base_currency boolean DEFAULT false,
    decimal_places integer DEFAULT 2,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: currencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.currencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: currencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.currencies_id_seq OWNED BY public.currencies.id;


--
-- Name: currency_conversion_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_conversion_log (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    source_transaction_id character varying(100),
    source_transaction_type character varying(50),
    from_currency character varying(3) NOT NULL,
    to_currency character varying(3) NOT NULL,
    amount_source numeric(15,2),
    rate_used numeric(18,6),
    amount_converted numeric(15,2),
    conversion_method character varying(50) DEFAULT 'automatic'::character varying,
    conversion_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    approved_by character varying(36),
    approval_status character varying(50) DEFAULT 'approved'::character varying,
    approval_date timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: daily_expense_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_expense_approvals (
    id character varying(36) NOT NULL,
    expense_id integer NOT NULL,
    user_id character varying(36),
    approval_level integer NOT NULL,
    approved_by character varying(255) NOT NULL,
    approved_by_title character varying(100),
    signature text,
    notes text,
    approved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: daily_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_expenses (
    id integer NOT NULL,
    expense_date timestamp with time zone NOT NULL,
    description character varying(255) NOT NULL,
    amount numeric(10,2) NOT NULL,
    account_id character varying(36) NOT NULL,
    account_name character varying(255),
    category character varying(255),
    notes text,
    created_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    clinic_id integer,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    voucher_number character varying(100),
    status character varying(30) DEFAULT 'approved'::character varying,
    paid_at timestamp without time zone
);


--
-- Name: daily_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_expenses_id_seq OWNED BY public.daily_expenses.id;


--
-- Name: daily_financial_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_financial_summary (
    id integer NOT NULL,
    clinic_id integer NOT NULL,
    summary_date date NOT NULL,
    total_revenue numeric(15,2) DEFAULT 0,
    total_collections numeric(15,2) DEFAULT 0,
    total_expenses numeric(15,2) DEFAULT 0,
    net_profit numeric(15,2) DEFAULT 0,
    patient_count integer DEFAULT 0,
    visit_count integer DEFAULT 0,
    bill_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: daily_financial_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_financial_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_financial_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_financial_summary_id_seq OWNED BY public.daily_financial_summary.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id character varying(36) NOT NULL,
    department_name character varying(255) NOT NULL,
    department_code character varying(50) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    clinic_id integer DEFAULT 1 NOT NULL,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: dispensing_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispensing_records (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    dispensing_number character varying(100) NOT NULL,
    prescription_id character varying(36),
    prescription_line_id character varying(36),
    patient_id uuid,
    drug_id character varying(36) NOT NULL,
    pharmacist_id uuid,
    inventory_item_id character varying(36),
    batch_id character varying(36),
    from_location_id character varying(36),
    dispensing_date date NOT NULL,
    dispensing_time time without time zone,
    quantity_dispensed integer DEFAULT 1 NOT NULL,
    unit_of_measure character varying(20) DEFAULT 'tablet'::character varying,
    unit_price numeric(10,2) DEFAULT 0,
    currency_code character varying(3) DEFAULT 'KES'::character varying,
    exchange_rate numeric(15,6) DEFAULT 1,
    total_price numeric(15,2) DEFAULT 0,
    total_price_base numeric(15,2) DEFAULT 0,
    inventory_transaction_id character varying(36),
    batch_usage_record_id character varying(36),
    dispensing_notes text,
    patient_counselling_provided boolean DEFAULT false,
    counselling_notes text,
    counselled_by_id character varying(36),
    bill_id character varying(36),
    bill_item_id character varying(36),
    amount_charged numeric(15,2) DEFAULT 0,
    is_billed boolean DEFAULT false,
    billing_date date,
    gl_entry_id character varying(36),
    cogs_gl_entry_id character varying(36),
    revenue_gl_entry_id character varying(36),
    status character varying(20) DEFAULT 'dispensed'::character varying,
    return_date date,
    return_reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: dispensing_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispensing_returns (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    return_number character varying(100) NOT NULL,
    dispensing_record_id character varying(36) NOT NULL,
    return_date date,
    return_reason character varying(50) DEFAULT 'unused'::character varying,
    quantity_returned integer DEFAULT 0,
    inventory_reversal_done boolean DEFAULT false,
    inventory_transaction_id character varying(36),
    credit_note_id character varying(36),
    amount_refunded numeric(15,2) DEFAULT 0,
    refund_method character varying(20) DEFAULT 'cash'::character varying,
    gl_reversal_entry_id character varying(36),
    revenue_reversal_gl_id character varying(36),
    cogs_reversal_gl_id character varying(36),
    processed_by character varying(36),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: doctor_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_notes (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    admission_id character(36) NOT NULL,
    patient_id character varying(36) NOT NULL,
    doctor_id character varying(36) NOT NULL,
    note_date timestamp without time zone NOT NULL,
    note_type character varying(50) DEFAULT 'progress'::character varying,
    clinical_assessment text NOT NULL,
    examination_findings text,
    vital_signs json,
    diagnosis character varying(500),
    diagnosis_code character varying(50),
    treatment_plan text,
    progress_status character varying(50) DEFAULT 'stable'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: dr_clinics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dr_clinics (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    department character varying(255) NOT NULL,
    service character varying(255) DEFAULT NULL::character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: drug_administrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_administrations (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    prescription_id character(36) NOT NULL,
    admission_id character(36) NOT NULL,
    patient_id character varying(36) NOT NULL,
    drug_id character varying(36),
    medication_name character varying(255) NOT NULL,
    nurse_id character varying(36) NOT NULL,
    administered_at timestamp without time zone NOT NULL,
    dosage_given character varying(100) NOT NULL,
    route character varying(50) DEFAULT 'oral'::character varying,
    notes text,
    patient_reaction text,
    status character varying(50) DEFAULT 'given'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: drug_allergies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_allergies (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    patient_id character varying(36) NOT NULL,
    drug_id character varying(36),
    drug_class character varying(100),
    allergy_description text,
    severity character varying(20) DEFAULT 'moderate'::character varying,
    reaction_description text,
    verified_date date,
    verified_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: drug_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_interactions (
    id character varying(36) NOT NULL,
    drug1_id character varying(36) NOT NULL,
    drug2_id character varying(36) NOT NULL,
    interaction_type character varying(20) DEFAULT 'moderate'::character varying,
    interaction_description text,
    management_notes text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: drug_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_inventory (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    drug_name character varying(255) NOT NULL,
    generic_name character varying(255),
    unit_of_measure character varying(50),
    quantity_received integer DEFAULT 0,
    current_stock integer DEFAULT 0,
    expiry_date date,
    batch_number character varying(100),
    reorder_level integer DEFAULT 10,
    unit_cost numeric(10,2),
    selling_price numeric(10,2),
    clinic_id integer,
    date_received date DEFAULT CURRENT_DATE,
    received_by uuid,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    inventory_item_id character varying(36)
);


--
-- Name: drug_pricing_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drug_pricing_history (
    id character varying(36) NOT NULL,
    drug_id character varying(36) NOT NULL,
    price_currency character varying(3) DEFAULT 'KES'::character varying,
    price_amount numeric(10,2),
    effective_from date,
    effective_to date,
    reason_for_change character varying(255),
    changed_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: drugs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drugs (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    drug_code character varying(100) NOT NULL,
    drug_name character varying(255) NOT NULL,
    generic_name character varying(255),
    drug_description text,
    inventory_item_id character varying(36),
    strength character varying(100),
    unit_of_measure character varying(20) DEFAULT 'tablet'::character varying,
    dosage_form character varying(50) DEFAULT 'tablet'::character varying,
    therapeutic_category character varying(100),
    atc_code character varying(50),
    is_controlled_substance boolean DEFAULT false,
    is_scheduled boolean DEFAULT false,
    price_kes numeric(10,2) DEFAULT 0,
    price_usd numeric(10,2) DEFAULT 0,
    price_ssp numeric(10,2) DEFAULT 0,
    default_currency character varying(3) DEFAULT 'KES'::character varying,
    revenue_account_id character varying(36),
    cogs_account_id character varying(36),
    requires_prescription boolean DEFAULT true,
    max_quantity_per_prescription integer DEFAULT 100,
    shelf_life_days integer DEFAULT 365,
    requires_cold_storage boolean DEFAULT false,
    drug_allergy_keywords json,
    major_drug_interactions json,
    is_active boolean DEFAULT true,
    discontinued_date date,
    notes text,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: exchange_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_adjustments (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    transaction_date date NOT NULL,
    from_currency character varying(3) NOT NULL,
    to_currency character varying(3) NOT NULL,
    original_amount numeric(15,2),
    original_rate numeric(18,6),
    original_base_amount numeric(15,2),
    settlement_date date,
    settlement_rate numeric(18,6),
    settlement_base_amount numeric(15,2),
    realized_gain_loss numeric(15,2) DEFAULT 0,
    current_rate numeric(18,6),
    current_base_amount numeric(15,2),
    unrealized_gain_loss numeric(15,2) DEFAULT 0,
    adjustment_type character varying(50) DEFAULT 'receivable'::character varying,
    adjustment_status character varying(50) DEFAULT 'pending'::character varying,
    reference_id character varying(100),
    reference_type character varying(50),
    notes text,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    from_currency character varying(3) NOT NULL,
    to_currency character varying(3) NOT NULL,
    rate numeric(18,6) NOT NULL,
    effective_date date NOT NULL,
    expiry_date date,
    source character varying(50) DEFAULT 'manual'::character varying,
    is_active boolean DEFAULT true,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    buy_rate numeric(18,6) DEFAULT NULL::numeric,
    sell_rate numeric(18,6) DEFAULT NULL::numeric,
    spot_rate numeric(18,6) DEFAULT NULL::numeric,
    notes text
);


--
-- Name: expense_invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_invoice_lines (
    id character varying(36) NOT NULL,
    expense_invoice_id character varying(36) NOT NULL,
    account_id character varying(36),
    item_description character varying(255),
    quantity integer,
    unit_price numeric(15,2),
    line_amount numeric(15,2),
    tax_amount numeric(15,2) DEFAULT 0,
    cost_center_id character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: expense_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_invoices (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    supplier_id character varying(36) NOT NULL,
    invoice_number character varying(100) NOT NULL,
    invoice_date date NOT NULL,
    due_date date,
    received_date date,
    total_amount numeric(15,2),
    tax_amount numeric(15,2) DEFAULT 0,
    gross_amount numeric(15,2),
    amount_paid numeric(15,2) DEFAULT 0,
    amount_due numeric(15,2),
    status character varying(20) DEFAULT 'received'::character varying,
    expense_category character varying(100),
    reference_po character varying(100),
    notes text,
    verified_by character varying(36),
    verified_date date,
    approved_by character varying(36),
    approved_date date,
    gl_entry_id character varying(36),
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facilities (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(100),
    capacity integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    address text,
    city character varying(100),
    state character varying(100),
    postal_code character varying(20),
    country character varying(100) DEFAULT 'South Sudan'::character varying,
    phone character varying(50),
    email character varying(255),
    fax character varying(50),
    website character varying(255),
    license_number character varying(100),
    established_date date,
    bed_capacity integer,
    description text
);


--
-- Name: facilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: facilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facilities_id_seq OWNED BY public.facilities.id;


--
-- Name: general_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.general_ledger (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    gl_number character varying(100) NOT NULL,
    transaction_date date NOT NULL,
    posting_date date,
    transaction_type character varying(50),
    description text NOT NULL,
    reference_id character varying(100),
    reference_module character varying(50),
    total_debit numeric(15,2) DEFAULT 0,
    total_credit numeric(15,2) DEFAULT 0,
    is_balanced boolean DEFAULT false,
    is_posted boolean DEFAULT false,
    posted_by character varying(36),
    posted_date timestamp without time zone,
    status character varying(20) DEFAULT 'draft'::character varying,
    approval_by character varying(36),
    approval_date timestamp without time zone,
    created_by character varying(36) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    transaction_currency character varying(3) DEFAULT 'SSP'::character varying NOT NULL,
    base_currency character varying(3) DEFAULT 'SSP'::character varying NOT NULL,
    exchange_rate numeric(18,6) DEFAULT 1.000000 NOT NULL,
    base_total_debit numeric(15,2) DEFAULT 0,
    base_total_credit numeric(15,2) DEFAULT 0
);


--
-- Name: gl_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gl_line_items (
    id character varying(36) NOT NULL,
    gl_id character varying(36) NOT NULL,
    account_id character varying(36) NOT NULL,
    debit_amount numeric(15,2) DEFAULT 0,
    credit_amount numeric(15,2) DEFAULT 0,
    line_description text,
    cost_center_id character varying(36),
    department_id character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    base_debit_amount numeric(15,2) DEFAULT 0,
    base_credit_amount numeric(15,2) DEFAULT 0,
    currency_code character varying(3) DEFAULT NULL::character varying,
    amount_in_currency numeric(15,2) DEFAULT NULL::numeric,
    exchange_rate numeric(18,6) DEFAULT NULL::numeric,
    exchange_gain_loss numeric(15,2) DEFAULT 0
);


--
-- Name: goods_receipt_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goods_receipt_notes (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    grn_number character varying(100) NOT NULL,
    po_id integer NOT NULL,
    supplier_id integer NOT NULL,
    receipt_date date NOT NULL,
    received_by character varying(36) NOT NULL,
    received_location character varying(255),
    received_condition character varying(50) DEFAULT 'good'::character varying,
    total_items_received integer DEFAULT 0,
    notes text,
    status character varying(30) DEFAULT 'pending_inspection'::character varying,
    inspected_by character varying(36),
    inspection_date date,
    inspection_notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: grn_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grn_line_items (
    id character varying(36) NOT NULL,
    grn_id character varying(36) NOT NULL,
    po_line_item_id integer,
    item_code character varying(100),
    item_description character varying(255),
    quantity_expected integer DEFAULT 0,
    quantity_received integer DEFAULT 0 NOT NULL,
    unit_of_measure character varying(20),
    item_condition character varying(50) DEFAULT 'good'::character varying,
    batch_number character varying(100),
    expiry_date date,
    serial_number character varying(100),
    inspection_status character varying(20) DEFAULT 'pass'::character varying,
    inspection_notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    inventory_item_id character varying(36),
    inventory_batch_id character varying(36),
    unit_cost numeric(15,4) DEFAULT 0
);


--
-- Name: inpatient_admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inpatient_admissions (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    patient_id uuid NOT NULL,
    admission_date timestamp without time zone NOT NULL,
    bed_id character(36) NOT NULL,
    room_id character(36) NOT NULL,
    ward_id character(36) NOT NULL,
    admission_reason text NOT NULL,
    diagnosis character varying(500),
    diagnosis_code character varying(50),
    admission_type character varying(50) DEFAULT 'planned'::character varying,
    status character varying(50) DEFAULT 'active'::character varying,
    admitted_by_user_id character varying(36) NOT NULL,
    attending_doctor_id character varying(36),
    discharge_date timestamp without time zone,
    discharge_reason text,
    discharge_summary text,
    discharged_by_user_id character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inpatient_lab_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inpatient_lab_requests (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    admission_id character(36) NOT NULL,
    patient_id character varying(36) NOT NULL,
    doctor_id character varying(36) NOT NULL,
    request_date timestamp without time zone NOT NULL,
    test_type character varying(255) NOT NULL,
    test_code character varying(100),
    urgent boolean DEFAULT false,
    clinical_indication text,
    sample_type character varying(100),
    status character varying(50) DEFAULT 'pending'::character varying,
    results json,
    result_notes text,
    completed_date timestamp without time zone,
    completed_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inpatient_prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inpatient_prescriptions (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    admission_id character(36) NOT NULL,
    patient_id character varying(36) NOT NULL,
    doctor_id character varying(36) NOT NULL,
    drug_id character varying(36),
    medication_name character varying(255) NOT NULL,
    prescription_date timestamp without time zone NOT NULL,
    dosage character varying(100) NOT NULL,
    frequency character varying(100) NOT NULL,
    duration character varying(100),
    route character varying(50) DEFAULT 'oral'::character varying,
    instructions text,
    quantity integer DEFAULT 0,
    status character varying(50) DEFAULT 'active'::character varying,
    start_date timestamp without time zone,
    end_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inpatient_radiology_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inpatient_radiology_requests (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    admission_id character(36) NOT NULL,
    patient_id character varying(36) NOT NULL,
    doctor_id character varying(36) NOT NULL,
    request_date timestamp without time zone NOT NULL,
    imaging_type character varying(255) NOT NULL,
    body_part character varying(255),
    urgent boolean DEFAULT false,
    clinical_indication text,
    status character varying(50) DEFAULT 'pending'::character varying,
    findings text,
    impression text,
    completed_date timestamp without time zone,
    completed_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: insurance_batch_claim_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_batch_claim_items (
    id character varying(36) NOT NULL,
    claim_id character varying(36) NOT NULL,
    invoice_id character varying(36) NOT NULL,
    bill_id character varying(36),
    patient_id character varying(36),
    patient_name character varying(255),
    invoice_number character varying(50),
    invoice_date date,
    amount numeric(15,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: insurance_batch_claim_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_batch_claim_status_history (
    id character varying(36) NOT NULL,
    claim_id character varying(36) NOT NULL,
    old_status character varying(50),
    new_status character varying(50),
    notes text,
    created_by character varying(36),
    created_by_name character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: insurance_batch_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_batch_claims (
    id character varying(36) NOT NULL,
    clinic_id integer DEFAULT 1 NOT NULL,
    branch_id integer,
    claim_number character varying(50) NOT NULL,
    scheme_id character varying(36) NOT NULL,
    scheme_name character varying(255),
    scheme_code character varying(50),
    claim_amount numeric(15,2) DEFAULT 0,
    invoice_count integer DEFAULT 0,
    status character varying(50) DEFAULT 'draft'::character varying,
    priority character varying(50) DEFAULT 'normal'::character varying,
    date_from date,
    date_to date,
    notes text,
    contact_person character varying(255),
    contact_email character varying(255),
    contact_phone character varying(50),
    submitted_at timestamp without time zone,
    accepted_at timestamp without time zone,
    paid_at timestamp without time zone,
    paid_amount numeric(15,2) DEFAULT 0,
    rejected_reason text,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: insurance_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_claims (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    claim_number character varying(100) NOT NULL,
    bill_id character varying(36) NOT NULL,
    patient_id character varying(255) NOT NULL,
    patient_name character varying(255),
    insurance_provider character varying(255),
    insurance_type character varying(50),
    member_id character varying(255),
    claim_amount numeric(15,2) DEFAULT 0,
    claim_currency character varying(3) DEFAULT 'SSP'::character varying,
    claim_date date,
    submission_date date,
    approval_code character varying(100),
    approval_date date,
    approved_amount numeric(15,2) DEFAULT 0,
    paid_amount numeric(15,2) DEFAULT 0,
    payment_date date,
    payment_reference character varying(255),
    rejection_reason text,
    gl_entry_id character varying(36),
    payment_gl_entry_id character varying(36),
    status character varying(20) DEFAULT 'draft'::character varying,
    notes text,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer,
    batch_id character varying(36)
);


--
-- Name: inventory_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_adjustments (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    adjustment_number character varying(100) NOT NULL,
    item_id character varying(36) NOT NULL,
    location_id character varying(36),
    system_quantity integer DEFAULT 0,
    physical_count integer DEFAULT 0,
    variance integer DEFAULT 0,
    variance_reason character varying(50),
    variance_value numeric(15,2) DEFAULT 0,
    counted_by character varying(36),
    count_date date,
    reviewed_by character varying(36),
    review_date date,
    approved_by character varying(36),
    approval_date date,
    approval_status character varying(20) DEFAULT 'pending'::character varying,
    gl_entry_id character varying(36),
    adjustment_account_id character varying(36),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: inventory_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_batches (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    item_id character varying(36) NOT NULL,
    batch_number character varying(100) NOT NULL,
    serial_number character varying(100),
    location_id character varying(36),
    po_id integer,
    grn_id character varying(36),
    supplier_id integer,
    receipt_date date NOT NULL,
    quantity_received integer DEFAULT 0 NOT NULL,
    quantity_used integer DEFAULT 0,
    unit_cost numeric(15,4) DEFAULT 0,
    cost_currency character varying(3) DEFAULT 'SSP'::character varying,
    batch_total_cost numeric(15,2) DEFAULT 0,
    manufacture_date date,
    expiry_date date,
    is_expired boolean DEFAULT false,
    status character varying(20) DEFAULT 'active'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    item_code character varying(100) NOT NULL,
    item_name character varying(255) NOT NULL,
    item_description text,
    item_category character varying(100) DEFAULT 'general'::character varying,
    item_type character varying(50) DEFAULT 'consumable'::character varying,
    unit_of_measure character varying(50) DEFAULT 'Each'::character varying,
    reorder_unit character varying(50) DEFAULT 'Each'::character varying,
    conversion_factor integer DEFAULT 1,
    quantity_on_hand integer DEFAULT 0,
    reserved_quantity integer DEFAULT 0,
    minimum_stock_level integer DEFAULT 0,
    maximum_stock_level integer DEFAULT 0,
    reorder_quantity integer DEFAULT 0,
    lead_time_days integer DEFAULT 7,
    inventory_valuation_method character varying(20) DEFAULT 'weighted_average'::character varying,
    current_unit_cost numeric(15,4) DEFAULT 0,
    average_unit_cost numeric(15,4) DEFAULT 0,
    selling_price numeric(15,4) DEFAULT 0,
    cost_currency character varying(3) DEFAULT 'SSP'::character varying,
    inventory_account_id character varying(36),
    cogs_account_id character varying(36),
    usage_account_id character varying(36),
    requires_batch_tracking boolean DEFAULT false,
    requires_expiry_tracking boolean DEFAULT false,
    requires_serial_number boolean DEFAULT false,
    is_controlled_substance boolean DEFAULT false,
    is_active boolean DEFAULT true,
    discontinued_date date,
    notes text,
    preferred_supplier_id integer,
    drug_inventory_id character varying(36),
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: inventory_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_reservations (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    item_id character varying(36) NOT NULL,
    location_id character varying(36),
    reservation_type character varying(50) DEFAULT 'prescription'::character varying,
    quantity_reserved integer DEFAULT 0,
    reserve_date date,
    required_date date,
    reference_id character varying(100),
    reference_type character varying(50),
    status character varying(20) DEFAULT 'reserved'::character varying,
    fulfilled_date date,
    reserved_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventory_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_settings (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    default_valuation_method character varying(20) DEFAULT 'weighted_average'::character varying,
    auto_create_po_at_min_stock boolean DEFAULT false,
    min_stock_alert_threshold integer DEFAULT 0,
    warn_expiry_days integer DEFAULT 30,
    auto_flag_expired boolean DEFAULT true,
    require_batch_entry_for_all boolean DEFAULT false,
    auto_post_cogs_monthly boolean DEFAULT true,
    cogs_posting_day integer DEFAULT 25,
    track_by_location boolean DEFAULT true,
    default_location_id character varying(36),
    inventory_account_id character varying(36),
    cogs_account_id character varying(36),
    usage_account_id character varying(36),
    adjustment_account_id character varying(36),
    allow_negative_stock boolean DEFAULT false,
    require_approval_for_adjustments_above numeric(15,2) DEFAULT 10000,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    transaction_number character varying(100) NOT NULL,
    item_id character varying(36) NOT NULL,
    transaction_type character varying(30) NOT NULL,
    quantity_change integer NOT NULL,
    from_location_id character varying(36),
    to_location_id character varying(36),
    batch_id character varying(36),
    unit_cost numeric(15,4) DEFAULT 0,
    total_cost numeric(15,2) DEFAULT 0,
    cost_currency character varying(3) DEFAULT 'SSP'::character varying,
    exchange_rate numeric(15,6) DEFAULT 1,
    gl_entry_id character varying(36),
    gl_entry_created boolean DEFAULT false,
    gl_entry_posted boolean DEFAULT false,
    reference_type character varying(50),
    reference_id character varying(100),
    transaction_date date NOT NULL,
    transaction_time time without time zone,
    notes text,
    approval_required boolean DEFAULT false,
    approved_by character varying(36),
    approval_date timestamp without time zone,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: inventory_valuation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_valuation (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    item_id character varying(36) NOT NULL,
    valuation_date date NOT NULL,
    quantity_on_hand integer DEFAULT 0,
    quantity_reserved integer DEFAULT 0,
    fifo_value numeric(15,2) DEFAULT 0,
    lifo_value numeric(15,2) DEFAULT 0,
    weighted_average_value numeric(15,2) DEFAULT 0,
    selected_method character varying(20) DEFAULT 'weighted_average'::character varying,
    inventory_value numeric(15,2) DEFAULT 0,
    gl_entry_id character varying(36),
    gl_posting_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id character(36) NOT NULL,
    invoice_id character(36) NOT NULL,
    service_id character(36),
    description character varying(255) NOT NULL,
    quantity integer DEFAULT 1,
    unit_price numeric(15,2) DEFAULT 0 NOT NULL,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'SSP'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id character(36) NOT NULL,
    invoice_id character(36) NOT NULL,
    amount numeric(15,2) NOT NULL,
    payment_date date NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    reference_number character varying(100),
    notes text,
    recorded_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    branch_id integer,
    bill_id character(36),
    patient_id character varying(255) NOT NULL,
    patient_name character varying(255) NOT NULL,
    invoice_number character varying(50) NOT NULL,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(15,2) DEFAULT 0 NOT NULL,
    balance_due numeric(15,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'SSP'::character varying,
    payment_terms integer DEFAULT 30,
    due_date date NOT NULL,
    status character varying(50) DEFAULT 'unpaid'::character varying,
    notes text,
    created_by character(36),
    updated_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    scheme_id character varying(36),
    scheme_name character varying(255),
    exchange_rate numeric(18,6) DEFAULT NULL::numeric,
    amount_in_base_currency numeric(15,2) DEFAULT NULL::numeric
);


--
-- Name: item_pricing_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_pricing_history (
    id character varying(36) NOT NULL,
    item_id character varying(36) NOT NULL,
    supplier_id integer,
    unit_cost numeric(15,4),
    cost_currency character varying(3) DEFAULT 'SSP'::character varying,
    effective_from date,
    effective_to date,
    source character varying(50) DEFAULT 'manual'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    je_number character varying(100) NOT NULL,
    entry_date date NOT NULL,
    description text NOT NULL,
    narration text,
    reference character varying(100),
    total_debit numeric(15,2),
    total_credit numeric(15,2),
    status character varying(20) DEFAULT 'draft'::character varying,
    created_by character varying(36) NOT NULL,
    approved_by character varying(36),
    approved_date timestamp without time zone,
    posted_by character varying(36),
    posted_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    transaction_currency character varying(3) DEFAULT 'SSP'::character varying NOT NULL,
    base_currency character varying(3) DEFAULT 'SSP'::character varying NOT NULL,
    exchange_rate numeric(18,6) DEFAULT 1.000000 NOT NULL,
    base_total_debit numeric(15,2) DEFAULT 0,
    base_total_credit numeric(15,2) DEFAULT 0
);


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry_lines (
    id character varying(36) NOT NULL,
    je_id character varying(36) NOT NULL,
    account_id character varying(36) NOT NULL,
    debit_amount numeric(15,2) DEFAULT 0,
    credit_amount numeric(15,2) DEFAULT 0,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    base_debit_amount numeric(15,2) DEFAULT 0,
    base_credit_amount numeric(15,2) DEFAULT 0,
    currency_code character varying(3) DEFAULT NULL::character varying,
    amount_in_currency numeric(15,2) DEFAULT NULL::numeric,
    exchange_rate numeric(18,6) DEFAULT NULL::numeric
);


--
-- Name: lab_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid,
    patient_name character varying(255),
    visit_id uuid,
    test_name character varying(255),
    test_code character varying(50),
    requested_by uuid,
    requested_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'pending'::character varying,
    clinic_id integer,
    priority character varying(20) DEFAULT 'normal'::character varying,
    notes text,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    test_id character varying(36),
    sample_collected boolean DEFAULT false,
    sample_collection_date timestamp without time zone,
    result_date timestamp without time zone
);


--
-- Name: lab_result_component_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_result_component_values (
    id character varying(36) NOT NULL,
    result_id character varying(36) NOT NULL,
    component_name character varying(255) NOT NULL,
    value text,
    unit character varying(50),
    normal_range character varying(100),
    is_abnormal boolean DEFAULT false,
    remark text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lab_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lab_request_id uuid,
    patient_id uuid,
    patient_name character varying(255),
    test_name character varying(255),
    results text,
    result_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    performed_by uuid,
    clinic_id integer,
    is_partial boolean DEFAULT false,
    total_components integer,
    completed_components integer,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    verified_by character varying(36),
    verified_at timestamp without time zone,
    status character varying(50) DEFAULT 'pending'::character varying
);


--
-- Name: lab_test_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_test_components (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lab_test_id uuid,
    component_name character varying(255) NOT NULL,
    unit character varying(50),
    reference_range character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    clinic_id integer DEFAULT 1,
    display_order integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lab_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_tests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    test_name character varying(255) NOT NULL,
    test_code character varying(50),
    category character varying(100),
    price numeric(10,2),
    service_id character varying(36),
    clinic_id integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by uuid,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ledger_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_accounts (
    id integer NOT NULL,
    account_name character varying(255) NOT NULL,
    account_code character varying(50) NOT NULL,
    account_type public.enum_ledger_accounts_account_type DEFAULT 'asset'::public.enum_ledger_accounts_account_type NOT NULL,
    parent_account_id integer,
    description text,
    balance numeric(15,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: ledger_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ledger_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ledger_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ledger_accounts_id_seq OWNED BY public.ledger_accounts.id;


--
-- Name: multicurrency_report_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multicurrency_report_settings (
    id integer NOT NULL,
    clinic_id integer NOT NULL,
    base_currency_code character varying(3) DEFAULT 'SSP'::character varying NOT NULL,
    secondary_currencies text,
    show_individual_currencies boolean DEFAULT true,
    show_base_currency_conversion boolean DEFAULT true,
    show_exchange_gains_losses boolean DEFAULT true,
    date_for_rates date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: multicurrency_report_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.multicurrency_report_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: multicurrency_report_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.multicurrency_report_settings_id_seq OWNED BY public.multicurrency_report_settings.id;


--
-- Name: nursing_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nursing_notes (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    admission_id character(36) NOT NULL,
    patient_id character varying(36) NOT NULL,
    nurse_id character varying(36) NOT NULL,
    note_date timestamp without time zone NOT NULL,
    shift character varying(50) DEFAULT 'morning'::character varying,
    care_activities text NOT NULL,
    patient_condition character varying(255),
    vital_signs json,
    fluid_intake numeric(10,2),
    fluid_output numeric(10,2),
    wound_care text,
    pain_level integer,
    mobility_status character varying(255),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: patient_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_bills (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid,
    visit_id uuid,
    service_id integer,
    service_name character varying(255),
    quantity integer DEFAULT 1,
    unit_price numeric(10,2),
    total_amount numeric(10,2),
    status character varying(50) DEFAULT 'pending'::character varying,
    billed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    billed_by uuid,
    invoice_id character varying(100),
    billing_type character varying(20) DEFAULT 'cash'::character varying,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    bill_id character varying(36),
    bill_number character varying(100),
    bill_date date DEFAULT CURRENT_DATE,
    services text,
    patient_name character varying(255),
    clinic_id integer DEFAULT 1,
    scheme_id character varying(36),
    scheme_name character varying(255),
    scheme_pricing_applied boolean DEFAULT false,
    bill_currency character varying(3) DEFAULT 'SSP'::character varying,
    exchange_rate numeric(15,6) DEFAULT 1.000000,
    base_currency_total numeric(15,2) DEFAULT 0,
    clinical_total numeric(15,2) DEFAULT 0,
    lab_total numeric(15,2) DEFAULT 0,
    pharmacy_total numeric(15,2) DEFAULT 0,
    supply_total numeric(15,2) DEFAULT 0,
    procedure_total numeric(15,2) DEFAULT 0,
    accommodation_total numeric(15,2) DEFAULT 0,
    other_total numeric(15,2) DEFAULT 0,
    discount_amount numeric(15,2) DEFAULT 0,
    discount_type character varying(50),
    discount_reason text,
    discount_approved_by character varying(36),
    discount_approval_date timestamp without time zone,
    adjustment_amount numeric(15,2) DEFAULT 0,
    adjustment_reason text,
    insurance_type character varying(100),
    insurance_member_id character varying(255),
    insurance_copay numeric(15,2) DEFAULT 0,
    insurance_coverage_amount numeric(15,2) DEFAULT 0,
    insurance_claim_submitted boolean DEFAULT false,
    insurance_claim_date date,
    insurance_approval_code character varying(100),
    payment_terms character varying(50) DEFAULT 'immediate'::character varying,
    original_due_date date,
    extended_due_date date,
    days_overdue integer DEFAULT 0,
    is_overdue boolean DEFAULT false,
    is_credit_bill boolean DEFAULT false,
    credit_approved_by character varying(36),
    credit_approval_date timestamp without time zone,
    credit_limit_used numeric(15,2) DEFAULT 0,
    main_gl_entry_id character varying(36),
    aging_category character varying(20) DEFAULT 'current'::character varying,
    last_payment_date date,
    requires_follow_up boolean DEFAULT false,
    follow_up_date date,
    follow_up_notes text,
    paid_amount numeric(15,2) DEFAULT 0,
    balance_amount numeric(15,2) DEFAULT 0,
    due_date date,
    notes text,
    created_by character varying(255),
    updated_by character varying(255)
);


--
-- Name: patient_insurance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_insurance (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    patient_id character varying(255) NOT NULL,
    insurance_type character varying(50) DEFAULT 'nhif'::character varying,
    insurance_provider character varying(255),
    member_id character varying(255),
    member_name character varying(255),
    nhif_member_number character varying(50),
    nhif_status character varying(20) DEFAULT 'active'::character varying,
    nhif_card_number character varying(50),
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true,
    copay_percentage numeric(5,2) DEFAULT 0,
    copay_max_per_visit numeric(15,2),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    scheme_id character(36)
);


--
-- Name: patient_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_queue (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid,
    visit_id uuid,
    queue_type character varying(50) DEFAULT 'consultation'::character varying,
    status character varying(50) DEFAULT 'waiting'::character varying,
    priority integer DEFAULT 1,
    assigned_to uuid,
    notes text,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    clinic_id integer DEFAULT 1
);


--
-- Name: patient_receivables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_receivables (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    patient_id character varying(255) NOT NULL,
    bill_id character varying(36) NOT NULL,
    bill_number character varying(255),
    service_date date,
    bill_date date,
    due_date date,
    service_description text,
    service_amount numeric(15,2),
    amount_due numeric(15,2),
    amount_paid numeric(15,2) DEFAULT 0,
    amount_adjusted numeric(15,2) DEFAULT 0,
    status character varying(20) DEFAULT 'pending'::character varying,
    days_overdue integer DEFAULT 0,
    last_payment_date date,
    gl_entry_id character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: patient_schemes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patient_schemes (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_code character varying(100) NOT NULL,
    scheme_name character varying(255) NOT NULL,
    scheme_description text,
    scheme_type character varying(50) DEFAULT 'individual'::character varying NOT NULL,
    is_default boolean DEFAULT false,
    is_active boolean DEFAULT true,
    requires_verification boolean DEFAULT false,
    requires_approval boolean DEFAULT false,
    pricing_strategy character varying(50) DEFAULT 'fixed'::character varying,
    base_markup_percentage numeric(5,2) DEFAULT 0,
    base_discount_percentage numeric(5,2) DEFAULT 0,
    is_insurance boolean DEFAULT false,
    insurance_provider_name character varying(255),
    insurance_provider_code character varying(100),
    requires_authorization boolean DEFAULT false,
    has_copay boolean DEFAULT true,
    default_copay_percentage numeric(5,2) DEFAULT 10,
    copay_cap_per_visit numeric(15,2),
    payment_terms character varying(50) DEFAULT 'immediate'::character varying,
    is_credit_allowed boolean DEFAULT false,
    credit_limit numeric(15,2) DEFAULT 0,
    requires_deposit boolean DEFAULT false,
    deposit_amount numeric(15,2),
    revenue_account_id character(36),
    discount_account_id character(36),
    approval_required_above numeric(15,2),
    allows_negotiation boolean DEFAULT false,
    contact_person character varying(255),
    contact_phone character varying(20),
    contact_email character varying(255),
    website character varying(255),
    notes text,
    created_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    currency character varying(3) DEFAULT 'SSP'::character varying
);


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id character varying(50),
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    date_of_birth date,
    gender character varying(20),
    phone character varying(20),
    address text,
    clinic character varying(100) DEFAULT 'IntelliCare'::character varying,
    registered_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    registered_by character varying(255),
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    email character varying(255),
    emergency_contact character varying(255),
    blood_group character varying(10),
    allergies text,
    medical_history text,
    default_scheme_id character(36),
    clinic_id integer DEFAULT 1,
    phone_number character varying(20),
    next_of_kin_name character varying(255),
    next_of_kin_phone character varying(20),
    insurance_type character varying(100),
    insurance_number character varying(100),
    registration_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: pharmacy_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pharmacy_audit_log (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    action_type character varying(100),
    reference_id character varying(100),
    action_by character varying(36),
    action_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    action_details json,
    reason_for_action text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: pharmacy_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pharmacy_charges (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    charge_number character varying(100) NOT NULL,
    patient_id uuid,
    dispensing_record_id character varying(36) NOT NULL,
    bill_id character varying(36),
    bill_item_id character varying(36),
    charge_date date,
    drug_name character varying(255),
    quantity_dispensed integer DEFAULT 0,
    unit_price numeric(10,2) DEFAULT 0,
    charge_amount numeric(15,2) DEFAULT 0,
    currency_code character varying(3) DEFAULT 'KES'::character varying,
    insurance_type character varying(100),
    patient_copay numeric(10,2) DEFAULT 0,
    insurance_portion numeric(10,2) DEFAULT 0,
    applied_price_type character varying(20) DEFAULT 'cash'::character varying,
    is_billed boolean DEFAULT false,
    billing_date date,
    payment_status character varying(20) DEFAULT 'pending'::character varying,
    revenue_gl_entry_id character varying(36),
    cogs_gl_entry_id character varying(36),
    receivables_gl_entry_id character varying(36),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: pharmacy_dispensing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pharmacy_dispensing (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    drug_id uuid,
    drug_name character varying(255),
    patient_id uuid,
    patient_name character varying(255),
    visit_id uuid,
    quantity integer NOT NULL,
    prescribed_by uuid,
    dispensed_by uuid,
    dispensed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    clinic character varying(100),
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    clinic_id integer DEFAULT 1
);


--
-- Name: pharmacy_insurance_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pharmacy_insurance_pricing (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    drug_id character varying(36) NOT NULL,
    insurance_type character varying(100),
    unit_price numeric(10,2) DEFAULT 0,
    currency_code character varying(3) DEFAULT 'KES'::character varying,
    patient_copay numeric(10,2) DEFAULT 0,
    insurance_covers numeric(10,2) DEFAULT 0,
    effective_from date,
    effective_to date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: pharmacy_prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pharmacy_prescriptions (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    prescription_number character varying(100) NOT NULL,
    visit_id character varying(36),
    patient_id uuid NOT NULL,
    doctor_id uuid,
    prescription_date date NOT NULL,
    prescribed_by_name character varying(255),
    prescription_notes text,
    special_instructions text,
    status character varying(30) DEFAULT 'pending'::character varying,
    cancelled_date date,
    cancellation_reason text,
    expires_date date,
    valid_for_days integer DEFAULT 30,
    number_of_refills_allowed integer DEFAULT 0,
    allergy_check_done boolean DEFAULT false,
    allergy_check_date date,
    allergy_check_by_id character varying(36),
    allergy_warnings json,
    interaction_check_done boolean DEFAULT false,
    interaction_check_date date,
    interaction_warnings json,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: pharmacy_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pharmacy_settings (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    allow_partial_dispensing boolean DEFAULT true,
    require_allergy_check boolean DEFAULT true,
    require_interaction_check boolean DEFAULT true,
    require_patient_counselling boolean DEFAULT true,
    auto_check_stock_before_dispensing boolean DEFAULT true,
    warn_if_stock_below_days integer DEFAULT 7,
    auto_reserve_stock_on_prescription boolean DEFAULT true,
    default_pharmacy_location_id character varying(36),
    default_markup_percentage numeric(5,2) DEFAULT 20,
    round_to_nearest integer DEFAULT 0,
    include_tax_in_price boolean DEFAULT false,
    default_tax_rate numeric(5,2) DEFAULT 16,
    default_dispensing_currency character varying(3) DEFAULT 'KES'::character varying,
    accept_usd_payments boolean DEFAULT true,
    accept_ssp_payments boolean DEFAULT false,
    auto_create_bill_on_dispensing boolean DEFAULT true,
    auto_charge_amount boolean DEFAULT true,
    bill_immediately boolean DEFAULT false,
    require_bill_approval_above numeric(15,2),
    allow_returns boolean DEFAULT true,
    return_window_days integer DEFAULT 7,
    auto_reverse_inventory_on_return boolean DEFAULT true,
    pharmacy_revenue_account_id character varying(36),
    pharmacy_cogs_account_id character varying(36),
    pharmacy_discount_account_id character varying(36),
    pharmacy_receivables_account_id character varying(36),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: physical_count_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.physical_count_lines (
    id character varying(36) NOT NULL,
    count_id character varying(36) NOT NULL,
    item_id character varying(36) NOT NULL,
    location_id character varying(36),
    batch_id character varying(36),
    system_quantity integer DEFAULT 0,
    counted_quantity integer DEFAULT 0,
    variance integer DEFAULT 0,
    counted_by character varying(36),
    count_time time without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: physical_inventory_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.physical_inventory_counts (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    count_number character varying(100) NOT NULL,
    count_date date,
    count_type character varying(20) DEFAULT 'full_count'::character varying,
    location_id character varying(36),
    total_items_counted integer DEFAULT 0,
    total_items_system integer DEFAULT 0,
    variance_count integer DEFAULT 0,
    variance_percentage numeric(5,2) DEFAULT 0,
    status character varying(20) DEFAULT 'in_progress'::character varying,
    completed_by character varying(36),
    completed_date date,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: pr_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pr_line_items (
    id character varying(36) NOT NULL,
    pr_id character varying(36) NOT NULL,
    line_number integer DEFAULT 0,
    item_code character varying(100),
    item_description character varying(255) NOT NULL,
    item_specification text,
    quantity_required integer DEFAULT 1 NOT NULL,
    unit_of_measure character varying(20) DEFAULT 'pcs'::character varying,
    estimated_unit_price numeric(10,2) DEFAULT 0,
    estimated_line_total numeric(15,2) DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: prescription_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescription_lines (
    id character varying(36) NOT NULL,
    prescription_id character varying(36) NOT NULL,
    line_number integer DEFAULT 1,
    drug_id character varying(36) NOT NULL,
    quantity_prescribed integer DEFAULT 1,
    unit_of_measure character varying(20) DEFAULT 'tablet'::character varying,
    dose_strength character varying(100),
    frequency character varying(100),
    duration_days integer,
    allow_generic_substitution boolean DEFAULT true,
    allow_brand_substitution boolean DEFAULT false,
    preferred_generic character varying(255),
    preferred_brand character varying(255),
    status character varying(30) DEFAULT 'pending'::character varying,
    total_quantity_dispensed integer DEFAULT 0,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid,
    visit_id uuid,
    drug_name character varying(255) NOT NULL,
    dosage character varying(100),
    frequency character varying(100),
    duration character varying(100),
    quantity integer,
    instructions text,
    prescribed_by uuid,
    prescribed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'active'::character varying,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    clinic_id integer DEFAULT 1
);


--
-- Name: procurement_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procurement_settings (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    pr_approval_threshold numeric(15,2) DEFAULT 10000,
    po_approval_threshold_level1 numeric(15,2) DEFAULT 5000,
    po_approval_threshold_level2 numeric(15,2) DEFAULT 25000,
    po_approval_threshold_level3 numeric(15,2) DEFAULT 100000,
    require_grn_before_invoice boolean DEFAULT true,
    require_3way_matching boolean DEFAULT true,
    allow_over_receipt_percentage numeric(5,2) DEFAULT 5,
    allow_price_variance_percentage numeric(5,2) DEFAULT 2,
    require_quotes_for_amount_above numeric(15,2) DEFAULT 50000,
    min_suppliers_for_quotes integer DEFAULT 3,
    enforce_budget_before_po boolean DEFAULT true,
    default_lead_days integer DEFAULT 7,
    default_payment_terms character varying(50) DEFAULT 'Net30'::character varying,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: purchase_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_items (
    id integer NOT NULL,
    purchase_order_id integer NOT NULL,
    item_name character varying(255) NOT NULL,
    description text,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) DEFAULT 0 NOT NULL,
    total_price numeric(10,2) DEFAULT 0 NOT NULL,
    unit_of_measure character varying(50) DEFAULT 'Each'::character varying,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    line_number integer DEFAULT 0,
    quantity_received integer DEFAULT 0,
    quantity_invoiced integer DEFAULT 0,
    tax_amount numeric(15,2) DEFAULT 0,
    cost_center_id character varying(36),
    gl_account_id character varying(36),
    status character varying(20) DEFAULT 'pending'::character varying,
    inventory_item_id character varying(36),
    inventory_location_id character varying(36)
);


--
-- Name: purchase_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_order_items_id_seq OWNED BY public.purchase_order_items.id;


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id integer NOT NULL,
    po_number character varying(255) NOT NULL,
    supplier_id integer NOT NULL,
    order_date timestamp with time zone NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    status public.enum_purchase_orders_status DEFAULT 'draft'::public.enum_purchase_orders_status,
    notes text,
    check_signature text,
    check_signed_by character varying(255),
    check_signed_at timestamp with time zone,
    approved_signature text,
    approved_signed_by character varying(255),
    approved_signed_at timestamp with time zone,
    authorized_signature text,
    authorized_signed_by character varying(255),
    authorized_signed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    clinic_id integer,
    pr_id character varying(36),
    po_type character varying(20) DEFAULT 'standard'::character varying,
    delivery_address text,
    requested_delivery_date date,
    expected_delivery_date date,
    delivery_date_actual date,
    subtotal numeric(15,2) DEFAULT 0,
    tax_amount numeric(15,2) DEFAULT 0,
    tax_rate numeric(5,2) DEFAULT 0,
    shipping_cost numeric(15,2) DEFAULT 0,
    po_currency character varying(3) DEFAULT 'SSP'::character varying,
    exchange_rate numeric(15,6) DEFAULT 1,
    base_currency_total numeric(15,2) DEFAULT 0,
    payment_terms character varying(50) DEFAULT 'Net30'::character varying,
    terms_conditions text,
    created_by character varying(36),
    paid_amount numeric(15,2) DEFAULT 0,
    payment_status character varying(20) DEFAULT 'unpaid'::character varying
);


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_orders_id_seq OWNED BY public.purchase_orders.id;


--
-- Name: purchase_requisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_requisitions (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    pr_number character varying(100) NOT NULL,
    requisition_date date NOT NULL,
    requested_by character varying(36) NOT NULL,
    department character varying(100),
    cost_center_id character varying(36),
    requisition_type character varying(20) DEFAULT 'routine'::character varying,
    delivery_date_required date,
    total_amount numeric(15,2) DEFAULT 0,
    currency character varying(3) DEFAULT 'SSP'::character varying,
    status character varying(20) DEFAULT 'draft'::character varying,
    approved_by character varying(36),
    approval_date date,
    rejection_reason text,
    notes text,
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    receipt_number character varying(100) NOT NULL,
    patient_id uuid,
    patient_name character varying(255),
    total_amount numeric(10,2) NOT NULL,
    amount_paid numeric(10,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    cashier_id uuid,
    cashier_name character varying(255),
    clinic character varying(100),
    issued_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    bill_id character varying(36),
    payment_amount numeric(10,2) DEFAULT 0.00,
    payment_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    paid_services text,
    service_details text,
    notes text,
    from_lease boolean DEFAULT false,
    lease_details text,
    status character varying(20) DEFAULT 'active'::character varying,
    clinic_id integer DEFAULT 1,
    receipt_currency character varying(3) DEFAULT 'SSP'::character varying,
    exchange_rate numeric(15,6) DEFAULT 1.000000,
    base_currency_amount numeric(15,2) DEFAULT 0,
    payment_description text,
    reference_number character varying(100),
    insurance_payment boolean DEFAULT false,
    insurance_claim_ref character varying(100),
    cash_gl_entry_id character varying(36),
    receivables_gl_entry_id character varying(36),
    is_voided boolean DEFAULT false,
    is_refunded boolean DEFAULT false,
    refund_amount numeric(15,2) DEFAULT 0,
    refund_date date,
    refund_reason text,
    reversal_gl_entry_id character varying(36),
    bank_transaction_id character varying(36),
    is_reconciled boolean DEFAULT false,
    reconciliation_date date
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id character(36) NOT NULL,
    ward_id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    room_number character varying(100) NOT NULL,
    room_type character varying(100) DEFAULT 'standard'::character varying,
    description text,
    capacity integer DEFAULT 0,
    current_occupancy integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_changes_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_changes_history (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    change_type character varying(100),
    field_changed character varying(255),
    old_value text,
    new_value text,
    change_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    changed_by character(36),
    reason text
);


--
-- Name: scheme_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_discounts (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    discount_code character varying(100) NOT NULL,
    discount_type character varying(50) DEFAULT 'percentage'::character varying,
    discount_name character varying(255),
    discount_value numeric(15,2),
    applies_to character varying(50) DEFAULT 'all'::character varying,
    service_ids json,
    product_ids json,
    min_bill_amount numeric(15,2),
    min_items_qty integer,
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true,
    requires_approval boolean DEFAULT false,
    approval_by_roles json,
    notes text,
    created_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_membership (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    patient_id uuid NOT NULL,
    member_number character varying(100),
    effective_from date NOT NULL,
    effective_to date,
    is_active boolean DEFAULT true,
    verified boolean DEFAULT false,
    verified_by character(36),
    verified_date date,
    verification_document_path character varying(500),
    relationship_to_member character varying(100) DEFAULT 'self'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_negotiated_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_negotiated_prices (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    negotiation_number character varying(100) NOT NULL,
    negotiation_date date,
    negotiated_by_user_id character(36),
    applies_to character varying(100),
    reference_id character(36),
    negotiation_type character varying(50) DEFAULT 'custom'::character varying,
    negotiated_price numeric(15,2),
    original_price numeric(15,2),
    discount_amount numeric(15,2),
    discount_percentage numeric(5,2),
    valid_from date,
    valid_to date,
    quantity_limit integer,
    quantity_used integer DEFAULT 0,
    approved_by character(36),
    approval_date timestamp without time zone,
    approval_notes text,
    status character varying(50) DEFAULT 'proposed'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_price_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_price_rules (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    rule_name character varying(255),
    rule_description text,
    condition_type character varying(50) DEFAULT 'service_category'::character varying,
    condition_value character varying(255),
    action_type character varying(50) DEFAULT 'apply_discount'::character varying,
    action_value numeric(15,2),
    formula text,
    priority integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_product_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_product_pricing (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    product_id character(36) NOT NULL,
    product_type character varying(50) DEFAULT 'drug'::character varying,
    scheme_price numeric(15,2),
    scheme_currency character varying(3) DEFAULT 'SSP'::character varying,
    markup_percentage numeric(5,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0,
    insurance_copay numeric(15,2),
    insurance_copay_percentage numeric(5,2),
    insurance_coverage_amount numeric(15,2),
    min_quantity integer,
    max_quantity integer,
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true,
    notes text,
    created_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_product_pricing_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_product_pricing_history (
    id character(36) NOT NULL,
    scheme_id character(36) NOT NULL,
    product_id character(36) NOT NULL,
    product_type character varying(50),
    old_price numeric(15,2),
    new_price numeric(15,2),
    old_copay numeric(15,2),
    new_copay numeric(15,2),
    price_change_reason text,
    effective_date date,
    changed_by character(36),
    change_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_service_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_service_pricing (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    service_id character(36) NOT NULL,
    scheme_price numeric(15,2),
    scheme_currency character varying(3) DEFAULT 'SSP'::character varying,
    markup_percentage numeric(5,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0,
    insurance_copay numeric(15,2),
    insurance_copay_percentage numeric(5,2),
    insurance_coverage_amount numeric(15,2),
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true,
    notes text,
    revenue_account_id character(36),
    created_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_service_pricing_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_service_pricing_history (
    id character(36) NOT NULL,
    scheme_id character(36) NOT NULL,
    service_id character(36) NOT NULL,
    old_price numeric(15,2),
    new_price numeric(15,2),
    old_copay numeric(15,2),
    new_copay numeric(15,2),
    price_change_reason text,
    effective_date date,
    changed_by character(36),
    change_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: scheme_tiered_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheme_tiered_pricing (
    id character(36) NOT NULL,
    clinic_id integer NOT NULL,
    scheme_id character(36) NOT NULL,
    service_id character(36),
    product_id character(36),
    product_type character varying(50),
    tier_level integer,
    tier_name character varying(100),
    min_quantity integer,
    max_quantity integer,
    tier_price numeric(15,2),
    tier_currency character varying(3) DEFAULT 'SSP'::character varying,
    tier_discount_percentage numeric(5,2) DEFAULT 0,
    tier_copay numeric(15,2),
    effective_from date,
    effective_to date,
    is_active boolean DEFAULT true,
    created_by character(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id character varying(36) DEFAULT (public.uuid_generate_v4())::text NOT NULL,
    service_name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    price numeric(10,2) DEFAULT 0.00 NOT NULL,
    description text,
    department_id character varying(36),
    is_active boolean DEFAULT true,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    service_category character varying(50) DEFAULT 'other'::character varying,
    service_code character varying(100),
    price_kes numeric(15,2),
    price_usd numeric(15,2),
    price_ssp numeric(15,2),
    revenue_account_id character varying(36),
    nhif_approved boolean DEFAULT false,
    nhif_rate numeric(15,2),
    patient_copay_amount numeric(15,2) DEFAULT 0,
    is_consumable boolean DEFAULT false,
    inventory_item_id character varying(36),
    requires_quantity boolean DEFAULT true,
    unit_of_measure character varying(20)
);


--
-- Name: stock_by_location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_by_location (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    item_id character varying(36) NOT NULL,
    location_id character varying(36) NOT NULL,
    quantity_on_hand integer DEFAULT 0,
    reserved_quantity integer DEFAULT 0,
    last_counted date,
    last_counted_by character varying(36),
    recount_required boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: stock_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_locations (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    location_code character varying(50) NOT NULL,
    location_name character varying(255) NOT NULL,
    location_type character varying(50) DEFAULT 'warehouse'::character varying,
    address text,
    manager_user_id character varying(36),
    is_active boolean DEFAULT true,
    capacity_description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id integer
);


--
-- Name: supplier_bill_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_bill_approvals (
    id character varying(36) NOT NULL,
    po_id character varying(36) NOT NULL,
    approval_level integer NOT NULL,
    approved_by character varying(255) NOT NULL,
    approved_by_title character varying(100),
    notes text,
    approved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id character varying(36),
    signature text
);


--
-- Name: supplier_bill_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_bill_payments (
    id character varying(36) NOT NULL,
    clinic_id integer,
    po_id character varying(36) NOT NULL,
    po_number character varying(100),
    supplier_id integer,
    supplier_name character varying(255),
    payment_date date NOT NULL,
    amount_paid numeric(15,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    account_id character varying(36),
    account_name character varying(255),
    reference_number character varying(100),
    notes text,
    payment_voucher_number character varying(100),
    paid_by character varying(255),
    approved_by character varying(255),
    created_by character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: supplier_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_performance (
    id character varying(36) NOT NULL,
    clinic_id integer NOT NULL,
    supplier_id integer NOT NULL,
    evaluation_date date NOT NULL,
    delivery_timeliness integer DEFAULT 3,
    quality_of_goods integer DEFAULT 3,
    communication integer DEFAULT 3,
    pricing_competitiveness integer DEFAULT 3,
    overall_rating numeric(3,1) DEFAULT 3.0,
    comments text,
    evaluator_id character varying(36),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    contact_person character varying(255),
    phone character varying(255),
    email character varying(255),
    address text,
    town character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    clinic_id integer,
    supplier_code character varying(50),
    supplier_type character varying(50) DEFAULT 'general'::character varying,
    tax_id character varying(50),
    bank_account_name character varying(255),
    bank_account_number character varying(50),
    bank_name character varying(255),
    payment_terms character varying(50) DEFAULT 'Net30'::character varying,
    credit_limit numeric(15,2) DEFAULT 0,
    currency character varying(3) DEFAULT 'SSP'::character varying,
    is_preferred boolean DEFAULT false,
    on_hold boolean DEFAULT false,
    hold_reason text,
    performance_rating numeric(3,1) DEFAULT 0,
    total_purchases numeric(15,2) DEFAULT 0,
    total_paid numeric(15,2) DEFAULT 0,
    country character varying(100) DEFAULT 'South Sudan'::character varying
);


--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: user_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_branches (
    id integer NOT NULL,
    user_id uuid,
    branch_id integer,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_branches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_branches_id_seq OWNED BY public.user_branches.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) DEFAULT ''::character varying NOT NULL,
    display_name character varying(255),
    role character varying(50) DEFAULT 'doctor'::character varying,
    clinic character varying(100) DEFAULT 'IntelliCare'::character varying,
    is_active boolean DEFAULT true,
    signature text,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    clinic_id integer DEFAULT 1,
    status character varying(50) DEFAULT 'active'::character varying
);


--
-- Name: visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visits (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    patient_id uuid,
    visit_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    chief_complaint text,
    clinical_notes text,
    vitals text,
    lab_requests text,
    diagnosis character varying(500),
    diagnosis_code character varying(50),
    patient_name character varying(255),
    doctor_name character varying(255),
    doctor_id uuid,
    queue_id uuid,
    status character varying(50) DEFAULT 'active'::character varying,
    clinic_id integer,
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    prescription text,
    follow_up_date date,
    visit_type character varying(50) DEFAULT 'outpatient'::character varying,
    closed_at timestamp without time zone,
    closed_by character varying(255),
    completed_at timestamp without time zone
);


--
-- Name: wards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wards (
    id character(36) NOT NULL,
    clinic_id character varying(36) NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    ward_type character varying(100) DEFAULT 'general'::character varying,
    capacity integer DEFAULT 0,
    current_occupancy integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: cash_transfers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transfers ALTER COLUMN id SET DEFAULT nextval('public.cash_transfers_id_seq'::regclass);


--
-- Name: cashier_shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashier_shifts ALTER COLUMN id SET DEFAULT nextval('public.cashier_shifts_id_seq'::regclass);


--
-- Name: clinic_names id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_names ALTER COLUMN id SET DEFAULT nextval('public.clinic_names_id_seq'::regclass);


--
-- Name: currencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies ALTER COLUMN id SET DEFAULT nextval('public.currencies_id_seq'::regclass);


--
-- Name: daily_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_expenses ALTER COLUMN id SET DEFAULT nextval('public.daily_expenses_id_seq'::regclass);


--
-- Name: daily_financial_summary id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_financial_summary ALTER COLUMN id SET DEFAULT nextval('public.daily_financial_summary_id_seq'::regclass);


--
-- Name: facilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities ALTER COLUMN id SET DEFAULT nextval('public.facilities_id_seq'::regclass);


--
-- Name: ledger_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_accounts ALTER COLUMN id SET DEFAULT nextval('public.ledger_accounts_id_seq'::regclass);


--
-- Name: multicurrency_report_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multicurrency_report_settings ALTER COLUMN id SET DEFAULT nextval('public.multicurrency_report_settings_id_seq'::regclass);


--
-- Name: purchase_order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_order_items_id_seq'::regclass);


--
-- Name: purchase_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders ALTER COLUMN id SET DEFAULT nextval('public.purchase_orders_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: user_branches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches ALTER COLUMN id SET DEFAULT nextval('public.user_branches_id_seq'::regclass);


--
-- Data for Name: account_currency_balances; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.account_currency_balances (id, clinic_id, account_id, currency_code, balance_in_currency, balance_in_base_currency, last_conversion_rate, last_conversion_date, unrealized_gain_loss, last_updated) FROM stdin;
\.


--
-- Data for Name: account_ledger; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.account_ledger (id, clinic_id, account_id, transaction_id, transaction_date, debit_amount, credit_amount, reference_number, description, posted_by, posted_date, is_posted, source_module, created_at, updated_at) FROM stdin;
0f6e3c3d-2fd0-4996-b1cc-ae372f19a947	1	9eba4107-889c-4c2f-ba38-395f747dafa4	79e3eabe-df95-40ae-9eb7-f9ecc998777b	2026-03-23	20000.00	0.00	413451c3-c20b-4558-b711-92d398c8a664	Patient receivable - Single Dee	Admin Kembe	2026-03-23 21:45:25.853	t	patient_billing	2026-03-23 21:45:25.44	2026-03-23 21:45:25.872
4c39bbe6-c4ea-43ee-83a8-069252a161b5	1	fa91f080-6749-46ca-844b-8cbf43a9d406	79e3eabe-df95-40ae-9eb7-f9ecc998777b	2026-03-23	0.00	20000.00	413451c3-c20b-4558-b711-92d398c8a664	Patient services revenue - Single Dee	Admin Kembe	2026-03-23 21:45:25.853	t	patient_billing	2026-03-23 21:45:25.595	2026-03-23 21:45:25.872
9c914f86-d545-44b1-8803-d5b4b1693ee1	1	9eba4107-889c-4c2f-ba38-395f747dafa4	953de3f2-11b9-412e-b2d9-2cb37893014f	2026-03-24	20000.00	0.00	5e631277-4e10-4cf0-8329-a989ca959d7f	Patient receivable - John Ohisa	Admin Kembe	2026-03-24 07:47:45.095	t	patient_billing	2026-03-24 07:47:44.951	2026-03-24 07:47:45.096
c358b8b7-10f7-4181-9687-c734dcda3b63	1	fa91f080-6749-46ca-844b-8cbf43a9d406	953de3f2-11b9-412e-b2d9-2cb37893014f	2026-03-24	0.00	20000.00	5e631277-4e10-4cf0-8329-a989ca959d7f	Patient services revenue - John Ohisa	Admin Kembe	2026-03-24 07:47:45.095	t	patient_billing	2026-03-24 07:47:44.979	2026-03-24 07:47:45.096
7c1289af-4212-4006-bb1c-b9948aa556bc	1	9eba4107-889c-4c2f-ba38-395f747dafa4	126ff051-4ea5-4ec4-bc57-0fc48576aa15	2026-03-24	50000.00	0.00	2628dd55-5807-4e83-90ef-3543ed332f92	Patient receivable - John Ohisa	Admin Kembe	2026-03-24 08:52:30.516	t	patient_billing	2026-03-24 08:52:30.428	2026-03-24 08:52:30.523
2ee80fe4-4cc3-42d5-a29f-67f8261ecc10	1	fa91f080-6749-46ca-844b-8cbf43a9d406	126ff051-4ea5-4ec4-bc57-0fc48576aa15	2026-03-24	0.00	50000.00	2628dd55-5807-4e83-90ef-3543ed332f92	Patient services revenue - John Ohisa	Admin Kembe	2026-03-24 08:52:30.516	t	patient_billing	2026-03-24 08:52:30.459	2026-03-24 08:52:30.523
12665308-dbd5-4531-b861-ac7c212dc7e4	1	9eba4107-889c-4c2f-ba38-395f747dafa4	a549c852-a2b1-441a-9fb1-e4c97a000e35	2026-03-24	20000.00	0.00	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	Patient receivable - Lil Been	Admin Kembe	2026-03-24 09:12:54.367	t	patient_billing	2026-03-24 09:12:54.329	2026-03-24 09:12:54.37
2f984a12-6dfa-4bbf-ac62-8320b80eee45	1	fa91f080-6749-46ca-844b-8cbf43a9d406	a549c852-a2b1-441a-9fb1-e4c97a000e35	2026-03-24	0.00	20000.00	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	Patient services revenue - Lil Been	Admin Kembe	2026-03-24 09:12:54.367	t	patient_billing	2026-03-24 09:12:54.336	2026-03-24 09:12:54.37
fa541f2d-5bc1-47ac-9de8-4250202a79a3	1	9eba4107-889c-4c2f-ba38-395f747dafa4	46a97acd-3966-4fbf-8787-4cfce70c881a	2026-03-24	20000.00	0.00	c2f7de2e-fadf-43bc-90f7-a7c664f08964	Patient receivable - Narting Abui Joseph	Admin Kembe	2026-03-24 09:28:10.442	t	patient_billing	2026-03-24 09:28:10.38	2026-03-24 09:28:10.444
1e827629-a437-4128-bed9-c6f0b6433171	1	fa91f080-6749-46ca-844b-8cbf43a9d406	46a97acd-3966-4fbf-8787-4cfce70c881a	2026-03-24	0.00	20000.00	c2f7de2e-fadf-43bc-90f7-a7c664f08964	Patient services revenue - Narting Abui Joseph	Admin Kembe	2026-03-24 09:28:10.442	t	patient_billing	2026-03-24 09:28:10.391	2026-03-24 09:28:10.444
3f6dc378-8a37-458e-b732-6700197d6601	1	9eba4107-889c-4c2f-ba38-395f747dafa4	bcafef8e-8a72-4b16-9057-4253546b3f21	2026-03-24	20000.00	0.00	5efd31a9-5c99-4933-acec-c97f70d974aa	Patient receivable - Narting Abui Joseph	Admin Kembe	2026-03-24 10:18:51.66	t	patient_billing	2026-03-24 10:18:51.581	2026-03-24 10:18:51.66
1c71683c-525e-4e20-8000-c8a6a602adaa	1	fa91f080-6749-46ca-844b-8cbf43a9d406	bcafef8e-8a72-4b16-9057-4253546b3f21	2026-03-24	0.00	20000.00	5efd31a9-5c99-4933-acec-c97f70d974aa	Patient services revenue - Narting Abui Joseph	Admin Kembe	2026-03-24 10:18:51.66	t	patient_billing	2026-03-24 10:18:51.603	2026-03-24 10:18:51.66
ef4cb88e-6e67-4417-8008-813043f4f07a	1	9eba4107-889c-4c2f-ba38-395f747dafa4	883cb645-96d2-481c-a47c-ce83ed8cc51e	2026-03-24	20000.00	0.00	a1288878-7b04-484f-a460-b4ec6d67a7ca	Patient receivable - John Ohisa	Admin Kembe	2026-03-24 10:31:33.217	t	patient_billing	2026-03-24 10:31:33.161	2026-03-24 10:31:33.217
045fdde7-494a-43f7-96a1-3175d0aef5e8	1	fa91f080-6749-46ca-844b-8cbf43a9d406	883cb645-96d2-481c-a47c-ce83ed8cc51e	2026-03-24	0.00	20000.00	a1288878-7b04-484f-a460-b4ec6d67a7ca	Patient services revenue - John Ohisa	Admin Kembe	2026-03-24 10:31:33.217	t	patient_billing	2026-03-24 10:31:33.194	2026-03-24 10:31:33.217
5d32ff2b-0b53-459a-8f49-7189c96206da	1	9eba4107-889c-4c2f-ba38-395f747dafa4	c9fe63a2-077f-4954-aa91-e428ebef702b	2026-03-30	20000.00	0.00	69125236-c7b5-4aa8-a221-891e07ec2067	Patient receivable - Martin Ssebuga	Admin Kembe	2026-03-30 16:58:28.555	t	patient_billing	2026-03-30 16:58:28.286	2026-03-30 16:58:28.58
ba1fa124-6361-4645-984a-6724b67ff8e5	1	fa91f080-6749-46ca-844b-8cbf43a9d406	c9fe63a2-077f-4954-aa91-e428ebef702b	2026-03-30	0.00	20000.00	69125236-c7b5-4aa8-a221-891e07ec2067	Patient services revenue - Martin Ssebuga	Admin Kembe	2026-03-30 16:58:28.555	t	patient_billing	2026-03-30 16:58:28.348	2026-03-30 16:58:28.58
696370d9-c2fd-4072-be2a-f1c16d70ca1b	1	9eba4107-889c-4c2f-ba38-395f747dafa4	ef27ae78-8dd3-469d-b497-057cfb234f8a	2026-03-31	50000.00	0.00	0028c2e4-05b8-455c-bfa1-e0a31ef75afd	Patient receivable - Lil Been	Admin Kembe	2026-03-31 10:59:21.75	t	patient_billing	2026-03-31 10:59:21.697	2026-03-31 10:59:21.751
7b1c036f-ad9c-4a5d-8a25-327f92eb47c3	1	fa91f080-6749-46ca-844b-8cbf43a9d406	ef27ae78-8dd3-469d-b497-057cfb234f8a	2026-03-31	0.00	50000.00	0028c2e4-05b8-455c-bfa1-e0a31ef75afd	Patient services revenue - Lil Been	Admin Kembe	2026-03-31 10:59:21.75	t	patient_billing	2026-03-31 10:59:21.706	2026-03-31 10:59:21.751
867514da-5809-4a68-8cfc-a3d89af5cb3d	1	110c5b3b-8445-46c9-bfbd-b3f2a1207639	\N	2026-03-31	70000.00	0.00	JE-202603-0001	Cash Transfer from Cash	\N	2026-03-31 11:07:09.422	t	cash_transfer	2026-03-31 11:07:09.422	2026-03-31 11:07:09.422
6837a537-5d80-4157-ad4e-a6154cf7737a	1	110c5b3b-8445-46c9-bfbd-b3f2a1207639	\N	2026-03-31	0.00	70000.00	JE-202603-0001	Cash Transfer to Cash	\N	2026-03-31 11:07:09.422	t	cash_transfer	2026-03-31 11:07:09.422	2026-03-31 11:07:09.422
72fe6f4d-a1f4-4c2f-b53c-8566ff6eccab	1	9eba4107-889c-4c2f-ba38-395f747dafa4	5f8d3e77-bbe5-436b-810f-a6eeaee19317	2026-03-31	50000.00	0.00	95cf980c-2ecb-4da1-9c36-81d821b63e5d	Patient receivable - Maria Anthony	Admin Kembe	2026-03-31 11:47:54.611	t	patient_billing	2026-03-31 11:47:54.528	2026-03-31 11:47:54.616
b9073daf-fb01-4ab5-a5fb-4695e9dfca1b	1	fa91f080-6749-46ca-844b-8cbf43a9d406	5f8d3e77-bbe5-436b-810f-a6eeaee19317	2026-03-31	0.00	50000.00	95cf980c-2ecb-4da1-9c36-81d821b63e5d	Patient services revenue - Maria Anthony	Admin Kembe	2026-03-31 11:47:54.611	t	patient_billing	2026-03-31 11:47:54.57	2026-03-31 11:47:54.616
6b197758-2abb-4796-9438-4ffd520f9e2e	1	b73ebe93-4804-4972-bf35-bb5da70ffe52	\N	2026-03-31	50000.00	0.00	JE-202603-0002	Cash Transfer from Cash at Hand	\N	2026-03-31 11:48:31.983	t	cash_transfer	2026-03-31 11:48:31.983	2026-03-31 11:48:31.983
9809ee62-8bda-40c4-8e20-3ab24470a3c2	1	b73ebe93-4804-4972-bf35-bb5da70ffe52	\N	2026-03-31	0.00	50000.00	JE-202603-0002	Cash Transfer to Cash at Hand	\N	2026-03-31 11:48:31.983	t	cash_transfer	2026-03-31 11:48:31.983	2026-03-31 11:48:31.983
1164ed09-d5ac-4d9f-9fcd-b8f2daebd4e1	1	9eba4107-889c-4c2f-ba38-395f747dafa4	e693d4b0-a161-49ec-9716-674f5270835f	2026-04-03	20000.00	0.00	b945c6d0-e80f-4d44-b96e-85f2cb456107	Patient receivable - Maria Anthony	Admin Kembe	2026-04-03 01:42:29.246	t	patient_billing	2026-04-03 01:42:29.101	2026-04-03 01:42:29.249
3a3e3368-d7f1-4bfb-acea-9c1d26241230	1	fa91f080-6749-46ca-844b-8cbf43a9d406	e693d4b0-a161-49ec-9716-674f5270835f	2026-04-03	0.00	20000.00	b945c6d0-e80f-4d44-b96e-85f2cb456107	Revenue - Maria Anthony	Admin Kembe	2026-04-03 01:42:29.246	t	patient_billing	2026-04-03 01:42:29.15	2026-04-03 01:42:29.249
f90b5430-6d7c-4a96-a4c8-ffc5e605dcdb	1	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	\N	2026-04-06	200.00	0.00	JE-202604-0001	Cash Transfer from Cash	\N	2026-04-06 17:11:46.085	t	cash_transfer	2026-04-06 17:11:46.085	2026-04-06 17:11:46.085
ff60acfe-554e-4240-b13a-bcccb9bf89db	1	110c5b3b-8445-46c9-bfbd-b3f2a1207639	\N	2026-04-06	0.00	200.00	JE-202604-0001	Cash Transfer to Petty Cash	\N	2026-04-06 17:11:46.085	t	cash_transfer	2026-04-06 17:11:46.085	2026-04-06 17:11:46.085
b289e3d3-8df1-4cd7-b970-37609e842f7c	1	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	\N	2026-04-06	200000.00	0.00	JE-202604-0002	Cash Transfer from Accounts Receivable - Patients	\N	2026-04-06 17:17:47.073	t	cash_transfer	2026-04-06 17:17:47.073	2026-04-06 17:17:47.073
64a3919e-efa8-40e9-8d5a-afe6ed1692bd	1	9eba4107-889c-4c2f-ba38-395f747dafa4	\N	2026-04-06	0.00	200000.00	JE-202604-0002	Cash Transfer to Petty Cash	\N	2026-04-06 17:17:47.073	t	cash_transfer	2026-04-06 17:17:47.073	2026-04-06 17:17:47.073
71d5a926-fa77-44b7-83be-70e009f9886a	1	b73ebe93-4804-4972-bf35-bb5da70ffe52	\N	2026-04-06	20000.00	0.00	JE-202604-0003	Payment received (cash) - RCP-01236119	\N	2026-04-06 18:47:16.163	t	billing	2026-04-06 18:47:16.163	2026-04-06 18:47:16.163
aa70f949-c58f-401a-bf6e-4bb6cc0ad9ef	1	9eba4107-889c-4c2f-ba38-395f747dafa4	\N	2026-04-06	0.00	20000.00	JE-202604-0003	Revenue from bill b945c6d0-e80f-4d44-b96e-85f2cb456107 - RCP-01236119	\N	2026-04-06 18:47:16.163	t	billing	2026-04-06 18:47:16.163	2026-04-06 18:47:16.163
\.


--
-- Data for Name: accounting_suppliers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.accounting_suppliers (id, clinic_id, supplier_name, supplier_code, contact_person, phone, email, address, tax_id, payment_terms, opening_balance, currency, is_active, account_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, clinic_id, user_id, user_name, user_role, module, action, entity_type, entity_id, description, old_values, new_values, ip_address, user_agent, status, created_at) FROM stdin;
f16de0eb-5912-467c-a89e-6ad277f04722	1	a63c3829-1709-49da-ae07-699d0e52082c	Admin Kembe	admin	Authentication	LOGIN	User	a63c3829-1709-49da-ae07-699d0e52082c	User Admin Kembe logged in	\N	\N	127.0.0.1	Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0	success	2026-04-06 19:35:45.070621
f08eb156-217c-4c28-8d0f-bec26a3cd9c9	1	a63c3829-1709-49da-ae07-699d0e52082c	Admin Kembe	admin	Authentication	LOGIN	User	a63c3829-1709-49da-ae07-699d0e52082c	User Admin Kembe logged in	\N	\N	127.0.0.1	Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0	success	2026-04-06 19:49:17.065919
\.


--
-- Data for Name: batch_insurance_claims; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.batch_insurance_claims (id, clinic_id, batch_number, scheme_id, scheme_name, scheme_code, claim_amount, invoice_count, status, notes, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: batch_usage_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.batch_usage_history (id, batch_id, usage_date, quantity_used, usage_type, reference_id, reference_type, used_by, notes, created_at) FROM stdin;
\.


--
-- Data for Name: beds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.beds (id, room_id, ward_id, clinic_id, bed_number, bed_type, status, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: bill_discounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bill_discounts (id, clinic_id, bill_id, discount_number, discount_type, discount_amount, discount_percentage, reason, approved_by, approval_date, approval_notes, discount_gl_entry_id, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: bill_line_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bill_line_items (id, bill_id, line_number, service_category, service_code, service_name, source_module, source_id, quantity, unit_price, line_currency, exchange_rate, base_currency_unit_price, line_total, base_currency_total, paid_amount, balance_amount, item_status, patient_copay, insurance_coverage, item_discount, discount_percentage, revenue_account_id, gl_entry_id, notes, created_at, updated_at) FROM stdin;
a9c8e73a-7f81-4d18-90db-d1332c7d7ff0	3b00ee38-4269-4db6-9e7d-66deb311d3ea	1	pharmacy	\N	absorbent gauze sponge x2	pharmacy_dispensing	380b181c-b1f2-4218-a9ce-5debbf147fcc	2	4000.00	SSP	1.000000	0.00	8000.00	0.00	0.00	8000.00	pending	0.00	0.00	0.00	0.00	\N	\N	\N	2026-04-06 16:04:37.561758	2026-04-06 16:04:37.561758
b72fdcd4-1040-4419-b250-a6b1bfe68560	3b00ee38-4269-4db6-9e7d-66deb311d3ea	2	pharmacy	\N	abnal x2	pharmacy_dispensing	eaa17c42-cefe-4029-a8aa-5848e56bfb2e	2	10000.00	SSP	1.000000	0.00	20000.00	0.00	0.00	20000.00	pending	0.00	0.00	0.00	0.00	\N	\N	\N	2026-04-06 16:04:37.81788	2026-04-06 16:04:37.81788
b2f5e264-98b2-4351-84c7-7e3d428c19c0	81bc2d45-ee9a-4245-846a-515ddf4e6d83	1	pharmacy	\N	abnal x1 [UNIVERSAL HOSPITAL STAFF]	pharmacy_dispensing	672bf401-1652-42dd-9f04-00c85973ee37	1	10000.00	SSP	1.000000	0.00	10000.00	0.00	0.00	10000.00	pending	0.00	0.00	0.00	0.00	\N	\N	\N	2026-04-06 16:09:32.582218	2026-04-06 16:09:32.582218
cc785214-e2b9-44e4-ae68-06836b07fd65	81bc2d45-ee9a-4245-846a-515ddf4e6d83	2	pharmacy	\N	Aciclovir x1 [UNIVERSAL HOSPITAL STAFF]	pharmacy_dispensing	ee90500a-d854-4eeb-b461-a1240f0b043d	1	5000.00	SSP	1.000000	0.00	5000.00	0.00	0.00	5000.00	pending	0.00	0.00	0.00	0.00	\N	\N	\N	2026-04-06 16:09:32.783294	2026-04-06 16:09:32.783294
7ba727fa-a3a9-4045-aeb3-cb424d922ccc	81bc2d45-ee9a-4245-846a-515ddf4e6d83	3	pharmacy	\N	absorbent gauze sponge x1 [UNIVERSAL HOSPITAL STAFF]	pharmacy_dispensing	0d1ca60b-edee-49af-aa8b-669fd53b1746	1	4000.00	SSP	1.000000	0.00	4000.00	0.00	0.00	4000.00	pending	0.00	0.00	0.00	0.00	\N	\N	\N	2026-04-06 16:11:20.43255	2026-04-06 16:11:20.43255
\.


--
-- Data for Name: billing_follow_ups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billing_follow_ups (id, clinic_id, bill_id, patient_id, follow_up_date, follow_up_type, follow_up_notes, outcome, next_follow_up_date, performed_by, created_at) FROM stdin;
\.


--
-- Data for Name: billing_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billing_settings (id, clinic_id, default_currency, default_revenue_account_id, default_payment_terms, default_due_date_days, allow_discounts, discount_approval_required_above, nhif_enabled, nhif_copay_percentage, auto_apply_insurance_copay, multi_currency_enabled, accepted_currencies, auto_bill_on_service, auto_bill_pharmacy_dispensing, auto_bill_lab_tests, auto_bill_clinical_visits, auto_post_to_gl, post_immediately, auto_calculate_aging, send_overdue_notices, overdue_notice_days, write_off_after_days, auto_write_off, allow_refunds, refund_approval_required, updated_at) FROM stdin;
\.


--
-- Data for Name: branch_access_audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.branch_access_audit_logs (id, user_id, branch_id, action, resource_type, resource_id, is_unauthorized, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: branches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.branches (id, name, facility_id, is_active, created_at, updated_at, description, is_main_branch, phone, email, address, city, region, country, manager_name, manager_phone, opening_time, closing_time, bed_capacity, staff_count) FROM stdin;
1	Main Branch	1	t	2026-03-23 15:10:22.800914	2026-03-23 21:13:31.719398	Main Branch	t	+211 925593647	info@universalhospital.com	Hai Jeruzalem Juba Town	Juba	CE	South Sudan	Peter Vuni	+211 925593647	08:00	17:00	30	0
\.


--
-- Data for Name: cash_transfers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cash_transfers (id, from_account_id, from_account_name, to_account_id, to_account_name, amount, notes, created_by, created_at, updated_at) FROM stdin;
1	110c5b3b-8445-46c9-bfbd-b3f2a1207639	Cash	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	Petty Cash	200.00	Cash transfer	system	2026-04-06 19:11:46.014+02	2026-04-06 19:11:46.014+02
2	9eba4107-889c-4c2f-ba38-395f747dafa4	Accounts Receivable - Patients	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	Petty Cash	200000.00	Cash transfer	system	2026-04-06 19:17:47.049+02	2026-04-06 19:17:47.049+02
\.


--
-- Data for Name: cashier_shifts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cashier_shifts (id, cashier_id, cashier_name, start_time, end_time, opening_balance, closing_balance, total_receipts, total_amount, status, notes, created_at, updated_at) FROM stdin;
1	a63c3829-1709-49da-ae07-699d0e52082c	kembe699@gmail.com	2026-03-23 23:46:38.225+02	2026-03-31 12:50:00.081+02	0.00	0.00	1	0.00	closed		2026-03-23 23:46:38.225+02	2026-03-31 12:50:00.084+02
2	a63c3829-1709-49da-ae07-699d0e52082c	kembe699@gmail.com	2026-03-31 12:50:34.298+02	2026-03-31 13:06:50.614+02	0.00	70000.00	3	70000.00	closed		2026-03-31 12:50:34.299+02	2026-03-31 13:06:50.616+02
3	a63c3829-1709-49da-ae07-699d0e52082c	kembe699@gmail.com	2026-03-31 13:10:02.017+02	2026-03-31 13:48:25.666+02	0.00	50000.00	1	50000.00	closed		2026-03-31 13:10:02.017+02	2026-03-31 13:48:25.666+02
4	a63c3829-1709-49da-ae07-699d0e52082c	kembe699@gmail.com	2026-04-03 03:41:25.081+02	\N	0.00	\N	0	0.00	open	\N	2026-04-03 03:41:25.081+02	2026-04-03 03:41:25.083+02
\.


--
-- Data for Name: chart_of_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.chart_of_accounts (id, clinic_id, account_code, account_name, account_type, sub_account_type, balance_type, opening_balance, opening_balance_date, is_active, is_bank_account, is_customer_account, is_supplier_account, description, created_by, created_at, updated_at, currency_code, is_multicurrency) FROM stdin;
110c5b3b-8445-46c9-bfbd-b3f2a1207639	1	1100	Cash	asset	current_asset	debit	0.00	2026-03-23	t	t	f	f	Cash on hand and petty cash	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
e5a62e3a-2804-4fa2-9ab7-962937b9e1cf	1	1110	Bank Account - Main	asset	current_asset	debit	0.00	2026-03-23	t	t	f	f	Main operating bank account	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
2833f8b7-405f-4b9f-b275-34b14f617563	1	1120	Bank Account - Savings	asset	current_asset	debit	0.00	2026-03-23	t	t	f	f	Savings account	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
bd3d088f-6568-446c-a3a6-3c4620d0bde6	1	1210	Insurance Receivables	asset	current_asset	debit	0.00	2026-03-23	t	f	f	f	Outstanding insurance claims	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
d8648971-75d8-416f-9f5b-dc64158f817b	1	1300	Medical Supplies Inventory	asset	current_asset	debit	0.00	2026-03-23	t	f	f	f	Medical supplies and consumables	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
9f640af7-d4f6-4ddd-bc2b-aac17a5c02da	1	1310	Pharmaceutical Inventory	asset	current_asset	debit	0.00	2026-03-23	t	f	f	f	Pharmaceutical drugs and medicines	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
545e5f18-8f2d-4e89-a008-f3f86ec200b2	1	1320	Office Supplies Inventory	asset	current_asset	debit	0.00	2026-03-23	t	f	f	f	Office supplies and stationery	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
1faba517-b87f-4cef-8a0b-16e48dee1404	1	1400	Prepaid Expenses	asset	current_asset	debit	0.00	2026-03-23	t	f	f	f	Prepaid insurance, rent, etc.	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
f53ec9a5-966f-4b26-9b66-8fd7c00049b3	1	1500	Medical Equipment	asset	fixed_asset	debit	0.00	2026-03-23	t	f	f	f	Medical equipment and instruments	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
08823f04-d534-4471-9927-3ddbd41a8dfc	1	1510	Laboratory Equipment	asset	fixed_asset	debit	0.00	2026-03-23	t	f	f	f	Laboratory equipment and analyzers	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
b0c6ab8d-e2e7-4884-b816-b0bd1e964d73	1	1520	Office Equipment	asset	fixed_asset	debit	0.00	2026-03-23	t	f	f	f	Computers, furniture, office equipment	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
769d0245-8f73-4302-9a70-3e460337ae4c	1	1530	Building and Improvements	asset	fixed_asset	debit	0.00	2026-03-23	t	f	f	f	Building, renovations, improvements	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
5606697d-c83e-48a3-8435-872c4ba23512	1	1590	Accumulated Depreciation - Equipment	asset	fixed_asset	credit	0.00	2026-03-23	t	f	f	f	Accumulated depreciation on equipment	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
afa40a23-7024-4a5d-a320-bca18e7f4143	1	2100	Accounts Payable - Suppliers	liability	current_liability	credit	0.00	2026-03-23	t	f	f	t	Outstanding supplier invoices	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
38fd2198-091c-41cf-9648-c857f6a94124	1	2110	Accrued Expenses	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	Accrued but unpaid expenses	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
e2dc7b24-163a-44d3-8d0d-c3f4954d340d	1	2200	Payroll Liabilities	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	Unpaid salaries and wages	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
bf81d827-6e86-470f-a385-5eb3c01daf6e	1	2210	PAYE Tax Payable	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	PAYE tax withheld from employees	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
9a3555b7-5c5a-4e3a-8ef9-900efa4e08d6	1	2220	NHIF Contributions Payable	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	NHIF contributions payable	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
c20974f7-b5ab-4b73-8317-2b006e67552a	1	2230	NSSF Contributions Payable	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	NSSF contributions payable	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
cfc851d5-cba2-4021-9af1-ac9362798768	1	2300	VAT Payable	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	VAT collected and payable to KRA	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
a9943fe4-6661-40d9-96fb-444dd7b5f4dc	1	2400	Short-term Loans	liability	current_liability	credit	0.00	2026-03-23	t	f	f	f	Short-term loans and credit facilities	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
daa922d9-bd61-47e0-a982-3094807de279	1	2500	Long-term Loans	liability	long_term_liability	credit	0.00	2026-03-23	t	f	f	f	Long-term loans and mortgages	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
c250ab0d-e8e6-4872-8188-5f62754ed627	1	3100	Owner's Capital	equity	capital	credit	0.00	2026-03-23	t	f	f	f	Owner's initial and additional capital	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
0e278219-ceba-4cca-b4de-d498417b769a	1	3200	Retained Earnings	equity	retained_earnings	credit	0.00	2026-03-23	t	f	f	f	Accumulated profits/losses	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
a301ce51-bbf7-4090-8e94-bc5e56d08e96	1	3300	Owner's Drawings	equity	drawings	debit	0.00	2026-03-23	t	f	f	f	Owner's withdrawals	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
fa91f080-6749-46ca-844b-8cbf43a9d406	1	4100	Patient Services Revenue	revenue	operating_revenue	credit	0.00	2026-03-23	t	f	f	f	Revenue from patient consultations and services	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
50d4d559-a9aa-44a2-b1fc-14dd9e230148	1	4110	Laboratory Services Revenue	revenue	operating_revenue	credit	0.00	2026-03-23	t	f	f	f	Revenue from laboratory tests	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
41de3956-9dbc-40c3-9a1d-ebd6e9a28284	1	4120	Pharmacy Sales Revenue	revenue	operating_revenue	credit	0.00	2026-03-23	t	f	f	f	Revenue from pharmaceutical sales	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
89bc1700-f9b7-4773-a715-6d2e0bb55f1c	1	4130	Radiology Services Revenue	revenue	operating_revenue	credit	0.00	2026-03-23	t	f	f	f	Revenue from radiology services	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
21c95271-65a5-4e1a-97b0-a06c40222e65	1	4140	Procedure Revenue	revenue	operating_revenue	credit	0.00	2026-03-23	t	f	f	f	Revenue from medical procedures	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
2c527246-e775-4987-9f31-43c3316b7bb2	1	4200	Insurance Revenue	revenue	operating_revenue	credit	0.00	2026-03-23	t	f	f	f	Revenue from insurance claims	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
2ca0de86-1088-426b-b746-3bd82dc033e3	1	4900	Other Income	revenue	other_revenue	credit	0.00	2026-03-23	t	f	f	f	Miscellaneous income	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
ba3ff70c-248d-4768-bf96-f0212f495b63	1	5100	Salaries and Wages	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Staff salaries and wages	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
dc033d73-8df3-4b04-ac04-acfa35108d00	1	5110	Doctor Fees	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Payments to consulting doctors	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
8f239071-a866-46f7-b1c5-37771485d1ea	1	5120	Employee Benefits	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	NHIF, NSSF, and other employee benefits	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
360b5fab-e276-4667-8ec5-1677d4ff3826	1	5200	Medical Supplies Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Cost of medical supplies used	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
ca322d5d-436c-428a-aab4-2e4709864a10	1	5210	Pharmaceutical Cost of Sales	expense	cost_of_sales	debit	0.00	2026-03-23	t	f	f	f	Cost of pharmaceuticals sold	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
ba152db2-8e03-43c3-ba08-96f29826e6f0	1	5220	Laboratory Supplies Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Cost of laboratory supplies and reagents	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
7b1f1bc4-fcdc-4b00-b5e2-cb126480168d	1	5300	Rent Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Rent for clinic premises	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
a62e755c-0824-49b3-8188-f32633c07b5b	1	5310	Utilities Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Electricity, water, telephone	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
03532396-fe2c-4e89-ad87-1a07662f91c9	1	5320	Insurance Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Professional and general insurance	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
6f2ce3c3-9b85-4c7a-b709-b1041d1dec4e	1	5330	Maintenance and Repairs	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Equipment and facility maintenance	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
35ef8dd5-3bc9-410b-9d16-b001ee5a44ad	1	5400	Office Supplies Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Office supplies and stationery	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
83845c73-cce5-40f2-a600-28aba8397a6a	1	5410	Marketing and Advertising	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Marketing and promotional expenses	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
55c884a9-8678-415b-9e69-090e7b3c0fe8	1	5420	Professional Fees	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Legal, accounting, consulting fees	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
23305cf6-73d0-4c6d-a8f1-f129ca2e4db6	1	5430	Training and Development	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Staff training and professional development	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
7cf60e98-915f-40dd-a9e9-2db6d90fe9c7	1	5500	Depreciation Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Depreciation on equipment and assets	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
66b15224-b5a9-4cf8-b55c-6a546f8e55d9	1	5600	Interest Expense	expense	financial_expense	debit	0.00	2026-03-23	t	f	f	f	Interest on loans and credit facilities	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
a20018ce-126d-4018-8f4e-7492c701f5cf	1	5700	Bad Debt Expense	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Write-offs of uncollectible receivables	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
d7f5fa85-a25e-473f-97c1-df33263b0d0a	1	5800	Travel and Transport	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Travel and transportation expenses	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
0c0c99fc-3979-46a8-be0e-a0e9bdbd58e7	1	5900	Miscellaneous Expenses	expense	operating_expense	debit	0.00	2026-03-23	t	f	f	f	Other miscellaneous expenses	\N	2026-03-23 13:48:13.097	2026-03-23 13:48:13.097	\N	f
b73ebe93-4804-4972-bf35-bb5da70ffe52	1	1105	Cash at Hand	asset	current_asset	debit	0.00	\N	t	f	f	f	Cash held by cashiers at the counter	\N	2026-03-31 11:32:16.622485	2026-03-31 11:32:16.622485	\N	f
b3d38820-2b7c-4c67-aee7-5cb96130c3b4	1	1108	Petty Cash	asset	current_asset	debit	0.00	\N	t	f	f	f	Petty cash fund for small expenses	\N	2026-03-31 11:32:16.638701	2026-03-31 11:32:16.638701	\N	f
9eba4107-889c-4c2f-ba38-395f747dafa4	1	1200	Accounts Receivable - Patients	asset	current_asset	debit	0.00	2026-03-23	t	f	t	f	Outstanding patient bills	\N	2026-03-23 13:48:13.097	2026-03-31 11:49:51.763	\N	f
\.


--
-- Data for Name: clinic_names; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.clinic_names (id, name, code, address, phone, email, is_active, created_at, updated_at) FROM stdin;
1	IntelliCare HMIS	IC001	\N	\N	\N	t	2026-03-23 17:08:17.610183	2026-03-23 17:08:17.610183
\.


--
-- Data for Name: cogs_posting_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cogs_posting_log (id, clinic_id, posting_period, item_id, quantity_used, quantity_dispensed, quantity_wasted, total_quantity_out, total_cost_of_goods, cogs_method, average_cost_per_unit, gl_entry_id, gl_account_id, posted_by, posting_date, notes, created_at) FROM stdin;
\.


--
-- Data for Name: controlled_substance_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.controlled_substance_log (id, clinic_id, drug_id, dispensing_record_id, quantity_dispensed, patient_id, dispensed_by, dispensing_date, balance_before, balance_after, created_at) FROM stdin;
\.


--
-- Data for Name: cost_centers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cost_centers (id, clinic_id, cost_center_code, cost_center_name, description, responsible_person_id, budget_amount, budget_period, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: credit_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credit_notes (id, clinic_id, credit_note_number, original_bill_id, patient_id, patient_name, credit_date, credit_amount, credit_currency, reason, reason_details, approved_by, approval_date, applied_to_bill_id, applied_date, applied_amount, credit_gl_entry_id, reversal_gl_entry_id, application_gl_entry_id, status, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: currencies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.currencies (id, code, name, symbol, is_base_currency, decimal_places, is_active, created_at, updated_at) FROM stdin;
2	$	USD	$	f	2	t	2026-03-23 20:26:02.901106	2026-03-23 20:26:02.901106
1	SSP	SSP	SSP	t	2	t	2026-03-23 20:25:44.110316	2026-03-23 20:25:44.110316
\.


--
-- Data for Name: currency_conversion_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.currency_conversion_log (id, clinic_id, source_transaction_id, source_transaction_type, from_currency, to_currency, amount_source, rate_used, amount_converted, conversion_method, conversion_date, approved_by, approval_status, approval_date, notes, created_at) FROM stdin;
\.


--
-- Data for Name: daily_expense_approvals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_expense_approvals (id, expense_id, user_id, approval_level, approved_by, approved_by_title, signature, notes, approved_at) FROM stdin;
2a148ba0-41f6-4cf8-8fd4-bdb914740c5b	2	a63c3829-1709-49da-ae07-699d0e52082c	1	Admin Kembe	\N	data:image/png;base64,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	\N	2026-04-06 18:35:04.323682
146d5ce3-7ced-4c9d-a6ef-f746c8afb1c1	2	a63c3829-1709-49da-ae07-699d0e52082c	2	Admin Kembe	\N	data:image/png;base64,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	\N	2026-04-06 18:35:13.259258
\.


--
-- Data for Name: daily_expenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_expenses (id, expense_date, description, amount, account_id, account_name, category, notes, created_by, created_at, updated_at, clinic_id, payment_method, voucher_number, status, paid_at) FROM stdin;
2	2026-04-06 02:00:00+02	Electricity	600.00	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	Petty Cash	Utilities		admin	2026-04-06 20:21:31.006+02	2026-04-06 20:21:31.006+02	1	Cash	EXP-00513262	approved	\N
1	2026-04-06 02:00:00+02	Water	200.00	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	Petty Cash	Office Supplies		admin	2026-04-06 20:10:59.961+02	2026-04-06 20:10:59.961+02	1	Cash	EXP-99059959	paid	2026-04-06 18:43:11.832542
\.


--
-- Data for Name: daily_financial_summary; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.daily_financial_summary (id, clinic_id, summary_date, total_revenue, total_collections, total_expenses, net_profit, patient_count, visit_count, bill_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.departments (id, department_name, department_code, description, is_active, clinic_id, branch_id, created_at, updated_at) FROM stdin;
34a2536f-5c2d-490e-bcee-d12215afd561	Emergency Department	ER	Emergency and urgent care services	t	1	\N	2026-03-23 14:19:52.371727	2026-03-23 14:19:52.371727
7f99e814-4919-4249-9ada-dcae0223fcf9	Outpatient Department	OPD	General outpatient consultations	t	1	\N	2026-03-23 14:19:52.39463	2026-03-23 14:19:52.39463
bde9c4e7-3289-420c-a422-037b9d627239	Inpatient Department	IPD	Inpatient care and admissions	t	1	\N	2026-03-23 14:19:52.404601	2026-03-23 14:19:52.404601
d3e2902c-a0c1-495a-8f55-92ec99e587c1	Laboratory	LAB	Clinical laboratory services	t	1	\N	2026-03-23 14:19:52.447074	2026-03-23 14:19:52.447074
64227a62-55ad-4e05-bff2-e8a8a41f3e49	Pharmacy	PHARM	Pharmaceutical services	t	1	\N	2026-03-23 14:19:52.475438	2026-03-23 14:19:52.475438
98a82570-4238-4715-b378-4767fc0acace	Radiology	RAD	Imaging and radiology services	t	1	\N	2026-03-23 14:19:52.518639	2026-03-23 14:19:52.518639
749c60df-8c3e-4692-8491-6021a5e22963	Surgery	SURG	Surgical services	t	1	\N	2026-03-23 14:19:52.529515	2026-03-23 14:19:52.529515
6ef47170-9e97-4798-afec-676e0c5e281e	Pediatrics	PEDS	Child healthcare services	t	1	\N	2026-03-23 14:19:52.536453	2026-03-23 14:19:52.536453
e1b3e478-26eb-4268-abb0-b7d7f5be9d44	Obstetrics & Gynecology	OBGYN	Maternal and women health services	t	1	\N	2026-03-23 14:19:52.542996	2026-03-23 14:19:52.542996
6b4ec569-86ab-4196-802f-1ff9c5c3380c	Administration	ADMIN	Administrative and management	t	1	\N	2026-03-23 14:19:52.549976	2026-03-23 14:19:52.549976
\.


--
-- Data for Name: dispensing_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dispensing_records (id, clinic_id, dispensing_number, prescription_id, prescription_line_id, patient_id, drug_id, pharmacist_id, inventory_item_id, batch_id, from_location_id, dispensing_date, dispensing_time, quantity_dispensed, unit_of_measure, unit_price, currency_code, exchange_rate, total_price, total_price_base, inventory_transaction_id, batch_usage_record_id, dispensing_notes, patient_counselling_provided, counselling_notes, counselled_by_id, bill_id, bill_item_id, amount_charged, is_billed, billing_date, gl_entry_id, cogs_gl_entry_id, revenue_gl_entry_id, status, return_date, return_reason, created_at, updated_at, branch_id) FROM stdin;
4ff1d74f-bbb5-41e7-8488-5f2dcd96c6fd	1	DISP-202603-0001	\N	\N	f13d0c29-3fef-494a-9642-2f390835d83f	fb4df775-f305-42f7-873b-f4ee63b6cf9c	\N	fb4df775-f305-42f7-873b-f4ee63b6cf9c	e8d15a22-6ffc-4a5f-927d-ea3b9b5a18a7	\N	2026-03-30	12:41:50	20	Strip	0.00	SSP	1.000000	0.00	0.00	9f2743c9-e9a1-422d-86c3-13be5b8e61b8	\N	2x/day · 5 days	f	\N	\N	\N	\N	0.00	t	\N	\N	\N	\N	dispensed	\N	\N	2026-03-30 10:41:50.67825	2026-03-30 10:41:50.67825	\N
380b181c-b1f2-4218-a9ce-5debbf147fcc	1	DISP-202604-0001	\N	\N	bbb36bc2-4834-4bfe-9b37-2311f79a716c	a12ea35b-c54e-4d7c-859f-7016a996812b	\N	a12ea35b-c54e-4d7c-859f-7016a996812b	\N	\N	2026-04-06	18:04:37	2	Pieces	4000.00	SSP	1.000000	8000.00	8000.00	f90d64c2-5ab0-480c-b950-0c8ebde82962	\N	\N	f	\N	\N	\N	\N	8000.00	f	\N	\N	\N	\N	dispensed	\N	\N	2026-04-06 16:04:37.308926	2026-04-06 16:04:37.308926	\N
eaa17c42-cefe-4029-a8aa-5848e56bfb2e	1	DISP-202604-0011	\N	\N	bbb36bc2-4834-4bfe-9b37-2311f79a716c	9d78ed43-deab-4871-b7a2-3024901cf613	\N	9d78ed43-deab-4871-b7a2-3024901cf613	\N	\N	2026-04-06	18:04:37	2	Bottles	10000.00	SSP	1.000000	20000.00	20000.00	26268217-f3e9-408e-8614-5b1db0149f4f	\N	\N	f	\N	\N	\N	\N	20000.00	t	\N	\N	\N	\N	dispensed	\N	\N	2026-04-06 16:04:37.702465	2026-04-06 16:04:37.702465	\N
672bf401-1652-42dd-9f04-00c85973ee37	1	DISP-202604-0021	\N	\N	f13d0c29-3fef-494a-9642-2f390835d83f	9d78ed43-deab-4871-b7a2-3024901cf613	\N	9d78ed43-deab-4871-b7a2-3024901cf613	\N	\N	2026-04-06	18:09:32	1	Bottles	10000.00	SSP	1.000000	10000.00	10000.00	0c58ea6f-ccae-4825-9569-5df7e8266883	\N	\N	f	\N	\N	\N	\N	10000.00	f	\N	\N	\N	\N	dispensed	\N	\N	2026-04-06 16:09:32.473106	2026-04-06 16:09:32.473106	\N
ee90500a-d854-4eeb-b461-a1240f0b043d	1	DISP-202604-0031	\N	\N	f13d0c29-3fef-494a-9642-2f390835d83f	2ce2654f-48c7-4dfe-b8d0-1b45d6b1de06	\N	2ce2654f-48c7-4dfe-b8d0-1b45d6b1de06	\N	\N	2026-04-06	18:09:32	1	Strips	5000.00	SSP	1.000000	5000.00	5000.00	a6ea52d1-e5dc-4e82-8a1a-4d8afa72d951	\N	\N	f	\N	\N	\N	\N	5000.00	t	\N	\N	\N	\N	dispensed	\N	\N	2026-04-06 16:09:32.699336	2026-04-06 16:09:32.699336	\N
0d1ca60b-edee-49af-aa8b-669fd53b1746	1	DISP-202604-0041	\N	\N	f13d0c29-3fef-494a-9642-2f390835d83f	a12ea35b-c54e-4d7c-859f-7016a996812b	\N	a12ea35b-c54e-4d7c-859f-7016a996812b	\N	\N	2026-04-06	18:11:20	1	Pieces	4000.00	SSP	1.000000	4000.00	4000.00	9d0904e6-d3ce-4cc5-b833-65bea0f917c8	\N	\N	f	\N	\N	\N	\N	4000.00	f	\N	\N	\N	\N	dispensed	\N	\N	2026-04-06 16:11:20.245475	2026-04-06 16:11:20.245475	\N
\.


--
-- Data for Name: dispensing_returns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dispensing_returns (id, clinic_id, return_number, dispensing_record_id, return_date, return_reason, quantity_returned, inventory_reversal_done, inventory_transaction_id, credit_note_id, amount_refunded, refund_method, gl_reversal_entry_id, revenue_reversal_gl_id, cogs_reversal_gl_id, processed_by, notes, created_at, branch_id) FROM stdin;
\.


--
-- Data for Name: doctor_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.doctor_notes (id, clinic_id, admission_id, patient_id, doctor_id, note_date, note_type, clinical_assessment, examination_findings, vital_signs, diagnosis, diagnosis_code, treatment_plan, progress_status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: dr_clinics; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dr_clinics (id, name, description, department, service, is_active, created_by, updated_by, created_at, updated_at) FROM stdin;
3e06ef77-cebb-4d33-ab4d-06f188ad5732	General physician	\N	General Medicine	0d0d3797-6cc5-4635-a290-0547b8a10054	t	system	system	2026-03-23 23:21:55.568+02	2026-03-31 11:41:07.104+02
\.


--
-- Data for Name: drug_administrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drug_administrations (id, clinic_id, prescription_id, admission_id, patient_id, drug_id, medication_name, nurse_id, administered_at, dosage_given, route, notes, patient_reaction, status, created_at) FROM stdin;
\.


--
-- Data for Name: drug_allergies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drug_allergies (id, clinic_id, patient_id, drug_id, drug_class, allergy_description, severity, reaction_description, verified_date, verified_by, created_at) FROM stdin;
\.


--
-- Data for Name: drug_interactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drug_interactions (id, drug1_id, drug2_id, interaction_type, interaction_description, management_notes, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: drug_inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drug_inventory (id, drug_name, generic_name, unit_of_measure, quantity_received, current_stock, expiry_date, batch_number, reorder_level, unit_cost, selling_price, clinic_id, date_received, received_by, branch_id, created_at, updated_at, inventory_item_id) FROM stdin;
\.


--
-- Data for Name: drug_pricing_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drug_pricing_history (id, drug_id, price_currency, price_amount, effective_from, effective_to, reason_for_change, changed_by, created_at) FROM stdin;
\.


--
-- Data for Name: drugs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.drugs (id, clinic_id, drug_code, drug_name, generic_name, drug_description, inventory_item_id, strength, unit_of_measure, dosage_form, therapeutic_category, atc_code, is_controlled_substance, is_scheduled, price_kes, price_usd, price_ssp, default_currency, revenue_account_id, cogs_account_id, requires_prescription, max_quantity_per_prescription, shelf_life_days, requires_cold_storage, drug_allergy_keywords, major_drug_interactions, is_active, discontinued_date, notes, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: exchange_adjustments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.exchange_adjustments (id, clinic_id, transaction_date, from_currency, to_currency, original_amount, original_rate, original_base_amount, settlement_date, settlement_rate, settlement_base_amount, realized_gain_loss, current_rate, current_base_amount, unrealized_gain_loss, adjustment_type, adjustment_status, reference_id, reference_type, notes, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: exchange_rates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.exchange_rates (id, clinic_id, from_currency, to_currency, rate, effective_date, expiry_date, source, is_active, created_by, created_at, updated_at, buy_rate, sell_rate, spot_rate, notes) FROM stdin;
5f427d42-96dd-4f75-b0fe-b50b4aad4ae7	1	$	SSP	6000.000000	2026-03-23	\N	manual	t	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-23 20:26:20.722767	2026-03-23 20:26:20.722767	6000.000000	6000.000000	6000.000000	\N
0f363e83-f4d2-4393-84d3-3e0ef353af28	1	SSP	$	0.127000	2026-04-06	\N	manual	t	a63c3829-1709-49da-ae07-699d0e52082c	2026-04-06 16:11:05.707527	2026-04-06 16:11:05.707527	0.127000	0.127000	0.127000	\N
\.


--
-- Data for Name: expense_invoice_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.expense_invoice_lines (id, expense_invoice_id, account_id, item_description, quantity, unit_price, line_amount, tax_amount, cost_center_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: expense_invoices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.expense_invoices (id, clinic_id, supplier_id, invoice_number, invoice_date, due_date, received_date, total_amount, tax_amount, gross_amount, amount_paid, amount_due, status, expense_category, reference_po, notes, verified_by, verified_date, approved_by, approved_date, gl_entry_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: facilities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.facilities (id, name, type, capacity, is_active, created_at, updated_at, address, city, state, postal_code, country, phone, email, fax, website, license_number, established_date, bed_capacity, description) FROM stdin;
1	Universal Hospital	Hospital	\N	t	2026-03-23 15:10:22.799842	2026-03-23 21:13:43.35	Hai Jeruzalem	Juba	CE	\N	South Sudan	+211 925593647	info@universalhospital.com	\N	https://www.universalhospital.com	\N	\N	30	Healthcare Facility
\.


--
-- Data for Name: general_ledger; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.general_ledger (id, clinic_id, gl_number, transaction_date, posting_date, transaction_type, description, reference_id, reference_module, total_debit, total_credit, is_balanced, is_posted, posted_by, posted_date, status, approval_by, approval_date, created_by, created_at, updated_at, transaction_currency, base_currency, exchange_rate, base_total_debit, base_total_credit) FROM stdin;
79e3eabe-df95-40ae-9eb7-f9ecc998777b	1	GL-202603-0001	2026-03-23	\N	patient_billing	Patient Bill - BILL-2026-324812	413451c3-c20b-4558-b711-92d398c8a664	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-23 21:45:25.786	posted	\N	\N	Admin Kembe	2026-03-23 21:45:25.224	2026-03-23 21:45:25.795	SSP	SSP	1.000000	20000.00	20000.00
953de3f2-11b9-412e-b2d9-2cb37893014f	1	GL-202603-0002	2026-03-24	\N	patient_billing	Patient Bill - BILL-2026-464836	5e631277-4e10-4cf0-8329-a989ca959d7f	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-24 07:47:45.09	posted	\N	\N	Admin Kembe	2026-03-24 07:47:44.912	2026-03-24 07:47:45.09	SSP	SSP	1.000000	20000.00	20000.00
126ff051-4ea5-4ec4-bc57-0fc48576aa15	1	GL-202603-0003	2026-03-24	\N	patient_billing	Patient Bill - BILL-2026-350265	2628dd55-5807-4e83-90ef-3543ed332f92	patient_billing	50000.00	50000.00	t	t	Admin Kembe	2026-03-24 08:52:30.502	posted	\N	\N	Admin Kembe	2026-03-24 08:52:30.396	2026-03-24 08:52:30.505	SSP	SSP	1.000000	50000.00	50000.00
a549c852-a2b1-441a-9fb1-e4c97a000e35	1	GL-202603-0004	2026-03-24	\N	patient_billing	Patient Bill - BILL-2026-574166	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-24 09:12:54.354	posted	\N	\N	Admin Kembe	2026-03-24 09:12:54.296	2026-03-24 09:12:54.358	SSP	SSP	1.000000	20000.00	20000.00
46a97acd-3966-4fbf-8787-4cfce70c881a	1	GL-202603-0005	2026-03-24	\N	patient_billing	Patient Bill - BILL-2026-490294	c2f7de2e-fadf-43bc-90f7-a7c664f08964	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-24 09:28:10.433	posted	\N	\N	Admin Kembe	2026-03-24 09:28:10.371	2026-03-24 09:28:10.433	SSP	SSP	1.000000	20000.00	20000.00
bcafef8e-8a72-4b16-9057-4253546b3f21	1	GL-202603-0006	2026-03-24	\N	patient_billing	Patient Bill - BILL-2026-531501	5efd31a9-5c99-4933-acec-c97f70d974aa	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-24 10:18:51.654	posted	\N	\N	Admin Kembe	2026-03-24 10:18:51.564	2026-03-24 10:18:51.654	SSP	SSP	1.000000	20000.00	20000.00
883cb645-96d2-481c-a47c-ce83ed8cc51e	1	GL-202603-0007	2026-03-24	\N	patient_billing	Patient Bill - BILL-2026-293101	a1288878-7b04-484f-a460-b4ec6d67a7ca	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-24 10:31:33.209	posted	\N	\N	Admin Kembe	2026-03-24 10:31:33.147	2026-03-24 10:31:33.209	SSP	SSP	1.000000	20000.00	20000.00
c9fe63a2-077f-4954-aa91-e428ebef702b	1	GL-202603-0008	2026-03-30	\N	patient_billing	Patient Bill - BILL-2026-907966	69125236-c7b5-4aa8-a221-891e07ec2067	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-03-30 16:58:28.493	posted	\N	\N	Admin Kembe	2026-03-30 16:58:28.239	2026-03-30 16:58:28.497	SSP	SSP	1.000000	20000.00	20000.00
ef27ae78-8dd3-469d-b497-057cfb234f8a	1	GL-202603-0009	2026-03-31	\N	patient_billing	Patient Bill - BILL-2026-761640	0028c2e4-05b8-455c-bfa1-e0a31ef75afd	patient_billing	50000.00	50000.00	t	t	Admin Kembe	2026-03-31 10:59:21.743	posted	\N	\N	Admin Kembe	2026-03-31 10:59:21.688	2026-03-31 10:59:21.745	SSP	SSP	1.000000	50000.00	50000.00
5f8d3e77-bbe5-436b-810f-a6eeaee19317	1	GL-202603-0010	2026-03-31	\N	patient_billing	Patient Bill - BILL-2026-674396	95cf980c-2ecb-4da1-9c36-81d821b63e5d	patient_billing	50000.00	50000.00	t	t	Admin Kembe	2026-03-31 11:47:54.6	posted	\N	\N	Admin Kembe	2026-03-31 11:47:54.49	2026-03-31 11:47:54.601	SSP	SSP	1.000000	50000.00	50000.00
e693d4b0-a161-49ec-9716-674f5270835f	1	GL-202604-0001	2026-04-03	\N	patient_billing	Patient Bill - BILL-2026-548843	b945c6d0-e80f-4d44-b96e-85f2cb456107	patient_billing	20000.00	20000.00	t	t	Admin Kembe	2026-04-03 01:42:29.23	posted	\N	\N	Admin Kembe	2026-04-03 01:42:29.061	2026-04-03 01:42:29.232	SSP	SSP	1.000000	20000.00	20000.00
\.


--
-- Data for Name: gl_line_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.gl_line_items (id, gl_id, account_id, debit_amount, credit_amount, line_description, cost_center_id, department_id, created_at, updated_at, base_debit_amount, base_credit_amount, currency_code, amount_in_currency, exchange_rate, exchange_gain_loss) FROM stdin;
f9843166-f9eb-4e0f-915b-5f0e036fb01b	79e3eabe-df95-40ae-9eb7-f9ecc998777b	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - Single Dee	\N	\N	2026-03-23 21:45:25.303	2026-03-23 21:45:25.303	20000.00	0.00	\N	\N	\N	0.00
dff8a8b6-4167-4fbf-bfdd-c905afbc28c1	79e3eabe-df95-40ae-9eb7-f9ecc998777b	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - Single Dee	\N	\N	2026-03-23 21:45:25.549	2026-03-23 21:45:25.549	0.00	20000.00	\N	\N	\N	0.00
cbe88291-aefa-4484-a43f-af48f13f42ea	953de3f2-11b9-412e-b2d9-2cb37893014f	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - John Ohisa	\N	\N	2026-03-24 07:47:44.935	2026-03-24 07:47:44.935	20000.00	0.00	\N	\N	\N	0.00
5d948d59-7994-4005-9a2b-ffc35e586594	953de3f2-11b9-412e-b2d9-2cb37893014f	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - John Ohisa	\N	\N	2026-03-24 07:47:44.965	2026-03-24 07:47:44.965	0.00	20000.00	\N	\N	\N	0.00
171e2099-bf8e-4bf1-b36b-366e3260a6d2	126ff051-4ea5-4ec4-bc57-0fc48576aa15	9eba4107-889c-4c2f-ba38-395f747dafa4	50000.00	0.00	Patient receivable - John Ohisa	\N	\N	2026-03-24 08:52:30.417	2026-03-24 08:52:30.417	50000.00	0.00	\N	\N	\N	0.00
de58bc1d-c48b-4a67-8b89-654c9116bca0	126ff051-4ea5-4ec4-bc57-0fc48576aa15	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	50000.00	Patient services revenue - John Ohisa	\N	\N	2026-03-24 08:52:30.451	2026-03-24 08:52:30.451	0.00	50000.00	\N	\N	\N	0.00
eb461290-fded-4b91-ae52-5a59f8be7a40	a549c852-a2b1-441a-9fb1-e4c97a000e35	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - Lil Been	\N	\N	2026-03-24 09:12:54.316	2026-03-24 09:12:54.316	20000.00	0.00	\N	\N	\N	0.00
a49d98c9-ccbb-4948-843b-1766ed55e55b	a549c852-a2b1-441a-9fb1-e4c97a000e35	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - Lil Been	\N	\N	2026-03-24 09:12:54.332	2026-03-24 09:12:54.332	0.00	20000.00	\N	\N	\N	0.00
b2dfb57e-cb66-4a42-b370-2c61e18fe41a	46a97acd-3966-4fbf-8787-4cfce70c881a	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - Narting Abui Joseph	\N	\N	2026-03-24 09:28:10.378	2026-03-24 09:28:10.378	20000.00	0.00	\N	\N	\N	0.00
1338592e-eef5-4fdd-b6af-1603838493d0	46a97acd-3966-4fbf-8787-4cfce70c881a	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - Narting Abui Joseph	\N	\N	2026-03-24 09:28:10.384	2026-03-24 09:28:10.384	0.00	20000.00	\N	\N	\N	0.00
bfc53921-45ef-461a-8560-5a2c5538d2f4	bcafef8e-8a72-4b16-9057-4253546b3f21	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - Narting Abui Joseph	\N	\N	2026-03-24 10:18:51.573	2026-03-24 10:18:51.573	20000.00	0.00	\N	\N	\N	0.00
42ccdc8f-1a7e-4a2c-bcbc-89891abd3671	bcafef8e-8a72-4b16-9057-4253546b3f21	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - Narting Abui Joseph	\N	\N	2026-03-24 10:18:51.592	2026-03-24 10:18:51.592	0.00	20000.00	\N	\N	\N	0.00
df427aad-0026-417e-99e8-1caed42591e9	883cb645-96d2-481c-a47c-ce83ed8cc51e	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - John Ohisa	\N	\N	2026-03-24 10:31:33.154	2026-03-24 10:31:33.154	20000.00	0.00	\N	\N	\N	0.00
4d490aa6-a15f-47be-93ad-d47c3bc728ba	883cb645-96d2-481c-a47c-ce83ed8cc51e	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - John Ohisa	\N	\N	2026-03-24 10:31:33.187	2026-03-24 10:31:33.187	0.00	20000.00	\N	\N	\N	0.00
2463c554-1560-4d5a-914d-5e164de01d3b	c9fe63a2-077f-4954-aa91-e428ebef702b	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - Martin Ssebuga	\N	\N	2026-03-30 16:58:28.254	2026-03-30 16:58:28.254	20000.00	0.00	\N	\N	\N	0.00
683ad01d-4632-42be-8418-62f36bb328ef	c9fe63a2-077f-4954-aa91-e428ebef702b	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Patient services revenue - Martin Ssebuga	\N	\N	2026-03-30 16:58:28.314	2026-03-30 16:58:28.314	0.00	20000.00	\N	\N	\N	0.00
2c597c5d-73ac-43ff-8032-1025b3d4c604	ef27ae78-8dd3-469d-b497-057cfb234f8a	9eba4107-889c-4c2f-ba38-395f747dafa4	50000.00	0.00	Patient receivable - Lil Been	\N	\N	2026-03-31 10:59:21.693	2026-03-31 10:59:21.693	50000.00	0.00	\N	\N	\N	0.00
24b1f0f8-4276-418f-93b1-1cf80b362053	ef27ae78-8dd3-469d-b497-057cfb234f8a	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	50000.00	Patient services revenue - Lil Been	\N	\N	2026-03-31 10:59:21.702	2026-03-31 10:59:21.702	0.00	50000.00	\N	\N	\N	0.00
7f8cd2f9-bab3-43f7-a49d-fed25b608b8b	5f8d3e77-bbe5-436b-810f-a6eeaee19317	9eba4107-889c-4c2f-ba38-395f747dafa4	50000.00	0.00	Patient receivable - Maria Anthony	\N	\N	2026-03-31 11:47:54.5	2026-03-31 11:47:54.5	50000.00	0.00	\N	\N	\N	0.00
71a41dbf-d3b0-4c1d-83d8-f4f6c21b7dc7	5f8d3e77-bbe5-436b-810f-a6eeaee19317	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	50000.00	Patient services revenue - Maria Anthony	\N	\N	2026-03-31 11:47:54.558	2026-03-31 11:47:54.558	0.00	50000.00	\N	\N	\N	0.00
7f1fda5c-1e8c-48fc-ac6a-7b933ba2289e	e693d4b0-a161-49ec-9716-674f5270835f	9eba4107-889c-4c2f-ba38-395f747dafa4	20000.00	0.00	Patient receivable - Maria Anthony	\N	\N	2026-04-03 01:42:29.075	2026-04-03 01:42:29.075	20000.00	0.00	\N	\N	\N	0.00
660b548b-d1c4-493c-9925-c6346f4f6707	e693d4b0-a161-49ec-9716-674f5270835f	fa91f080-6749-46ca-844b-8cbf43a9d406	0.00	20000.00	Revenue - Maria Anthony	\N	\N	2026-04-03 01:42:29.14	2026-04-03 01:42:29.14	0.00	20000.00	\N	\N	\N	0.00
\.


--
-- Data for Name: goods_receipt_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.goods_receipt_notes (id, clinic_id, grn_number, po_id, supplier_id, receipt_date, received_by, received_location, received_condition, total_items_received, notes, status, inspected_by, inspection_date, inspection_notes, created_at, updated_at) FROM stdin;
45da11d0-6865-4bc4-9475-5ce0d30fa468	1	GRN-2026-0001	1	1	2026-03-27	a63c3829-1709-49da-ae07-699d0e52082c	Main Store	good	10	\N	accepted	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-27	good	2026-03-27 12:36:02.151924	2026-03-27 12:36:31.83474
\.


--
-- Data for Name: grn_line_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.grn_line_items (id, grn_id, po_line_item_id, item_code, item_description, quantity_expected, quantity_received, unit_of_measure, item_condition, batch_number, expiry_date, serial_number, inspection_status, inspection_notes, created_at, inventory_item_id, inventory_batch_id, unit_cost) FROM stdin;
041a8294-caa8-4750-8b87-f4945a5664f8	45da11d0-6865-4bc4-9475-5ce0d30fa468	1	\N	Paracetamol	10	10	pcs	good	EY666	2028-04-06	\N	pass	\N	2026-03-27 12:36:02.157167	42d42a1d-1011-4ad0-b61e-01e55f661457	9b419798-df93-44f8-8dee-0b0d95572098	0.0000
\.


--
-- Data for Name: inpatient_admissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inpatient_admissions (id, clinic_id, patient_id, admission_date, bed_id, room_id, ward_id, admission_reason, diagnosis, diagnosis_code, admission_type, status, admitted_by_user_id, attending_doctor_id, discharge_date, discharge_reason, discharge_summary, discharged_by_user_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: inpatient_lab_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inpatient_lab_requests (id, clinic_id, admission_id, patient_id, doctor_id, request_date, test_type, test_code, urgent, clinical_indication, sample_type, status, results, result_notes, completed_date, completed_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: inpatient_prescriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inpatient_prescriptions (id, clinic_id, admission_id, patient_id, doctor_id, drug_id, medication_name, prescription_date, dosage, frequency, duration, route, instructions, quantity, status, start_date, end_date, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: inpatient_radiology_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inpatient_radiology_requests (id, clinic_id, admission_id, patient_id, doctor_id, request_date, imaging_type, body_part, urgent, clinical_indication, status, findings, impression, completed_date, completed_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: insurance_batch_claim_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.insurance_batch_claim_items (id, claim_id, invoice_id, bill_id, patient_id, patient_name, invoice_number, invoice_date, amount, created_at) FROM stdin;
\.


--
-- Data for Name: insurance_batch_claim_status_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.insurance_batch_claim_status_history (id, claim_id, old_status, new_status, notes, created_by, created_by_name, created_at) FROM stdin;
\.


--
-- Data for Name: insurance_batch_claims; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.insurance_batch_claims (id, clinic_id, branch_id, claim_number, scheme_id, scheme_name, scheme_code, claim_amount, invoice_count, status, priority, date_from, date_to, notes, contact_person, contact_email, contact_phone, submitted_at, accepted_at, paid_at, paid_amount, rejected_reason, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: insurance_claims; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.insurance_claims (id, clinic_id, claim_number, bill_id, patient_id, patient_name, insurance_provider, insurance_type, member_id, claim_amount, claim_currency, claim_date, submission_date, approval_code, approval_date, approved_amount, paid_amount, payment_date, payment_reference, rejection_reason, gl_entry_id, payment_gl_entry_id, status, notes, created_by, created_at, updated_at, branch_id, batch_id) FROM stdin;
\.


--
-- Data for Name: inventory_adjustments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_adjustments (id, clinic_id, adjustment_number, item_id, location_id, system_quantity, physical_count, variance, variance_reason, variance_value, counted_by, count_date, reviewed_by, review_date, approved_by, approval_date, approval_status, gl_entry_id, adjustment_account_id, notes, created_at, branch_id) FROM stdin;
\.


--
-- Data for Name: inventory_batches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_batches (id, clinic_id, item_id, batch_number, serial_number, location_id, po_id, grn_id, supplier_id, receipt_date, quantity_received, quantity_used, unit_cost, cost_currency, batch_total_cost, manufacture_date, expiry_date, is_expired, status, notes, created_at, updated_at, branch_id) FROM stdin;
9b419798-df93-44f8-8dee-0b0d95572098	1	42d42a1d-1011-4ad0-b61e-01e55f661457	EY666	\N	c4e27e55-8004-4c8e-bfd7-f9fee6674a99	1	45da11d0-6865-4bc4-9475-5ce0d30fa468	1	2026-03-27	10	0	0.0000	SSP	0.00	\N	2028-04-06	f	active	\N	2026-03-27 12:36:31.87814	2026-03-27 12:36:31.87814	\N
e8d15a22-6ffc-4a5f-927d-ea3b9b5a18a7	1	fb4df775-f305-42f7-873b-f4ee63b6cf9c	OPEN-gd-2026-03-26	\N	\N	\N	\N	\N	2026-03-26	50	20	0.0000	SSP	0.00	\N	2027-03-01	f	active	Opening stock	2026-03-26 08:59:20.295497	2026-03-26 08:59:20.295497	1
\.


--
-- Data for Name: inventory_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_items (id, clinic_id, item_code, item_name, item_description, item_category, item_type, unit_of_measure, reorder_unit, conversion_factor, quantity_on_hand, reserved_quantity, minimum_stock_level, maximum_stock_level, reorder_quantity, lead_time_days, inventory_valuation_method, current_unit_cost, average_unit_cost, selling_price, cost_currency, inventory_account_id, cogs_account_id, usage_account_id, requires_batch_tracking, requires_expiry_tracking, requires_serial_number, is_controlled_substance, is_active, discontinued_date, notes, preferred_supplier_id, drug_inventory_id, created_by, created_at, updated_at, branch_id) FROM stdin;
42d42a1d-1011-4ad0-b61e-01e55f661457	1	GRN-GRN-2026-0001-001	Paracetamol	\N	general	consumable	pcs	Each	1	10	0	0	0	0	7	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	f	f	f	f	t	\N	\N	\N	\N	\N	2026-03-27 12:36:31.870811	2026-03-27 12:36:31.896361	\N
fb4df775-f305-42f7-873b-f4ee63b6cf9c	1	gd	P-Alaxine	500mg	drugs	consumable	Strip	Strip	1	30	0	0	0	0	7	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-26 08:59:20.276454	2026-03-26 08:59:20.276454	1
41dc08b8-bacc-40ed-8664-0016708d1661	1	PARA500	A-Z	Pain relief medication	drugs	consumable	Strips	Each	1	8	0	100	1000	3	7	weighted_average	8000.0000	8000.0000	16000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	Common pain reliever	\N	\N	\N	2026-03-30 11:02:44.841677	2026-03-30 11:02:44.841677	1
6a161270-bd92-44bd-b22e-dd1da5608566	1	PARA501	abeer	\N	drugs	consumable	strips	Each	1	0	0	101	1001	10	8	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.882576	2026-03-30 11:02:44.882576	1
8e295f71-4b86-422e-9f34-e0d0230c15c6	1	PARA505	Acretin 0.05%	\N	drugs	consumable	Tubes	Each	1	3	0	105	1005	10	12	weighted_average	35000.0000	35000.0000	70000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.928765	2026-03-30 11:02:44.928765	1
fd8c22ec-f950-4528-a548-20095cadbe9e	1	PARA506	action	\N	drugs	consumable	Strips	Each	1	98	0	106	1006	20	13	weighted_average	500.0000	500.0000	1000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.962631	2026-03-30 11:02:44.962631	1
11bee373-4629-4467-b42b-e6eb0057cde5	1	PARA507	adzir	\N	drugs	consumable	bott	Each	1	0	0	107	1007	10	14	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.981567	2026-03-30 11:02:44.981567	1
08a2463c-7a32-408e-b91a-4bdfa3102b73	1	PARA508	aknetrent	\N	drugs	consumable	Strips	Each	1	6	0	108	1008	3	15	weighted_average	18000.0000	18000.0000	36000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.009167	2026-03-30 11:02:45.009167	1
90d2f65e-9930-4781-9629-102de39d1830	1	PARA509	aknetrnt	\N	drugs	consumable	strips	Each	1	0	0	109	1009	10	16	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.02052	2026-03-30 11:02:45.02052	1
e820a1e4-599d-4c48-9dae-762d4fe5a9bf	1	PARA510	albendazole tablets	\N	drugs	consumable	Tablets	Each	1	7	0	110	1010	5	17	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.026365	2026-03-30 11:02:45.026365	1
3a4e2f4d-d488-47c4-a441-c44741025cc0	1	PARA511	alcohol pads	\N	drugs	consumable	Tablets	Each	1	0	0	111	1011	20	18	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.074127	2026-03-30 11:02:45.074127	1
32b1550e-0262-413b-b271-143496b7b2bb	1	PARA512	alfamet	\N	drugs	consumable	Strips	Each	1	8	0	112	1012	5	19	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.079133	2026-03-30 11:02:45.079133	1
ca159e62-053b-4c36-bd9f-6b07472e6965	1	PARA513	alfamet 250mg	\N	drugs	consumable	strips	Each	1	0	0	113	1013	10	20	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.094837	2026-03-30 11:02:45.094837	1
668e8886-d06b-4541-bda3-1b419b3c5f6e	1	PARA514	allergex	\N	drugs	consumable	strips	Each	1	0	0	114	1014	10	21	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.100825	2026-03-30 11:02:45.100825	1
f98b0a3d-e63d-4126-b0d4-62b3307f2b03	1	PARA515	Alopron	\N	drugs	consumable	strip	Each	1	12	0	115	1015	10	22	weighted_average	75000.0000	75000.0000	150000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.106156	2026-03-30 11:02:45.106156	1
0daddff7-ce0e-489a-b1c4-4f1a12197452	1	PARA516	alopurinol	\N	drugs	consumable	Strips	Each	1	12	0	116	1016	10	23	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.123282	2026-03-30 11:02:45.123282	1
d6ea3602-4415-4f41-bc3b-33dff21285a9	1	PARA517	alzental	\N	drugs	consumable	Strips	Each	1	6	0	117	1017	5	24	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.138243	2026-03-30 11:02:45.138243	1
7c9f3cc8-2716-48c3-891f-9abd3b964d1d	1	PARA518	alzental syrup	\N	drugs	consumable	Bottles	Each	1	9	0	118	1018	5	25	weighted_average	12000.0000	12000.0000	24000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.144558	2026-03-30 11:02:45.144558	1
c3a9b056-161e-4f59-b314-87732e5c79e3	1	PARA519	amaryl 1	\N	drugs	consumable	Strips	Each	1	5	0	119	1019	4	26	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.148894	2026-03-30 11:02:45.148894	1
46a37510-6033-4792-98a8-5ff987ccbdfe	1	PARA520	amaryl 2	\N	drugs	consumable	Strips	Each	1	18	0	120	1020	10	27	weighted_average	12000.0000	12000.0000	24000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.156489	2026-03-30 11:02:45.156489	1
3696a7ad-c335-4c30-ab16-15449d438fd3	1	PARA521	amaryl 3	\N	drugs	consumable	strips	Each	1	2	0	121	1021	10	28	weighted_average	12000.0000	12000.0000	24000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.164599	2026-03-30 11:02:45.164599	1
e06e5e65-2a0b-4b4e-8b43-58e4b577dd70	1	PARA522	amaryl 4	\N	drugs	consumable	strips	Each	1	0	0	122	1022	10	29	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.176544	2026-03-30 11:02:45.176544	1
03c2a5cc-117f-4a52-9808-d380edd1a8ba	1	PARA523	ambizim	\N	drugs	consumable	strips	Each	1	0	0	123	1023	10	30	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.180148	2026-03-30 11:02:45.180148	1
200617b7-a408-4c09-8c61-392add7c28ea	1	PARA524	amidol	\N	drugs	consumable	bottle	Each	1	0	0	124	1024	10	31	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.18866	2026-03-30 11:02:45.18866	1
1b8de0d1-7b6f-4629-a9d3-790c4f0070a2	1	PARA525	amidol ( paracetamol syrup)	\N	drugs	consumable	Bottles	Each	1	3	0	125	1025	3	32	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.192003	2026-03-30 11:02:45.192003	1
b96860d5-502b-4730-bcb3-44dcbd38cdf8	1	PARA526	amizole	\N	drugs	consumable	Bottles	Each	1	1	0	126	1026	5	33	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.197587	2026-03-30 11:02:45.197587	1
a299694d-3f5b-4f37-bfa7-80058eebf4ca	1	PARA527	amlodac 10mg	\N	drugs	consumable	Strips	Each	1	15	0	127	1027	5	34	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.206892	2026-03-30 11:02:45.206892	1
b7415089-32bc-4d7f-89bb-ab7d86f4a0dc	1	PARA528	amlodac 5mg	\N	drugs	consumable	Strips	Each	1	8	0	128	1028	10	35	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.214034	2026-03-30 11:02:45.214034	1
3cf1c581-92d3-4d3f-8a37-cca0401070d2	1	PARA529	amloxt 10mg	\N	drugs	consumable	Strips	Each	1	1	0	129	1029	10	36	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.23076	2026-03-30 11:02:45.23076	1
2ce2654f-48c7-4dfe-b8d0-1b45d6b1de06	1	PARA504	Aciclovir	\N	drugs	consumable	Strips	Each	1	49	0	104	1004	10	11	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.913545	2026-03-30 11:02:44.913545	1
9d78ed43-deab-4871-b7a2-3024901cf613	1	PARA502	abnal	\N	drugs	consumable	Bottles	Each	1	5	0	102	1002	10	9	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.890445	2026-03-30 11:02:44.890445	1
a12ea35b-c54e-4d7c-859f-7016a996812b	1	PARA503	absorbent gauze sponge	\N	drugs	consumable	Pieces	Each	1	14	0	103	1003	5	10	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:44.898487	2026-03-30 11:02:44.898487	1
740639e2-74e3-4c91-96f9-16cd04b43ca5	1	PARA530	amloxt 5mg	\N	drugs	consumable	Strips	Each	1	9	0	130	1030	10	37	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.244585	2026-03-30 11:02:45.244585	1
9a16dd69-81f5-446c-8920-bd39b519ff72	1	PARA531	Amoclan 1g	\N	drugs	consumable	Tablets	Each	1	4	0	131	1031	5	38	weighted_average	14000.0000	14000.0000	28000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.258776	2026-03-30 11:02:45.258776	1
bfecec85-b208-4168-9c5b-19b1bb7a140e	1	PARA532	Amoxillin capsule	\N	drugs	consumable	Strips	Each	1	15	0	132	1032	20	39	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.273664	2026-03-30 11:02:45.273664	1
ef6eb954-e037-48af-88ae-e86b63d0d460	1	PARA533	amoxy 125	\N	drugs	consumable	Bott	Each	1	8	0	133	1033	20	40	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.288967	2026-03-30 11:02:45.288967	1
f7c335ed-245c-464a-94c7-88871dc30bb7	1	PARA534	ampi 250mg	\N	drugs	consumable	strips	Each	1	49	0	134	1034	20	41	weighted_average	0.0000	0.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.299107	2026-03-30 11:02:45.299107	1
947a712a-d7bb-4587-8ae7-9d23393b4a0c	1	PARA535	ampicillin injection	\N	drugs	consumable	Vials	Each	1	2	0	135	1035	10	42	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.364415	2026-03-30 11:02:45.364415	1
721dc1a6-6c20-4388-8c8e-46b9437d9dfe	1	PARA536	Ampicilline 250mg caps	\N	drugs	consumable	Strips	Each	1	49	0	136	1036	10	43	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.382071	2026-03-30 11:02:45.382071	1
baf8dda7-107c-4e97-bbf7-db4402b141a6	1	PARA537	ampicilline 500mg	\N	drugs	consumable	Strips	Each	1	27	0	137	1037	10	44	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.408708	2026-03-30 11:02:45.408708	1
632c5bf2-f701-44ab-ad2f-64f2983c6c42	1	PARA538	Ampiclox caps	\N	drugs	consumable	Strips	Each	1	42	0	138	1038	10	45	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.427142	2026-03-30 11:02:45.427142	1
2057b15e-ac0c-4c42-a656-2778710ac9d4	1	PARA539	Anaflam	\N	drugs	consumable	Bott	Each	1	0	0	139	1039	20	46	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.457782	2026-03-30 11:02:45.457782	1
56856ba3-8a6a-4970-abc3-be36d56b7db9	1	PARA540	Andrenalina	\N	drugs	consumable	Ampoules	Each	1	73	0	140	1040	5	47	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.468129	2026-03-30 11:02:45.468129	1
8bffdc37-7d3a-4fbe-a767-45ed9c5237a0	1	PARA541	anntagit	\N	drugs	consumable	0	Each	1	0	0	141	1041	10	48	weighted_average	1.0000	1.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.500173	2026-03-30 11:02:45.500173	1
43967abe-a27a-4383-afad-6b6b08ac9b00	1	PARA542	Anti pain-plus	\N	drugs	consumable	Strips	Each	1	0	0	142	1042	5	49	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.508127	2026-03-30 11:02:45.508127	1
fc4e59b6-b287-4d96-b9af-e12496a1ee5e	1	PARA543	Anti-Acid	\N	drugs	consumable	Strips	Each	1	10	0	143	1043	10	50	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.525784	2026-03-30 11:02:45.525784	1
25c7b1df-120b-40c8-90ce-c032faf82608	1	PARA544	Anti-Hemorrhoidal 30mg	\N	drugs	consumable	Tubes	Each	1	4	0	144	1044	3	51	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.546963	2026-03-30 11:02:45.546963	1
48c1074a-17ef-49bc-83d5-8785fc91ccfa	1	PARA545	Anti-Pain plus	\N	drugs	consumable	Strips	Each	1	5	0	145	1045	5	52	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.570654	2026-03-30 11:02:45.570654	1
5def0cf1-b089-48b6-8e6e-9cb23168e9ad	1	PARA546	Anti-Skab 5%	\N	drugs	consumable	Tubes	Each	1	2	0	146	1046	3	53	weighted_average	27500.0000	27500.0000	55000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.608807	2026-03-30 11:02:45.608807	1
caac78ba-fff0-4bba-babe-b438027fd14b	1	PARA547	Antinal	\N	drugs	consumable	Bottles	Each	1	3	0	147	1047	2	54	weighted_average	25000.0000	25000.0000	50000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.629055	2026-03-30 11:02:45.629055	1
ec256f77-4bbe-4bef-9e6d-0579e853d18d	1	PARA548	apidone	\N	drugs	consumable	bott	Each	1	0	0	148	1048	10	55	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.664369	2026-03-30 11:02:45.664369	1
f82497a7-395b-484a-b4e6-524b4c78b9f9	1	PARA549	apifortyl	\N	drugs	consumable	strips	Each	1	0	0	149	1049	10	56	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.670656	2026-03-30 11:02:45.670656	1
61e55405-07d1-457b-99c4-869f3e86730c	1	PARA550	aquamal	\N	drugs	consumable	Bottles	Each	1	11	0	150	1050	5	57	weighted_average	13000.0000	13000.0000	26000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.677022	2026-03-30 11:02:45.677022	1
edc514fa-a469-476f-a9ac-fc4f9d635294	1	PARA551	argesun 180	\N	drugs	consumable	Vials	Each	1	0	0	151	1051	5	58	weighted_average	25000.0000	25000.0000	50000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.693357	2026-03-30 11:02:45.693357	1
c2192a84-d524-47d4-8c06-f083a6d735bc	1	PARA552	argesun 30	\N	drugs	consumable	Vials	Each	1	2	0	152	1052	5	59	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.700583	2026-03-30 11:02:45.700583	1
f8f14579-5cbd-4d0b-b92d-00f13249d500	1	PARA553	argesun 60	\N	drugs	consumable	Vials	Each	1	10	0	153	1053	5	60	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.71969	2026-03-30 11:02:45.71969	1
d21ccc85-2221-4017-abb6-cfc97e01c6d0	1	PARA554	arimidex	\N	drugs	consumable	Strips	Each	1	6	0	154	1054	4	61	weighted_average	45000.0000	45000.0000	90000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.738558	2026-03-30 11:02:45.738558	1
f016558b-c173-48c1-ab86-516e164b62cc	1	PARA555	arquick	\N	drugs	consumable	Strips	Each	1	8	0	155	1055	10	62	weighted_average	18000.0000	18000.0000	36000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:45.756719	2026-03-30 11:02:45.756719	1
fac3b4bd-c6af-436f-b54d-80995e250ce5	1	PARA556	Artel Care	\N	drugs	consumable	Strips	Each	1	13	0	156	1056	5	63	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.119257	2026-03-30 11:02:46.119257	1
90b0b13a-2091-447d-81e9-a81e0b3a91e3	1	PARA557	Artemether	\N	drugs	consumable	Strips	Each	1	12	0	157	1057	5	64	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.131917	2026-03-30 11:02:46.131917	1
87323a77-29f7-4f28-a388-fad75569a676	1	PARA558	artemether + lumefantrine	\N	drugs	consumable	Strips	Each	1	10	0	158	1058	5	65	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.145558	2026-03-30 11:02:46.145558	1
25b62ed8-8452-4752-ad21-ab1345d19c8c	1	PARA559	artesun	\N	drugs	consumable	pkt	Each	1	0	0	159	1059	10	66	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.164781	2026-03-30 11:02:46.164781	1
60cbe282-5b89-40ef-9dc9-7e9e93f134c2	1	PARA560	ARTESUN 120	\N	drugs	consumable	Vials	Each	1	1	0	160	1060	5	67	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.16959	2026-03-30 11:02:46.16959	1
96203d88-d150-40bd-b8fc-e374ee6190b6	1	PARA561	artesunate 180mg	\N	drugs	consumable	Vials	Each	1	28	0	161	1061	20	68	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.180507	2026-03-30 11:02:46.180507	1
ac9859a3-e966-4a84-a195-e7d91dfa0910	1	PARA562	artesunate for injection	\N	drugs	consumable	Vials	Each	1	3	0	162	1062	5	69	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.192082	2026-03-30 11:02:46.192082	1
9e687729-b299-4146-bb65-87bdf3e66ecb	1	PARA563	artheget	\N	drugs	consumable	bottle	Each	1	0	0	163	1063	10	70	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.202011	2026-03-30 11:02:46.202011	1
a18e633b-ac8f-446e-bfec-e1aa6e2d7ef4	1	PARA564	artheget Junior	\N	drugs	consumable	Bottles	Each	1	3	0	164	1064	5	71	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.205742	2026-03-30 11:02:46.205742	1
feb574b0-7ea1-441a-a3e3-abe0b443e005	1	PARA565	arthinueur	\N	drugs	consumable	strips	Each	1	0	0	165	1065	10	72	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.230616	2026-03-30 11:02:46.230616	1
74ab0c9d-8ccf-4cab-88fe-bb526968e4f4	1	PARA566	artisin 30	\N	drugs	consumable	vial	Each	1	0	0	166	1066	20	73	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.236053	2026-03-30 11:02:46.236053	1
c57bc086-f276-4c0e-a426-ad25e177d632	1	PARA567	aspirin	\N	drugs	consumable	Strips	Each	1	9	0	167	1067	10	74	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.243756	2026-03-30 11:02:46.243756	1
88e249ea-2066-43e7-8eaa-15a6d5e7b41c	1	PARA568	aspirin cardio	\N	drugs	consumable	strips	Each	1	0	0	168	1068	10	75	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.255061	2026-03-30 11:02:46.255061	1
9622c7ea-123b-4ebd-ac26-e9ef70da441b	1	PARA569	aspocid	\N	drugs	consumable	Strips	Each	1	14	0	169	1069	5	76	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.258088	2026-03-30 11:02:46.258088	1
c98ba1c9-3f0c-46b9-b323-5e085d03c2c6	1	PARA570	Atacand 16	\N	drugs	consumable	Strips	Each	1	6	0	170	1070	4	77	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.265564	2026-03-30 11:02:46.265564	1
27f07296-17aa-4f8e-9095-d4e8aa6f4261	1	PARA571	Atacand 16 plus	\N	drugs	consumable	Strips	Each	1	10	0	171	1071	4	78	weighted_average	23000.0000	23000.0000	46000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.284575	2026-03-30 11:02:46.284575	1
b5c58b9f-96a0-40b1-bb83-0d8c8ebda875	1	PARA572	Atacand 8mg	\N	drugs	consumable	Strips	Each	1	10	0	172	1072	4	79	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.309057	2026-03-30 11:02:46.309057	1
5feaf223-03ba-43ef-9dfc-49a4a23b4a78	1	PARA573	atrapar	\N	drugs	consumable	Drops	Each	1	4	0	173	1073	10	80	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.328825	2026-03-30 11:02:46.328825	1
9192391f-13e8-4033-babb-ae5fb83ef97e	1	PARA574	ATRON-20MG	\N	drugs	consumable	Strips	Each	1	22	0	174	1074	10	81	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.347782	2026-03-30 11:02:46.347782	1
0512b262-8af3-474b-8ea4-9d103854be9e	1	PARA575	atrona	\N	drugs	consumable	strips	Each	1	0	0	175	1075	10	82	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.371946	2026-03-30 11:02:46.371946	1
d72a7623-5f33-421e-ab13-2b5dd66b734f	1	PARA576	atrona-20	\N	drugs	consumable	Strips	Each	1	20	0	176	1076	10	83	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.38167	2026-03-30 11:02:46.38167	1
05081ce4-1942-40ef-9cf5-a1fdca182c3e	1	PARA577	augmentin	\N	drugs	consumable	strips	Each	1	0	0	177	1077	10	84	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.387902	2026-03-30 11:02:46.387902	1
508e27b4-9f78-479d-8516-1b930d1f953b	1	PARA578	augram	\N	drugs	consumable	pkt	Each	1	0	0	178	1078	10	85	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.38959	2026-03-30 11:02:46.38959	1
4a72b38a-47bc-400c-8d88-93e448c7632f	1	PARA579	axylin	\N	drugs	consumable	Bottles	Each	1	1	0	179	1079	10	86	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.390962	2026-03-30 11:02:46.390962	1
c3201415-e6f2-4607-8366-477fcabe3ce8	1	PARA580	Azithromycin	\N	drugs	consumable	Bottles	Each	1	15	0	180	1080	5	87	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.395155	2026-03-30 11:02:46.395155	1
3d19422c-fa68-4c77-8f45-e2835a2e0577	1	PARA581	Azithromycin 500 tablets	\N	drugs	consumable	Strips	Each	1	16	0	181	1081	5	88	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.402823	2026-03-30 11:02:46.402823	1
72da8ec9-f6cf-4297-8982-3567cf0c643f	1	PARA582	babini pro	\N	drugs	consumable	tin	Each	1	0	0	182	1082	10	89	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.411578	2026-03-30 11:02:46.411578	1
3841b0b7-8d17-4933-bcec-2d1e60920df0	1	PARA583	baby call	\N	drugs	consumable	Bottles	Each	1	2	0	183	1083	5	90	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.416408	2026-03-30 11:02:46.416408	1
6a7113c5-cc4f-4870-8304-24c62b6af920	1	PARA584	baby rest	\N	drugs	consumable	bottle	Each	1	16	0	184	1084	5	91	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.42492	2026-03-30 11:02:46.42492	1
5e28235f-efab-4b2d-b463-8fb4be547566	1	PARA585	bacticure	\N	drugs	consumable	pkt	Each	1	7	0	185	1085	10	92	weighted_average	40000.0000	40000.0000	80000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.432319	2026-03-30 11:02:46.432319	1
b14d6c91-23e0-4354-86f1-e3a1e5a77806	1	PARA586	bactisul	\N	drugs	consumable	Vials	Each	1	1	0	186	1086	5	93	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.436543	2026-03-30 11:02:46.436543	1
0a6aa7ef-0afc-4057-afa3-dfe98dd472b5	1	PARA587	Bambini pro	\N	drugs	consumable	Strips	Each	1	2	0	187	1087	2	94	weighted_average	50000.0000	50000.0000	100000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.44176	2026-03-30 11:02:46.44176	1
0b0e5672-3d63-4588-a8b7-4ffb8979300e	1	PARA588	benzathine benzylpenicillin	\N	drugs	consumable	Vials	Each	1	7	0	188	1088	10	95	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.446783	2026-03-30 11:02:46.446783	1
19d667a7-3e45-4e1a-a834-72962e9db4ea	1	PARA589	benzoate d benzyle	\N	drugs	consumable	Bottles	Each	1	12	0	189	1089	3	96	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.449566	2026-03-30 11:02:46.449566	1
facc10ec-1d46-4966-9a41-199ac30a18bd	1	PARA590	Benzylpenicillin	\N	drugs	consumable	Vials	Each	1	37	0	190	1090	15	97	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.453421	2026-03-30 11:02:46.453421	1
a7a2fde9-e216-443e-8e88-3dffe02ad111	1	PARA591	betafucin	\N	drugs	consumable	Tubes	Each	1	3	0	191	1091	3	98	weighted_average	21000.0000	21000.0000	42000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.464236	2026-03-30 11:02:46.464236	1
974c6422-2889-4fc9-9fd5-add8edf46008	1	PARA592	Betaserc	\N	drugs	consumable	Strips	Each	1	9	0	192	1092	5	99	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.471599	2026-03-30 11:02:46.471599	1
5184e1d5-6211-4174-8a6c-8181d5b94508	1	PARA593	betasol	\N	drugs	consumable	Tubes	Each	1	9	0	193	1093	5	100	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.485925	2026-03-30 11:02:46.485925	1
fc770881-e212-48e9-b47a-f853fa5ad967	1	PARA594	betasol 15g	\N	drugs	consumable	Tubes	Each	1	8	0	194	1094	3	101	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.501207	2026-03-30 11:02:46.501207	1
d5553a35-a598-4b5a-bb39-617a62489a95	1	PARA595	Biberon feeding bottle	\N	drugs	consumable	Tablets	Each	1	0	0	195	1095	10	102	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.515147	2026-03-30 11:02:46.515147	1
3f840421-9589-4405-9ded-8a7fe72f1dc9	1	PARA596	bisacody	\N	drugs	consumable	strips	Each	1	10	0	196	1096	20	103	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.521004	2026-03-30 11:02:46.521004	1
d38b779b-f012-4a54-95cf-30e12654a9a1	1	PARA597	bisacodyl	\N	drugs	consumable	Strips	Each	1	12	0	197	1097	10	104	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.531152	2026-03-30 11:02:46.531152	1
5ab2102b-fa52-4300-84a0-ed7c337c29af	1	PARA598	c-gol	\N	drugs	consumable	Strips	Each	1	9	0	198	1098	3	105	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.54083	2026-03-30 11:02:46.54083	1
d82e7e56-08d3-465b-bcc8-a891dbae46fa	1	PARA599	cadestern 16mg	\N	drugs	consumable	strips	Each	1	0	0	199	1099	10	106	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.557041	2026-03-30 11:02:46.557041	1
ad645c65-39fe-4e3f-b97f-f081c3e73eaa	1	PARA600	cal-mag	\N	drugs	consumable	strips	Each	1	0	0	200	1100	10	107	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.562409	2026-03-30 11:02:46.562409	1
df7117d3-e393-42c1-a771-789e24b43850	1	PARA601	calamine lotion	\N	drugs	consumable	Bott	Each	1	17	0	201	1101	20	108	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.569251	2026-03-30 11:02:46.569251	1
7c24dad4-3fb9-42bc-b207-55816a0b4c71	1	PARA602	Caleoxib	\N	drugs	consumable	strips	Each	1	0	0	202	1102	10	109	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.582389	2026-03-30 11:02:46.582389	1
e712447e-a659-4bf9-847f-6ecf3513d61b	1	PARA603	canderm	\N	drugs	consumable	Bottles	Each	1	2	0	203	1103	1	110	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.586613	2026-03-30 11:02:46.586613	1
2b66b7a0-f4a3-4dcd-958e-8aff2efe6bfc	1	PARA604	canderm plus	\N	drugs	consumable	tube	Each	1	2	0	204	1104	20	111	weighted_average	0.0000	0.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.596595	2026-03-30 11:02:46.596595	1
60461669-3dba-4f9d-86a1-951da476af9a	1	PARA605	candersten 16	\N	drugs	consumable	Strips	Each	1	15	0	205	1105	6	112	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.606315	2026-03-30 11:02:46.606315	1
506df257-2c30-4784-adca-176a965cc61c	1	PARA606	candersten 16plus	\N	drugs	consumable	strips	Each	1	0	0	206	1106	10	113	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.609643	2026-03-30 11:02:46.609643	1
ebb13d8a-4a7d-40a0-9059-d5e8124a829f	1	PARA607	candestern 8mg	\N	drugs	consumable	strips	Each	1	0	0	207	1107	10	114	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.611773	2026-03-30 11:02:46.611773	1
17d22d55-b084-4cdb-a889-9f4c1cb2ebd9	1	PARA608	candiderm	\N	drugs	consumable	tub	Each	1	0	0	208	1108	20	115	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.614488	2026-03-30 11:02:46.614488	1
a14f7ffc-e89d-4536-baa5-96bd53e31d81	1	PARA609	candistin	\N	drugs	consumable	bottle	Each	1	0	0	209	1109	10	116	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.618352	2026-03-30 11:02:46.618352	1
d6f95cd3-4576-4e6b-9b3a-4aed096c3541	1	PARA610	cannula	\N	drugs	consumable	piece	Each	1	67	0	210	1110	10	117	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.62286	2026-03-30 11:02:46.62286	1
3b0906f1-49a5-4e21-8382-069970c1b7a6	1	PARA611	canula	\N	drugs	consumable	Pieces	Each	1	219	0	211	1111	10	118	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.634232	2026-03-30 11:02:46.634232	1
afa6ab5c-cd22-4383-9136-6a0ecfbedb85	1	PARA612	capotril	\N	drugs	consumable	strips	Each	1	0	0	212	1112	10	119	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.65518	2026-03-30 11:02:46.65518	1
9cafd164-35b1-4d22-adc4-917964839027	1	PARA613	carbamazepine	\N	drugs	consumable	Strips	Each	1	4	0	213	1113	5	120	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.65918	2026-03-30 11:02:46.65918	1
2d701db3-fdc0-423d-9fec-ae9863ed10ab	1	PARA614	cardura 2mg	\N	drugs	consumable	Strips	Each	1	10	0	214	1114	4	121	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.671042	2026-03-30 11:02:46.671042	1
3b6e1d0d-437a-4598-b3da-ad08de0a77e1	1	PARA615	casalt D	\N	drugs	consumable	strips	Each	1	0	0	215	1115	10	122	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.680082	2026-03-30 11:02:46.680082	1
01c5a95e-7a91-4383-a098-8f0ff177fb54	1	PARA616	cefalexin capsule	\N	drugs	consumable	Strips	Each	1	17	0	216	1116	5	123	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.686719	2026-03-30 11:02:46.686719	1
4dc7cbbe-338a-40b9-83b1-f080b99554f1	1	PARA617	cefatax	\N	drugs	consumable	Strips	Each	1	14	0	217	1117	10	124	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.694281	2026-03-30 11:02:46.694281	1
9361f977-2e2c-40fe-8619-07886501019b	1	PARA618	cefidime 1g	\N	drugs	consumable	Vials	Each	1	22	0	218	1118	10	125	weighted_average	23000.0000	23000.0000	46000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.705365	2026-03-30 11:02:46.705365	1
4e0c0bf3-5c0b-4503-ba00-df969e36de29	1	PARA619	cefixime	\N	drugs	consumable	Bott	Each	1	16	0	219	1119	20	126	weighted_average	0.0000	0.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.715648	2026-03-30 11:02:46.715648	1
58aa1400-783b-411d-b426-e1d15842b0a9	1	PARA620	cefixime 200	\N	drugs	consumable	Strips	Each	1	4	0	220	1120	5	127	weighted_average	12500.0000	12500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.731228	2026-03-30 11:02:46.731228	1
0ef0a6cf-09f4-410a-8cf9-dc0c15e8ad92	1	PARA621	cefixime 400	\N	drugs	consumable	Strips	Each	1	6	0	221	1121	5	128	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.751591	2026-03-30 11:02:46.751591	1
372424a8-5f02-46d7-9b42-1f6664d93ff5	1	PARA622	Cefiz-O	\N	drugs	consumable	strips	Each	1	3	0	222	1122	20	129	weighted_average	0.0000	0.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.76215	2026-03-30 11:02:46.76215	1
a20ec8bc-8110-44f0-a425-bff2bae66ab6	1	PARA623	ceftriaxone 1g	\N	drugs	consumable	Vials	Each	1	96	0	223	1123	10	130	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.772366	2026-03-30 11:02:46.772366	1
53734d56-7097-4f7f-9a92-ce76c752d2c4	1	PARA624	cefuroxime	\N	drugs	consumable	Vials	Each	1	20	0	224	1124	10	131	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.789092	2026-03-30 11:02:46.789092	1
4755ce84-d1ef-4a76-94fa-c9b62792e096	1	PARA625	cefuroxime 750mg	\N	drugs	consumable	Vials	Each	1	1	0	225	1125	10	132	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.813734	2026-03-30 11:02:46.813734	1
d54c33e9-4fd4-4df3-a7fa-c0c9413bd1e7	1	PARA626	celecoxib	\N	drugs	consumable	strip	Each	1	0	0	226	1126	10	133	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.820325	2026-03-30 11:02:46.820325	1
473b6e72-8990-4278-869d-24cc589347b2	1	PARA627	Cemicresto	\N	drugs	consumable	Strips	Each	1	20	0	227	1127	5	134	weighted_average	8500.0000	8500.0000	17000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.824527	2026-03-30 11:02:46.824527	1
5856c323-1c23-4930-abbb-70a86a5b0d63	1	PARA628	cetal	\N	drugs	consumable	Strips	Each	1	30	0	228	1128	10	135	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.832465	2026-03-30 11:02:46.832465	1
420a3eca-9716-4821-a9f1-fd591a8d0b8a	1	PARA629	cetrak	\N	drugs	consumable	Bottles	Each	1	2	0	229	1129	3	136	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.84393	2026-03-30 11:02:46.84393	1
2ce52784-de1d-43c6-9135-c942cc52a4ae	1	PARA630	Cetrizine	\N	drugs	consumable	Strips	Each	1	63	0	230	1130	10	137	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.853958	2026-03-30 11:02:46.853958	1
cdc70380-a658-4f45-a76f-c7aa7bf7091b	1	PARA631	cetzan	\N	drugs	consumable	strips	Each	1	65	0	231	1131	20	138	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.861765	2026-03-30 11:02:46.861765	1
8479e5ec-a8a6-4ee2-ad3f-10b9f1797d9a	1	PARA632	char	\N	drugs	consumable	strips	Each	1	0	0	232	1132	20	139	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.872028	2026-03-30 11:02:46.872028	1
03087504-03bc-41f5-84f1-70456504072d	1	PARA633	charcoalvin	\N	drugs	consumable	strips	Each	1	0	0	233	1133	20	140	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.874158	2026-03-30 11:02:46.874158	1
ee1e5949-ba29-4c86-b1f0-889fe23839fd	1	PARA634	Chlorphenamine	\N	drugs	consumable	Strips	Each	1	12	0	234	1134	5	141	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.87812	2026-03-30 11:02:46.87812	1
fab849b1-24f5-4be9-87e3-a4a9ef248a5d	1	PARA635	cipralex	\N	drugs	consumable	strips	Each	1	0	0	235	1135	10	142	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.890271	2026-03-30 11:02:46.890271	1
e4ce239d-3459-40ef-b359-4bb466172cd2	1	PARA636	ciprof	\N	drugs	consumable	Strips	Each	1	28	0	236	1136	10	143	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.894097	2026-03-30 11:02:46.894097	1
aeb4af22-c2b3-4d6a-b586-69abea0e2280	1	PARA637	ciprofloxacin infusion	\N	drugs	consumable	Bottles	Each	1	39	0	237	1137	10	144	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.908148	2026-03-30 11:02:46.908148	1
992dd75e-efc0-4b16-9555-bc8dfca1bdbf	1	PARA638	clamoxin 228.5	\N	drugs	consumable	Bottles	Each	1	9	0	238	1138	5	145	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.917701	2026-03-30 11:02:46.917701	1
8a565bf4-318f-4cd6-89cc-1a40fc847df5	1	PARA639	clarized	\N	drugs	consumable	Strips	Each	1	9	0	239	1139	5	146	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.926888	2026-03-30 11:02:46.926888	1
7e429fdf-e12e-4d51-8ed6-694b6e87290b	1	PARA640	clear air	\N	drugs	consumable	pkt	Each	1	0	0	240	1140	10	147	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.939009	2026-03-30 11:02:46.939009	1
d83231bc-b532-459b-903c-33bbefa48fd7	1	PARA641	clofi 50	\N	drugs	consumable	strips	Each	1	0	0	241	1141	20	148	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.942039	2026-03-30 11:02:46.942039	1
78cf3b23-b4e1-463c-8751-ef98cc51c599	1	PARA642	clotrimazole vaginal pessitories	\N	drugs	consumable	Packs	Each	1	5	0	242	1142	3	149	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.948221	2026-03-30 11:02:46.948221	1
bc029a0d-94e7-4fc5-befd-6abb18597886	1	PARA643	co-Trimoxazole	\N	drugs	consumable	strips	Each	1	16	0	243	1143	5	150	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.961215	2026-03-30 11:02:46.961215	1
2890f88a-570a-4ee2-beb9-4ac93f38646f	1	PARA644	coldease	\N	drugs	consumable	bottle	Each	1	5	0	244	1144	20	151	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.974639	2026-03-30 11:02:46.974639	1
91ede258-26eb-4b61-917e-b38db74ae717	1	PARA645	Coli-urinal	\N	drugs	consumable	tin	Each	1	0	0	245	1145	10	152	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.990949	2026-03-30 11:02:46.990949	1
896aca4d-71e6-4bce-a784-66c5be7a656a	1	PARA646	colidur 200mg	\N	drugs	consumable	Strips	Each	1	4	0	246	1146	5	153	weighted_average	42000.0000	42000.0000	84000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:46.99461	2026-03-30 11:02:46.99461	1
6b8947a9-c2e0-43ea-ab3d-c9a76fedda0d	1	PARA647	colona	\N	drugs	consumable	strips	Each	1	0	0	247	1147	10	154	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.004463	2026-03-30 11:02:47.004463	1
40e16d8e-0ff3-4673-bce5-f293d80936bc	1	PARA648	concor	\N	drugs	consumable	strips	Each	1	0	0	248	1148	10	155	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.007508	2026-03-30 11:02:47.007508	1
eb7f6ee1-fcf6-4f94-ba01-81efc167d4fe	1	PARA649	cortileb	\N	drugs	consumable	Tubes	Each	1	10	0	249	1149	3	156	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.013829	2026-03-30 11:02:47.013829	1
fd816f4f-0de0-481a-afb8-90911daed725	1	PARA650	cotricel	\N	drugs	consumable	bottle	Each	1	0	0	250	1150	10	157	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.024406	2026-03-30 11:02:47.024406	1
415f7c80-af85-459d-a8c8-603405a4c2eb	1	PARA651	credanil	\N	drugs	consumable	strips	Each	1	0	0	251	1151	10	158	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.028472	2026-03-30 11:02:47.028472	1
35d49d2c-e294-47ed-aec1-a022bd94c8e0	1	PARA652	creep bandage 10	\N	drugs	consumable	Pieces	Each	1	17	0	252	1152	10	159	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.036652	2026-03-30 11:02:47.036652	1
0341d18e-6d65-475e-9876-510f0d86921a	1	PARA653	creep bandage 15	\N	drugs	consumable	Pieces	Each	1	11	0	253	1153	10	160	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.048277	2026-03-30 11:02:47.048277	1
bd26e856-3b6a-4d44-b661-69e61eab5bcd	1	PARA654	creep bandage 7.5	\N	drugs	consumable	Pieces	Each	1	17	0	254	1154	10	161	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.067558	2026-03-30 11:02:47.067558	1
6fbed104-4ea3-4092-8f98-7e3327dd0a09	1	PARA655	Crepe bandage	\N	drugs	consumable	Rolls	Each	1	21	0	255	1155	5	162	weighted_average	10000.0000	10000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.086476	2026-03-30 11:02:47.086476	1
6b24a698-ed07-428c-bbfc-b056edd77539	1	PARA656	crepe bandage 10cm	\N	drugs	consumable	Rolls	Each	1	17	0	256	1156	5	163	weighted_average	7500.0000	7500.0000	7500.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.096106	2026-03-30 11:02:47.096106	1
8c64e2bf-a902-41bf-b629-ae23d5e4dc16	1	PARA657	crepe bandage 7.5cm	\N	drugs	consumable	Tablets	Each	1	13	0	257	1157	5	164	weighted_average	5000.0000	5000.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.112006	2026-03-30 11:02:47.112006	1
aecd7d57-52c2-4279-a689-467e83bc2b40	1	PARA658	crestor	\N	drugs	consumable	strips	Each	1	0	0	258	1158	10	165	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.126771	2026-03-30 11:02:47.126771	1
4a67e1a3-caa4-4580-86a0-9b23bf6c2a77	1	PARA659	cynanocabalamin	\N	drugs	consumable	Packs	Each	1	0	0	259	1159	10	166	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.132962	2026-03-30 11:02:47.132962	1
0aa0d76f-347a-4147-9e97-90cbb5dc953a	1	PARA660	cynazed	\N	drugs	consumable	amp	Each	1	0	0	260	1160	10	167	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.137027	2026-03-30 11:02:47.137027	1
0140ae37-bf37-43bf-a42a-ceafd1650957	1	PARA661	cypractin	\N	drugs	consumable	Bottles	Each	1	16	0	261	1161	5	168	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.141073	2026-03-30 11:02:47.141073	1
b465e319-99a0-4731-ad03-45aa8f6877ce	1	PARA662	d-artepp adult	\N	drugs	consumable	Strips	Each	1	4	0	262	1162	10	169	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.157453	2026-03-30 11:02:47.157453	1
0d30aaea-8656-4fa1-99d4-991acfb43a35	1	PARA663	d-artepp Pedriatric	\N	drugs	consumable	Strips	Each	1	5	0	263	1163	10	170	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.184223	2026-03-30 11:02:47.184223	1
fb11be47-a5de-4b92-8475-cd9377728829	1	PARA664	D-Tamol	\N	drugs	consumable	strips	Each	1	0	0	264	1164	20	171	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.195458	2026-03-30 11:02:47.195458	1
debd496e-6761-4fd4-818d-ce889f17d71e	1	PARA665	D10%	\N	drugs	consumable	Bottles	Each	1	14	0	265	1165	5	172	weighted_average	75000.0000	75000.0000	150000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.204447	2026-03-30 11:02:47.204447	1
5283120c-f223-4e77-a72d-85b608ddf4c9	1	PARA666	D5%	\N	drugs	consumable	Bottles	Each	1	7	0	266	1166	5	173	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.219236	2026-03-30 11:02:47.219236	1
b67a407f-cb62-43e5-afd0-411dc9c1c603	1	PARA667	D50%	\N	drugs	consumable	Bottles	Each	1	0	0	267	1167	10	174	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.233385	2026-03-30 11:02:47.233385	1
34c1858e-5996-4ba6-9691-5be0225680f6	1	PARA668	daflon	\N	drugs	consumable	strips	Each	1	0	0	268	1168	10	175	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.239296	2026-03-30 11:02:47.239296	1
4b6e436e-9325-42a4-99fc-ae4d17d5778b	1	PARA669	dafrex	\N	drugs	consumable	strips	Each	1	0	0	269	1169	10	176	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.246173	2026-03-30 11:02:47.246173	1
022bfcf6-acc7-450f-98b8-33ad88afdd08	1	PARA670	Daonil	\N	drugs	consumable	Strips	Each	1	13	0	270	1170	5	177	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.252154	2026-03-30 11:02:47.252154	1
6c549a01-4ba5-4aa1-91bf-c6b404224cfa	1	PARA671	darob 80mg	\N	drugs	consumable	strips	Each	1	0	0	271	1171	10	178	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.2592	2026-03-30 11:02:47.2592	1
00b0f0e3-7a28-4818-8fc4-cd750d6a8b2e	1	PARA672	dattol wipes	\N	drugs	consumable	pkt	Each	1	0	0	272	1172	10	179	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.265547	2026-03-30 11:02:47.265547	1
e598ac79-8c08-4e60-a338-6c301f69904e	1	PARA673	Davido	\N	drugs	consumable	Strips	Each	1	0	0	273	1173	5	180	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.272229	2026-03-30 11:02:47.272229	1
5a9ff3d4-2343-4962-8bb8-ac584a64bb5b	1	PARA674	dawa cort	\N	drugs	consumable	tube	Each	1	4	0	274	1174	20	181	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.285418	2026-03-30 11:02:47.285418	1
a9463a41-4e74-4c41-b1a1-ed7be1a5f0cb	1	PARA675	Dawa cpm	\N	drugs	consumable	Bott	Each	1	7	0	275	1175	20	182	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.29598	2026-03-30 11:02:47.29598	1
f222ec0f-a47c-404b-a3ab-abe1221909d0	1	PARA676	dawa prom	\N	drugs	consumable	strips	Each	1	0	0	276	1176	20	183	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.306953	2026-03-30 11:02:47.306953	1
819a3ae8-c5a6-43e6-b168-5d9795c3e0a5	1	PARA677	dawaclox	\N	drugs	consumable	strips	Each	1	0	0	277	1177	10	184	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.311538	2026-03-30 11:02:47.311538	1
00e4608f-e400-47bb-a95f-a579c150fa40	1	PARA678	dawaspirin	\N	drugs	consumable	strips	Each	1	0	0	278	1178	10	185	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.313782	2026-03-30 11:02:47.313782	1
d000285f-5d93-4494-8dc0-c330b377f976	1	PARA679	Dawavate cream	\N	drugs	consumable	Tubes	Each	1	3	0	279	1179	3	186	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.315501	2026-03-30 11:02:47.315501	1
eca39c87-6ba6-435b-a602-3fa0b0295672	1	PARA680	dazepam	\N	drugs	consumable	strips	Each	1	10	0	280	1180	20	187	weighted_average	0.0000	0.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.326854	2026-03-30 11:02:47.326854	1
d57e2c8c-b590-4912-88e6-cb5993fed2f2	1	PARA681	deep heat	\N	drugs	consumable	Bottles	Each	1	2	0	281	1181	10	188	weighted_average	21000.0000	21000.0000	42000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.335446	2026-03-30 11:02:47.335446	1
4cbd8aa7-3389-42c3-8ee0-f89cccbfa272	1	PARA682	defix	\N	drugs	consumable	strips	Each	1	0	0	282	1182	10	189	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.343984	2026-03-30 11:02:47.343984	1
25fe1ebd-a4b5-421e-9051-8c1227fada84	1	PARA683	depin E retard	\N	drugs	consumable	Strips	Each	1	29	0	283	1183	20	190	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.348042	2026-03-30 11:02:47.348042	1
59cbfba4-ddc1-4bc6-bb8d-34b19a09a690	1	PARA684	Dermovate 0.5% krem	\N	drugs	consumable	Tubes	Each	1	4	0	284	1184	3	191	weighted_average	27500.0000	27500.0000	55000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.373836	2026-03-30 11:02:47.373836	1
4ace171e-124b-47f1-a9e8-0924bebee072	1	PARA685	Dermovate 0.5% merhem	\N	drugs	consumable	Tubes	Each	1	0	0	285	1185	3	192	weighted_average	27500.0000	27500.0000	55000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.3955	2026-03-30 11:02:47.3955	1
d49a10fe-e2f2-47f7-b8b5-326e8d83afb8	1	PARA686	deslorat	\N	drugs	consumable	strips	Each	1	9	0	286	1186	4	193	weighted_average	92500.0000	92500.0000	185000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.403669	2026-03-30 11:02:47.403669	1
cfa26704-9816-4984-a7a4-f56c9198a475	1	PARA687	dettol wipes	\N	drugs	consumable	Packs	Each	1	7	0	287	1187	5	194	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.424293	2026-03-30 11:02:47.424293	1
7b935200-204a-40cb-be60-d0a8235bad41	1	PARA688	devit	\N	drugs	consumable	Ampoules	Each	1	2	0	288	1188	2	195	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.441704	2026-03-30 11:02:47.441704	1
fdf16382-238f-4287-a892-687a8e2ad1a5	1	PARA689	dexamethasone	\N	drugs	consumable	Strips	Each	1	18	0	289	1189	10	196	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.456061	2026-03-30 11:02:47.456061	1
1e6c2ff1-574d-4308-b479-c9b7a8e9f25c	1	PARA690	dexatrol	\N	drugs	consumable	tube	Each	1	0	0	290	1190	10	197	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.473172	2026-03-30 11:02:47.473172	1
8de131ab-d547-4234-b918-ac482404a019	1	PARA691	Dextrose 5%	\N	drugs	consumable	bottle	Each	1	34	0	291	1191	10	198	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.496232	2026-03-30 11:02:47.496232	1
75c505c8-3653-4ab5-a977-5cca47894e5a	1	PARA692	diaformin	\N	drugs	consumable	strips	Each	1	0	0	292	1192	10	199	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.513066	2026-03-30 11:02:47.513066	1
d70b7a79-185d-42e6-b3ef-d839b9a89e98	1	PARA693	diaformin 850	\N	drugs	consumable	Strips	Each	1	18	0	293	1193	10	200	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.526266	2026-03-30 11:02:47.526266	1
15a5a3f5-95d8-429d-b945-d63b6c979692	1	PARA694	diamicron 30 mg	\N	drugs	consumable	strips	Each	1	0	0	294	1194	10	201	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.538852	2026-03-30 11:02:47.538852	1
e1deb0ae-659f-4ec9-9602-2157aca854f8	1	PARA695	diamicron 60mg	\N	drugs	consumable	strips	Each	1	0	0	295	1195	10	202	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.553745	2026-03-30 11:02:47.553745	1
496e1db5-0d57-4ce3-89b2-5e7927011c9a	1	PARA696	Diazepam	\N	drugs	consumable	Strips	Each	1	10	0	296	1196	5	203	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.557014	2026-03-30 11:02:47.557014	1
a6ba7f01-6c2f-4895-b107-bc8c3f04d975	1	PARA697	diazepam inj.	\N	drugs	consumable	Ampoules	Each	1	24	0	297	1197	5	204	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.573111	2026-03-30 11:02:47.573111	1
76f4ac4c-7437-4662-b197-eb1e1d76afc2	1	PARA698	diclofenac inj.	\N	drugs	consumable	Ampoules	Each	1	12	0	298	1198	5	205	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.591547	2026-03-30 11:02:47.591547	1
9aa06698-cd16-4bb9-bb17-53a43f8be76d	1	PARA699	digoxin	\N	drugs	consumable	ampules	Each	1	0	0	299	1199	10	206	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.598984	2026-03-30 11:02:47.598984	1
021395a0-da66-41da-836b-11c07f80e90b	1	PARA700	dimra	\N	drugs	consumable	strips	Each	1	0	0	300	1200	10	207	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.60579	2026-03-30 11:02:47.60579	1
8382f6ab-8361-4598-bf0a-477ebb50dd42	1	PARA701	Diproson	\N	drugs	consumable	Tubes	Each	1	1	0	301	1201	3	208	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.609015	2026-03-30 11:02:47.609015	1
066928ae-f357-4f79-8d8b-15686b5db226	1	PARA702	divido	\N	drugs	consumable	strips	Each	1	0	0	302	1202	10	209	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.612708	2026-03-30 11:02:47.612708	1
55ea02b4-a1dc-46f5-be97-1bd66314c89f	1	PARA703	DNS	\N	drugs	consumable	Bottles	Each	1	21	0	303	1203	10	210	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.614645	2026-03-30 11:02:47.614645	1
d8c243ac-42c9-4963-8c5a-55cef1ae3e7f	1	PARA704	dolphin K	\N	drugs	consumable	ampules	Each	1	0	0	304	1204	10	211	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.61984	2026-03-30 11:02:47.61984	1
c078e1d0-8e0d-43be-98ec-6c72c77aa62d	1	PARA705	doxycycline	\N	drugs	consumable	Strips	Each	1	31	0	305	1205	10	212	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.623254	2026-03-30 11:02:47.623254	1
9a05417f-1888-4a40-bc7f-c02dc99463c0	1	PARA706	drafrex	\N	drugs	consumable	strips	Each	1	0	0	306	1206	10	213	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.629963	2026-03-30 11:02:47.629963	1
f91a1f75-6a5c-424d-a94b-68b17fa3eedc	1	PARA707	dragon	\N	drugs	consumable	tub	Each	1	0	0	307	1207	20	214	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.633769	2026-03-30 11:02:47.633769	1
0c4a37d6-326d-4048-aef0-7addd7b0f55b	1	PARA708	ebastine	\N	drugs	consumable	bott	Each	1	0	0	308	1208	10	215	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.64031	2026-03-30 11:02:47.64031	1
107d96d6-aab1-422c-b307-7fc08cc1da98	1	PARA709	eficef	\N	drugs	consumable	strips	Each	1	9	0	309	1209	20	216	weighted_average	0.0000	0.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.642869	2026-03-30 11:02:47.642869	1
e919d904-b5f8-496c-adfb-5049b05b96bb	1	PARA710	emenor	\N	drugs	consumable	Strips	Each	1	22	0	310	1210	5	217	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.650335	2026-03-30 11:02:47.650335	1
50975cf1-411d-4098-b83f-bc09cbd0f802	1	PARA711	emforal	\N	drugs	consumable	strips	Each	1	0	0	311	1211	10	218	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.656679	2026-03-30 11:02:47.656679	1
ace4c44d-4edc-462c-965e-02c8446e42e6	1	PARA712	enderm-HF	\N	drugs	consumable	Tubes	Each	1	1	0	312	1212	20	219	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.659027	2026-03-30 11:02:47.659027	1
683e10a7-4582-48c0-8edd-b5c96ae364fe	1	PARA713	enox 4000iu	\N	drugs	consumable	Tablets	Each	1	0	0	313	1213	10	220	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.665217	2026-03-30 11:02:47.665217	1
3f8b5b64-5e91-408c-8cde-0dd543f7b29a	1	PARA714	epiderm	\N	drugs	consumable	Tubes	Each	1	5	0	314	1214	5	221	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.669145	2026-03-30 11:02:47.669145	1
987e5409-5263-40cd-b4ea-45a125ec141b	1	PARA715	epifenac	\N	drugs	consumable	strips	Each	1	0	0	315	1215	10	222	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.683564	2026-03-30 11:02:47.683564	1
44762e38-25dd-4d1e-8091-9271d4c713f0	1	PARA716	epifenac tablet 50mg	\N	drugs	consumable	Tablets	Each	1	50	0	316	1216	5	223	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.691169	2026-03-30 11:02:47.691169	1
de4fdb82-212c-4abd-a986-c0692bb23763	1	PARA717	epinosin B	\N	drugs	consumable	ampules	Each	1	0	0	317	1217	10	224	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.701666	2026-03-30 11:02:47.701666	1
063b1ba6-a392-41e7-8afc-5e0cf38dd4f0	1	PARA718	epirelefan	\N	drugs	consumable	Vials	Each	1	26	0	318	1218	10	225	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.710926	2026-03-30 11:02:47.710926	1
c5bcaef4-b0b7-4ec2-9f2c-7c10297b6afc	1	PARA719	epirizine	\N	drugs	consumable	strips	Each	1	0	0	319	1219	10	226	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.728224	2026-03-30 11:02:47.728224	1
db75b055-9755-4fc2-b45c-1098550db9b1	1	PARA720	eryshal	\N	drugs	consumable	Strips	Each	1	17	0	320	1220	10	227	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.732244	2026-03-30 11:02:47.732244	1
58a9d731-5074-4d03-bd43-7f413c754de8	1	PARA721	erythromycin	\N	drugs	consumable	Bottles	Each	1	8	0	321	1221	5	228	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.744972	2026-03-30 11:02:47.744972	1
035faf1a-b255-4ad8-ada1-2f9c9f0d99eb	1	PARA722	ETR 120	\N	drugs	consumable	Strips	Each	1	6	0	322	1222	5	229	weighted_average	8000.0000	8000.0000	16000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.756174	2026-03-30 11:02:47.756174	1
9c109501-d048-444d-b980-4a5efc503be5	1	PARA723	ETR 60	\N	drugs	consumable	strips	Each	1	0	0	323	1223	10	230	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.764666	2026-03-30 11:02:47.764666	1
0b7a1bc6-20e4-4acc-b5dd-037686baa0cb	1	PARA724	ETR 90	\N	drugs	consumable	strips	Each	1	2	0	324	1224	5	231	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.771872	2026-03-30 11:02:47.771872	1
3e08c008-d53d-4e08-b324-42ff3476500d	1	PARA725	euromia	\N	drugs	consumable	ampules	Each	1	0	0	325	1225	10	232	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.78557	2026-03-30 11:02:47.78557	1
21f0f960-27ad-4921-ae46-0fe90099c508	1	PARA726	EV DEXA	\N	drugs	consumable	bottle	Each	1	0	0	326	1226	20	233	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.789636	2026-03-30 11:02:47.789636	1
32d17a70-3eb7-49e2-8a72-55639d01e604	1	PARA727	evapharma	\N	drugs	consumable	strips	Each	1	0	0	327	1227	10	234	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.792048	2026-03-30 11:02:47.792048	1
18c283ce-a6d0-45b3-b9f9-67f09730d1b9	1	PARA728	exforge	\N	drugs	consumable	strips	Each	1	0	0	328	1228	10	235	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.794249	2026-03-30 11:02:47.794249	1
60be824d-c997-44fb-9d8e-832019fe9317	1	PARA729	eye blink	\N	drugs	consumable	bott	Each	1	0	0	329	1229	10	236	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.79569	2026-03-30 11:02:47.79569	1
61829b00-9564-498f-9626-716d4d6fd434	1	PARA730	face mask	\N	drugs	consumable	Pieces	Each	1	97	0	330	1230	10	237	weighted_average	750.0000	750.0000	1500.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.797808	2026-03-30 11:02:47.797808	1
3ba2aec8-4c46-45d3-931e-84b2993ef936	1	PARA731	fastel	\N	drugs	consumable	bottle	Each	1	0	0	331	1231	10	238	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.806482	2026-03-30 11:02:47.806482	1
1fd02ab9-1b16-4c2c-b6ce-459f403f5ecc	1	PARA732	fastum gel	\N	drugs	consumable	tube	Each	1	0	0	332	1232	10	239	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.808222	2026-03-30 11:02:47.808222	1
bb66ddca-254e-4e70-b77a-2bf18ba84b14	1	PARA733	februx	\N	drugs	consumable	strips	Each	1	0	0	333	1233	20	240	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.811102	2026-03-30 11:02:47.811102	1
fd48c142-1ec5-44b6-b7e0-71aca3ddd2e0	1	PARA734	feeding bottle big	\N	drugs	consumable	bottle	Each	1	0	0	334	1234	10	241	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.813337	2026-03-30 11:02:47.813337	1
d114ae2b-448d-4a83-a471-b648052f8157	1	PARA735	feeding bottle small	\N	drugs	consumable	bottle	Each	1	0	0	335	1235	10	242	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.81769	2026-03-30 11:02:47.81769	1
a774e9ae-db21-4ec4-8e01-213b811ffa10	1	PARA736	feeding tube	\N	drugs	consumable	Pieces	Each	1	10	0	336	1236	3	243	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.825501	2026-03-30 11:02:47.825501	1
0ca0722d-309f-4f06-9726-ee51f36e0fa3	1	PARA737	ferratal	\N	drugs	consumable	strips	Each	1	0	0	337	1237	10	244	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.832136	2026-03-30 11:02:47.832136	1
a8e531da-9579-48ef-99c6-80c419f200e7	1	PARA738	ferro fast	\N	drugs	consumable	bott	Each	1	0	0	338	1238	10	245	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.843383	2026-03-30 11:02:47.843383	1
c1635bb1-ab35-4a75-b905-edf92252e869	1	PARA739	fertilex forte men	\N	drugs	consumable	pkt	Each	1	0	0	339	1239	10	246	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.846277	2026-03-30 11:02:47.846277	1
e641c291-5357-4b7e-9205-031f4cf8caa4	1	PARA740	fertilex forte women	\N	drugs	consumable	pkt	Each	1	0	0	340	1240	10	247	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.851805	2026-03-30 11:02:47.851805	1
2b629fb9-371a-46ca-958c-38d0621d3285	1	PARA741	Fiber Vox	\N	drugs	consumable	tin	Each	1	3	0	341	1241	2	248	weighted_average	27000.0000	27000.0000	54000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.855826	2026-03-30 11:02:47.855826	1
842bbfa9-785b-4a37-aa0d-c253459e47bf	1	PARA742	Fidermycin	\N	drugs	consumable	tube	Each	1	0	0	342	1242	10	249	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.863694	2026-03-30 11:02:47.863694	1
a7a86d80-d614-422a-a54b-efb3dace2891	1	PARA743	first  aid plaster	\N	drugs	consumable	Pieces	Each	1	98	0	343	1243	20	250	weighted_average	500.0000	500.0000	1000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.865644	2026-03-30 11:02:47.865644	1
ed7be3ce-3a91-433d-91a8-8e7949493610	1	PARA744	FLATIDYL 40mg	\N	drugs	consumable	strips	Each	1	33	0	344	1244	6	251	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.876879	2026-03-30 11:02:47.876879	1
6a333bf1-b11a-43a3-b33b-41e21975f310	1	PARA745	flazine	\N	drugs	consumable	tube	Each	1	12	0	345	1245	5	252	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.882188	2026-03-30 11:02:47.882188	1
492e05bf-f82a-4fe6-9752-c4791cc23439	1	PARA746	fliren	\N	drugs	consumable	Strips	Each	1	0	0	346	1246	10	253	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.889718	2026-03-30 11:02:47.889718	1
bd74ac18-276b-435a-ae25-55ba8493263f	1	PARA747	flodent	\N	drugs	consumable	tube	Each	1	12	0	347	1247	20	254	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.89478	2026-03-30 11:02:47.89478	1
8959e8c6-38d9-4c33-a3c8-32885c5f059f	1	PARA748	Flu Cap	\N	drugs	consumable	Strips	Each	1	24	0	348	1248	5	255	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.90679	2026-03-30 11:02:47.90679	1
4794fc7b-7fbc-4fdb-823f-3bd0a1cda83c	1	PARA749	flucalm	\N	drugs	consumable	bottle	Each	1	0	0	349	1249	10	256	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.915077	2026-03-30 11:02:47.915077	1
b2e81343-069c-41d1-a319-382ee28606ec	1	PARA750	flucap	\N	drugs	consumable	strips	Each	1	0	0	350	1250	20	257	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.92319	2026-03-30 11:02:47.92319	1
8569275c-eec9-4e60-a710-39e88f7075ab	1	PARA751	flumox	\N	drugs	consumable	vial	Each	1	0	0	351	1251	10	258	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.926584	2026-03-30 11:02:47.926584	1
f0bd1ae4-675c-44a0-89e9-85216f5229c2	1	PARA752	fol-u vit	\N	drugs	consumable	strips	Each	1	39	0	352	1252	20	259	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.927943	2026-03-30 11:02:47.927943	1
601d463c-99e9-4152-88de-dd7eb0f46e74	1	PARA753	folic acid	\N	drugs	consumable	strips	Each	1	0	0	353	1253	10	260	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.930607	2026-03-30 11:02:47.930607	1
e4728d60-9fe4-4af0-8944-4d9ba7c9d4a8	1	PARA754	fucidel	\N	drugs	consumable	Tubes	Each	1	5	0	354	1254	3	261	weighted_average	18000.0000	18000.0000	36000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.932408	2026-03-30 11:02:47.932408	1
907a58ca-ae49-40ff-bc15-cf44c33bcf53	1	PARA755	fungnil	\N	drugs	consumable	Tubes	Each	1	5	0	355	1255	3	262	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:47.940048	2026-03-30 11:02:47.940048	1
4fc54c9c-7bac-42ed-af61-9403ceb12b24	1	PARA756	furosemide injection	\N	drugs	consumable	Ampoules	Each	1	21	0	356	1256	5	263	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.03323	2026-03-30 11:02:48.03323	1
2f5d6786-4d99-4a05-8026-9ea19493c9ba	1	PARA757	galvus met 50mg/1000mg	\N	drugs	consumable	strips	Each	1	0	0	357	1257	10	264	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.045293	2026-03-30 11:02:48.045293	1
fe753fc2-41a8-457b-afe4-d048b2a0cdd9	1	PARA758	galvus met 50mg/850mg	\N	drugs	consumable	strips	Each	1	0	0	358	1258	10	265	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.047869	2026-03-30 11:02:48.047869	1
9f028853-d557-4432-b649-2d716a2c257c	1	PARA759	gastro resistant	\N	drugs	consumable	strips	Each	1	0	0	359	1259	20	266	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.053049	2026-03-30 11:02:48.053049	1
de3ccfba-ed0b-438f-9b8c-ab66bfd60642	1	PARA760	Gentamycin	\N	drugs	consumable	Ampoules	Each	1	134	0	360	1260	10	267	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.060948	2026-03-30 11:02:48.060948	1
7a028899-8ea8-463e-830e-f7e9663ca1fe	1	PARA761	gentamycin 0.3	\N	drugs	consumable	Bott	Each	1	10	0	361	1261	20	268	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.073037	2026-03-30 11:02:48.073037	1
471ecd11-6027-4918-83b1-f49dc669f5b3	1	PARA762	germol	\N	drugs	consumable	Bott	Each	1	0	0	362	1262	20	269	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.084304	2026-03-30 11:02:48.084304	1
17e3954d-dc4a-40e0-a8f7-65cc23c595e8	1	PARA763	gestranil	\N	drugs	consumable	strip	Each	1	0	0	363	1263	10	270	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.088854	2026-03-30 11:02:48.088854	1
ae4a218c-5721-4641-8ce2-a9f9ad09aa29	1	PARA764	giving set	\N	drugs	consumable	mg	Each	1	97	0	364	1264	20	271	weighted_average	1000.0000	1000.0000	2000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.092022	2026-03-30 11:02:48.092022	1
8a76a2a6-5a86-474f-825a-f73c1e3d4c69	1	PARA765	gliben	\N	drugs	consumable	strips	Each	1	51	0	365	1265	20	272	weighted_average	0.0000	0.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.103992	2026-03-30 11:02:48.103992	1
43e6bf8f-55cb-4fc7-aee8-5f967ec04340	1	PARA766	gliptus plus 50mg/1000mg	\N	drugs	consumable	strips	Each	1	0	0	366	1266	10	273	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.113103	2026-03-30 11:02:48.113103	1
dd3feb38-0037-44d5-9bf5-682aab10f79d	1	PARA767	gliptus plus 50mg/500mg	\N	drugs	consumable	Strips	Each	1	5	0	367	1267	10	274	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.114944	2026-03-30 11:02:48.114944	1
e7ccb8c2-ff92-4e13-973c-51acb0917d35	1	PARA768	go pain	\N	drugs	consumable	Strips	Each	1	26	0	368	1268	10	275	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.125919	2026-03-30 11:02:48.125919	1
49bfd889-29cb-49ca-85f7-cc99bfefe1fe	1	PARA769	gogynax	\N	drugs	consumable	strips	Each	1	1	0	369	1269	20	276	weighted_average	0.0000	0.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.139273	2026-03-30 11:02:48.139273	1
aa3e7929-3eec-4b73-ba97-1fc0daac42ba	1	PARA770	golden fer	\N	drugs	consumable	bott	Each	1	1	0	370	1270	10	277	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.161554	2026-03-30 11:02:48.161554	1
8cbd480e-c252-4b84-a2bd-3780a0b854d1	1	PARA771	goldmox 457	\N	drugs	consumable	Bottles	Each	1	10	0	371	1271	10	278	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.175347	2026-03-30 11:02:48.175347	1
b8b6ed18-9634-4bbe-8c8f-e9961b4d93b3	1	PARA772	good mornig	\N	drugs	consumable	Sachets	Each	1	10	0	372	1272	5	279	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.185128	2026-03-30 11:02:48.185128	1
658b9374-fffc-4b88-a773-d5c9b33c9ff6	1	PARA773	goodmorning	\N	drugs	consumable	piece	Each	1	0	0	373	1273	20	280	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.197531	2026-03-30 11:02:48.197531	1
7d483074-282e-465c-b6f8-272857fd79ea	1	PARA774	gripe water	\N	drugs	consumable	bottle	Each	1	0	0	374	1274	10	281	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.201911	2026-03-30 11:02:48.201911	1
ea102af9-3b5a-44ee-863d-48b26d71164c	1	PARA775	griseofulvine	\N	drugs	consumable	Tubes	Each	1	3	0	375	1275	3	282	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.208744	2026-03-30 11:02:48.208744	1
1df18dd2-7586-438b-b209-4d122af9e09e	1	PARA776	grisofline	\N	drugs	consumable	Strips	Each	1	14	0	376	1276	10	283	weighted_average	4500.0000	4500.0000	9000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.21604	2026-03-30 11:02:48.21604	1
503b8c7f-147e-4946-9179-94e11f25e8d3	1	PARA777	Gsunate	\N	drugs	consumable	vial	Each	1	0	0	377	1277	20	284	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.224578	2026-03-30 11:02:48.224578	1
cbda2269-5722-4bdf-aae2-1aa6a996a687	1	PARA778	gynazol	\N	drugs	consumable	Tubes	Each	1	3	0	378	1278	2	285	weighted_average	21000.0000	21000.0000	42000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.226081	2026-03-30 11:02:48.226081	1
9f6d9f25-feae-4a57-bbf5-061d6ffb6d19	1	PARA779	haemofort	\N	drugs	consumable	bott	Each	1	0	0	379	1279	10	286	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.238795	2026-03-30 11:02:48.238795	1
588a916b-f44d-450d-a511-65a0b2df705d	1	PARA780	haemofort 200ml	\N	drugs	consumable	Bottles	Each	1	19	0	380	1280	10	287	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.242932	2026-03-30 11:02:48.242932	1
0a703afa-93ba-49cc-9701-961eb61e6e59	1	PARA781	haemofort 90	\N	drugs	consumable	Bottles	Each	1	5	0	381	1281	5	288	weighted_average	9500.0000	9500.0000	19000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.309828	2026-03-30 11:02:48.309828	1
48940a06-383a-46f1-a88a-d3bb05e6291b	1	PARA782	haemoridease	\N	drugs	consumable	tube	Each	1	0	0	382	1282	20	289	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.338561	2026-03-30 11:02:48.338561	1
5134572d-f6a1-4671-a11b-a71f9cebea8e	1	PARA783	HCQ	\N	drugs	consumable	Strips	Each	1	10	0	383	1283	6	290	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.352083	2026-03-30 11:02:48.352083	1
38e79dbc-1ee3-4525-b0c7-2a855cdd05c8	1	PARA784	helicure	\N	drugs	consumable	pkt	Each	1	0	0	384	1284	10	291	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.365835	2026-03-30 11:02:48.365835	1
34f8250e-ef78-4d08-8b23-023933b5dbf0	1	PARA785	hiferron	\N	drugs	consumable	strips	Each	1	0	0	385	1285	10	292	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.380405	2026-03-30 11:02:48.380405	1
b2d84d08-5e7e-41f2-b26e-ff2b24113adb	1	PARA786	histafree	\N	drugs	consumable	Strips	Each	1	9	0	386	1286	5	293	weighted_average	9000.0000	9000.0000	18000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.388152	2026-03-30 11:02:48.388152	1
69d7ffd3-2320-4efb-8bf0-ae99fb1e0c13	1	PARA787	histafree 120mg	\N	drugs	consumable	strips	Each	1	0	0	387	1287	10	294	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.39671	2026-03-30 11:02:48.39671	1
93cbd8e8-53f8-467d-a104-e3b15821566b	1	PARA788	Hydrocortisone Injection	\N	drugs	consumable	Vials	Each	1	69	0	388	1288	15	295	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.400994	2026-03-30 11:02:48.400994	1
2b25b435-babe-44e7-aae0-6a8807571bb3	1	PARA789	hyoscine	\N	drugs	consumable	Strips	Each	1	14	0	389	1289	5	296	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.41323	2026-03-30 11:02:48.41323	1
a805642a-36fd-4d4a-981f-3332897c59a8	1	PARA790	ibuprofen	\N	drugs	consumable	Bottles	Each	1	8	0	390	1290	5	297	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.433634	2026-03-30 11:02:48.433634	1
8af9ee5b-3c91-4a32-b360-8b58e3fff8fc	1	PARA791	Ibuprofen 200	\N	drugs	consumable	Tablets	Each	1	40	0	391	1291	5	298	weighted_average	1000.0000	1000.0000	2000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.455832	2026-03-30 11:02:48.455832	1
0302e030-bef2-43f6-9240-bf80cb64f93d	1	PARA792	Ibuprofen tablet	\N	drugs	consumable	Strips	Each	1	21	0	392	1292	5	299	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.463789	2026-03-30 11:02:48.463789	1
2ec6524f-394a-4b93-948b-7d43e620e316	1	PARA793	imatinib	\N	drugs	consumable	strips	Each	1	0	0	393	1293	10	300	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.475866	2026-03-30 11:02:48.475866	1
81d81a55-866b-48b8-a462-bc55908f112c	1	PARA794	indogen	\N	drugs	consumable	strips	Each	1	24	0	394	1294	20	301	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.479621	2026-03-30 11:02:48.479621	1
66f3fae6-fb4a-464d-ae8d-ce4044ba403c	1	PARA795	infant feeding tube	\N	drugs	consumable	Pieces	Each	1	55	0	395	1295	10	302	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.498848	2026-03-30 11:02:48.498848	1
1915bd6c-aa6a-460c-a4ba-b1952a315683	1	PARA796	iodine	\N	drugs	consumable	Bott	Each	1	0	0	396	1296	20	303	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.511687	2026-03-30 11:02:48.511687	1
c07b3ee2-3b63-45bd-b2a3-ecf09fe2a9d4	1	PARA797	Iron Sucrose	\N	drugs	consumable	Ampoules	Each	1	12	0	397	1297	5	304	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.52128	2026-03-30 11:02:48.52128	1
4a06bee9-672b-4a06-996a-4f89e5157760	1	PARA798	isdrogest	\N	drugs	consumable	strips	Each	1	0	0	398	1298	10	305	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.538701	2026-03-30 11:02:48.538701	1
420f27fd-df32-462b-8168-c1297d5428cc	1	PARA799	iskit	\N	drugs	consumable	Packs	Each	1	32	0	399	1299	10	306	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.546973	2026-03-30 11:02:48.546973	1
7db261de-4115-4982-aca1-99597cdceccc	1	PARA800	ismila	\N	drugs	consumable	strips	Each	1	0	0	400	1300	10	307	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.558034	2026-03-30 11:02:48.558034	1
c1a38618-b852-4ecf-b0ee-901a118e5dcc	1	PARA801	isoptin	\N	drugs	consumable	strips	Each	1	0	0	401	1301	10	308	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.563834	2026-03-30 11:02:48.563834	1
c50e51fd-06af-40c0-85d4-29c4f8565307	1	PARA802	isordil	\N	drugs	consumable	Packs	Each	1	2	0	402	1302	10	309	weighted_average	30000.0000	30000.0000	60000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.573595	2026-03-30 11:02:48.573595	1
9de9e920-a1dd-4285-98ba-127209662d2a	1	PARA803	izzithree	\N	drugs	consumable	bottle	Each	1	0	0	403	1303	10	310	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.594042	2026-03-30 11:02:48.594042	1
8a0f5f1e-ad4f-436e-99a2-f3a58681e7db	1	PARA804	johnson	\N	drugs	consumable	bott	Each	1	0	0	404	1304	10	311	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.597663	2026-03-30 11:02:48.597663	1
81c4cc00-7812-4cdc-b6ba-2c9a8105efe5	1	PARA805	kali chlori	\N	drugs	consumable	amp	Each	1	0	0	405	1305	10	312	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.599714	2026-03-30 11:02:48.599714	1
e92b8c7d-a468-4518-900e-a9751ee8fbbc	1	PARA806	kemoxyl	\N	drugs	consumable	Bottles	Each	1	1	0	406	1306	10	313	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.603467	2026-03-30 11:02:48.603467	1
1d15fe74-7679-43e0-97d1-b67fe89dab6f	1	PARA807	ketazol	\N	drugs	consumable	strips	Each	1	6	0	407	1307	5	314	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.606981	2026-03-30 11:02:48.606981	1
c720ee8f-f9cb-4fb1-b210-f819dd575d52	1	PARA808	ketazol 15mg	\N	drugs	consumable	Tubes	Each	1	29	0	408	1308	5	315	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.614483	2026-03-30 11:02:48.614483	1
eb3d1bc0-d674-4520-bba4-b68475025080	1	PARA809	ketozol	\N	drugs	consumable	strips	Each	1	0	0	409	1309	10	316	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.995114	2026-03-30 11:02:48.995114	1
fcd90214-7772-44d0-b361-f11aa93eb3fd	1	PARA810	ketozol 15mg	\N	drugs	consumable	tube	Each	1	0	0	410	1310	10	317	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:48.999522	2026-03-30 11:02:48.999522	1
0010a0ec-33de-4ce8-89da-86d974e33f75	1	PARA811	ketozol 30mg	\N	drugs	consumable	tube	Each	1	0	0	411	1311	10	318	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.003681	2026-03-30 11:02:49.003681	1
f765ad0a-b46a-41d6-b1f5-b68734e476fa	1	PARA812	ketrap	\N	drugs	consumable	bott	Each	1	0	0	412	1312	10	319	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.007476	2026-03-30 11:02:49.007476	1
f7aaf715-7bea-405a-b5d1-5011475b3937	1	PARA813	kifaru 100	\N	drugs	consumable	tabs	Each	1	73	0	413	1313	10	320	weighted_average	0.0000	0.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.015297	2026-03-30 11:02:49.015297	1
b6fb132a-4789-4cf2-854f-fc916950ea0b	1	PARA814	kifaru 50	\N	drugs	consumable	tabs	Each	1	80	0	414	1314	15	321	weighted_average	0.0000	0.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.027775	2026-03-30 11:02:49.027775	1
c347aa1f-4e7d-43e5-bd98-8d1f96475237	1	PARA815	kiss	\N	drugs	consumable	Packs	Each	1	47	0	415	1315	20	322	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.043598	2026-03-30 11:02:49.043598	1
4c36e23d-082e-4d2c-a938-62d095ea2372	1	PARA816	koflin	\N	drugs	consumable	bottle	Each	1	0	0	416	1316	10	323	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.054183	2026-03-30 11:02:49.054183	1
5318bef9-3742-48e6-b721-fc9cb66cb82f	1	PARA817	Labesten 20mg	\N	drugs	consumable	Tubes	Each	1	2	0	417	1317	3	324	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.058891	2026-03-30 11:02:49.058891	1
eb7a325b-bcd0-451f-bae5-8b4bc85bab47	1	PARA818	Lactodel	\N	drugs	consumable	Strips	Each	1	10	0	418	1318	10	325	weighted_average	15000.0000	15000.0000	16500.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.066445	2026-03-30 11:02:49.066445	1
e2271231-1ed2-47da-a6eb-de3635516807	1	PARA819	Lactulose syrups	\N	drugs	consumable	Bottles	Each	1	4	0	419	1319	5	326	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.074974	2026-03-30 11:02:49.074974	1
329e78f8-1731-41f7-8521-e5608f23aeb4	1	PARA820	lampyklox	\N	drugs	consumable	Bott	Each	1	0	0	420	1320	20	327	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.093479	2026-03-30 11:02:49.093479	1
92bc4cb3-80d1-4e32-b07f-9821afe49bbb	1	PARA821	lasazide	\N	drugs	consumable	strips	Each	1	0	0	421	1321	10	328	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.095153	2026-03-30 11:02:49.095153	1
f5fc9749-b96f-48e2-b864-4b08c92ae513	1	PARA822	Lasix 20	\N	drugs	consumable	Ampoules	Each	1	21	0	422	1322	10	329	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.098142	2026-03-30 11:02:49.098142	1
b5ee0182-d0f9-4fba-92ca-b5ee495ab3f6	1	PARA823	lasix 40mg	\N	drugs	consumable	ampules	Each	1	0	0	423	1323	10	330	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.105828	2026-03-30 11:02:49.105828	1
5a6a9d1c-04c6-4413-bc41-6d6d62077dec	1	PARA824	latrozole 2.5	\N	drugs	consumable	Strips	Each	1	11	0	424	1324	5	331	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.108446	2026-03-30 11:02:49.108446	1
db9fb12f-e1e3-419b-b7ac-250208699239	1	PARA825	leopard	\N	drugs	consumable	tube	Each	1	0	0	425	1325	10	332	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.113765	2026-03-30 11:02:49.113765	1
4c3c9722-d2a4-49fb-b73e-2f3e3b63397b	1	PARA826	leopard Inhaler	\N	drugs	consumable	Tubes	Each	1	42	0	426	1326	10	333	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.117027	2026-03-30 11:02:49.117027	1
0374e362-cae9-43ee-8513-6bc1a3f327b6	1	PARA827	leopard ointiment	\N	drugs	consumable	Tubes	Each	1	10	0	427	1327	5	334	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.123441	2026-03-30 11:02:49.123441	1
75110175-2c75-4b99-8597-56dc8f1df592	1	PARA828	letrozole	\N	drugs	consumable	Strips	Each	1	11	0	428	1328	10	335	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.127351	2026-03-30 11:02:49.127351	1
5c91b3db-3f34-4bc1-a569-e6313cbe9d91	1	PARA829	levofloxacin 500	\N	drugs	consumable	Strips	Each	1	8	0	429	1329	5	336	weighted_average	8000.0000	8000.0000	16000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.13456	2026-03-30 11:02:49.13456	1
fc19c3b9-1d52-40d8-8f7a-ac739540d9cf	1	PARA830	levofloxacin 5mg/1ml	\N	drugs	consumable	Bottles	Each	1	0	0	430	1330	10	337	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.141229	2026-03-30 11:02:49.141229	1
99308bae-4ac1-409f-95ad-6a8d726a31f8	1	PARA831	levostal 500	\N	drugs	consumable	strips	Each	1	0	0	431	1331	20	338	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.143899	2026-03-30 11:02:49.143899	1
15308e15-dc20-404c-8ac2-4836d07441a3	1	PARA832	levotiron	\N	drugs	consumable	strips	Each	1	0	0	432	1332	10	339	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.145649	2026-03-30 11:02:49.145649	1
69014db7-6a7b-47c7-abc2-b9b4db29825e	1	PARA833	levoxin	\N	drugs	consumable	strips	Each	1	0	0	433	1333	20	340	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.147943	2026-03-30 11:02:49.147943	1
c30aa56f-9a4d-41fc-9e02-8d6be196b800	1	PARA834	librax	\N	drugs	consumable	strips	Each	1	0	0	434	1334	10	341	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.15158	2026-03-30 11:02:49.15158	1
1ae6b13d-e302-4db4-85a7-ddeefc498d7b	1	PARA835	limitless kids	\N	drugs	consumable	Bottles	Each	1	2	0	435	1335	5	342	weighted_average	40000.0000	40000.0000	80000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.154656	2026-03-30 11:02:49.154656	1
2c8ea4cb-f4d3-472e-8865-b623918ceb36	1	PARA836	limitless prenatal	\N	drugs	consumable	pkt	Each	1	0	0	436	1336	10	343	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.158067	2026-03-30 11:02:49.158067	1
d42eaec7-8945-4429-8be4-79876833d2f6	1	PARA837	Limitless Women Max	\N	drugs	consumable	bott	Each	1	0	0	437	1337	10	344	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.15977	2026-03-30 11:02:49.15977	1
b79f0b36-c970-4b17-954d-80d5e245eaa2	1	PARA838	lipitor	\N	drugs	consumable	Strips	Each	1	9	0	438	1338	10	345	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.16154	2026-03-30 11:02:49.16154	1
69bd66bf-af0f-4a61-9a59-a1367a07e414	1	PARA839	Lipoferric acid	\N	drugs	consumable	Strips	Each	1	27	0	439	1339	6	346	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.164823	2026-03-30 11:02:49.164823	1
1e90208b-9ace-4534-8b77-7b2d1ec24226	1	PARA840	livemak	\N	drugs	consumable	Bottles	Each	1	4	0	440	1340	5	347	weighted_average	30000.0000	30000.0000	60000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.167209	2026-03-30 11:02:49.167209	1
0c31f709-18ac-4cd9-bd29-44586b2a58df	1	PARA841	liveril	\N	drugs	consumable	pkt	Each	1	0	0	441	1341	10	348	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.169638	2026-03-30 11:02:49.169638	1
a59939ac-6cbf-48c6-92fc-0d4540236ccd	1	PARA842	livota 750mg	\N	drugs	consumable	Strips	Each	1	10	0	442	1342	5	349	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.17175	2026-03-30 11:02:49.17175	1
d1640a38-b616-4bd5-b1ab-c542ae964846	1	PARA843	loperamide	\N	drugs	consumable	strips	Each	1	17	0	443	1343	10	350	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.178838	2026-03-30 11:02:49.178838	1
f74fdebf-06ee-4350-8223-8f0c5f42b538	1	PARA844	Loratadine	\N	drugs	consumable	Strips	Each	1	42	0	444	1344	5	351	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.187507	2026-03-30 11:02:49.187507	1
d4f9ce4d-9d4d-4114-a4ff-2ddfadebd19c	1	PARA845	losartas	\N	drugs	consumable	strips	Each	1	0	0	445	1345	10	352	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.193517	2026-03-30 11:02:49.193517	1
3752e781-e036-40dc-8c66-20a4ba134fea	1	PARA846	lotevan plus	\N	drugs	consumable	strips	Each	1	0	0	446	1346	10	353	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.195227	2026-03-30 11:02:49.195227	1
646c0d3c-667a-4371-bc86-a85537e60a70	1	PARA847	lydia	\N	drugs	consumable	vial	Each	1	0	0	447	1347	10	354	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.196734	2026-03-30 11:02:49.196734	1
b7f24455-f892-4002-8cf9-193719f1f5fc	1	PARA848	mafo	\N	drugs	consumable	strips	Each	1	0	0	448	1348	10	355	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.198852	2026-03-30 11:02:49.198852	1
719ba4f3-7e14-40b2-a7c7-7c2d2b6d9f82	1	PARA849	magnavit	\N	drugs	consumable	Bottles	Each	1	6	0	449	1349	5	356	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.202124	2026-03-30 11:02:49.202124	1
0a43bff4-5c9c-4a0d-a2be-f72527441a8c	1	PARA850	Magnesium sulfate 50%	\N	drugs	consumable	Ampoules	Each	1	10	0	450	1350	5	357	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.209131	2026-03-30 11:02:49.209131	1
fa493fe1-496a-45fb-9282-3952a86810cc	1	PARA851	maladox	\N	drugs	consumable	Strips	Each	1	50	0	451	1351	10	358	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.216696	2026-03-30 11:02:49.216696	1
493041c2-8c2f-4cec-8894-dee037bbec2b	1	PARA852	Malanil	\N	drugs	consumable	Strips	Each	1	3	0	452	1352	2	359	weighted_average	290000.0000	290000.0000	580000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.229851	2026-03-30 11:02:49.229851	1
d26262a4-f8b7-4ad6-bf8d-ccadf3093675	1	PARA853	masclav 156	\N	drugs	consumable	bott	Each	1	0	0	453	1353	10	360	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.234936	2026-03-30 11:02:49.234936	1
e46c160c-d337-49ec-a234-ec2aaac03d52	1	PARA854	mcg  15 mg	\N	drugs	consumable	Tubes	Each	1	7	0	454	1354	5	361	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.239613	2026-03-30 11:02:49.239613	1
ecdfc3dd-3947-44f9-ab4e-c56b3f0a721e	1	PARA855	mebo	\N	drugs	consumable	tube	Each	1	0	0	455	1355	10	362	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.254367	2026-03-30 11:02:49.254367	1
33fcbecc-e0f7-4fdb-bd53-432f7ccc73af	1	PARA856	mefenamic acid	\N	drugs	consumable	Strips	Each	1	27	0	456	1356	5	363	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.260452	2026-03-30 11:02:49.260452	1
0a37eb34-0ce3-477a-be3a-75a2e0e06a9f	1	PARA857	megnavit	\N	drugs	consumable	bott	Each	1	7	0	457	1357	20	364	weighted_average	0.0000	0.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.272176	2026-03-30 11:02:49.272176	1
a14fce5d-2f89-4817-b184-55df75526a29	1	PARA858	mepaclind	\N	drugs	consumable	Strips	Each	1	4	0	458	1358	5	365	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.281457	2026-03-30 11:02:49.281457	1
1c46c5b8-deb9-47b4-b23b-c76beef81124	1	PARA859	mepacolon	\N	drugs	consumable	Strips	Each	1	19	0	459	1359	10	366	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.293423	2026-03-30 11:02:49.293423	1
6584997c-be16-4007-ab44-cbe0821c3831	1	PARA860	meropenam 1g	\N	drugs	consumable	Vials	Each	1	19	0	460	1360	10	367	weighted_average	25000.0000	25000.0000	50000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.306514	2026-03-30 11:02:49.306514	1
2ad4d9e1-4085-4b9e-8d41-13308fe39ffa	1	PARA861	metazol	\N	drugs	consumable	Strips	Each	1	88	0	461	1361	10	368	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.322996	2026-03-30 11:02:49.322996	1
dd0d5367-0a6f-4ee8-9dc0-68ba772b5e80	1	PARA862	metformina	\N	drugs	consumable	strips	Each	1	0	0	462	1362	20	369	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.339501	2026-03-30 11:02:49.339501	1
5965885d-6b9c-47fa-b663-67a4e49deadc	1	PARA863	methylated spirit	\N	drugs	consumable	bott	Each	1	0	0	463	1363	20	370	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.346228	2026-03-30 11:02:49.346228	1
c5506627-82d2-440e-9345-6217d3aa9c9d	1	PARA864	metoclopromide	\N	drugs	consumable	ampules	Each	1	20	0	464	1364	20	371	weighted_average	0.0000	0.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.349706	2026-03-30 11:02:49.349706	1
76c2774a-b6fa-41b1-9fc0-1e1774701441	1	PARA865	metronidazole	\N	drugs	consumable	Strips	Each	1	90	0	465	1365	10	372	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.379873	2026-03-30 11:02:49.379873	1
d1ce69d7-f9fd-405d-a881-bbd4eeccada1	1	PARA866	metronidazole 500	\N	drugs	consumable	Strips	Each	1	14	0	466	1366	10	373	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.38872	2026-03-30 11:02:49.38872	1
1d88889f-ecf0-488c-979e-aa423b19a7dc	1	PARA867	metronidazole 5mg/ml	\N	drugs	consumable	Bottles	Each	1	39	0	467	1367	10	374	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.402117	2026-03-30 11:02:49.402117	1
89f52a5a-064a-4f5e-a6cb-a148812a93f2	1	PARA868	miclocin 15	\N	drugs	consumable	Tubes	Each	1	4	0	468	1368	3	375	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.410075	2026-03-30 11:02:49.410075	1
fe6cc5e9-6806-4434-bcd0-42582b213809	1	PARA869	miconaz	\N	drugs	consumable	Tubes	Each	1	7	0	469	1369	3	376	weighted_average	18000.0000	18000.0000	36000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.423559	2026-03-30 11:02:49.423559	1
42816985-659c-4060-b598-b8a8101b10f5	1	PARA870	milga advance	\N	drugs	consumable	strips	Each	1	0	0	470	1370	10	377	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.429703	2026-03-30 11:02:49.429703	1
c905b25f-bab5-4e3d-8fd7-98575d1fbddc	1	PARA871	mixtard insulin	\N	drugs	consumable	vial	Each	1	0	0	471	1371	10	378	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.432223	2026-03-30 11:02:49.432223	1
c3f0af2c-4e71-4f04-a3cc-398e2c3cfa09	1	PARA872	mixxakof	\N	drugs	consumable	Bott	Each	1	4	0	472	1372	20	379	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.437605	2026-03-30 11:02:49.437605	1
d8784198-e4b6-4467-80e0-d25db291c634	1	PARA873	mobitil	\N	drugs	consumable	strips	Each	1	0	0	473	1373	10	380	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.442225	2026-03-30 11:02:49.442225	1
72b0f3d1-202d-4ceb-b062-27f82ec77ad1	1	PARA874	montiget	\N	drugs	consumable	strips	Each	1	0	0	474	1374	10	381	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.446174	2026-03-30 11:02:49.446174	1
bde9f9cb-62a5-42bb-8c58-651ef17df205	1	PARA875	montized	\N	drugs	consumable	strips	Each	1	0	0	475	1375	10	382	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.448901	2026-03-30 11:02:49.448901	1
841acceb-cc7e-41f6-8a4c-c4bae224f163	1	PARA876	montized l	\N	drugs	consumable	Strips	Each	1	23	0	476	1376	6	383	weighted_average	11500.0000	11500.0000	23000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.450365	2026-03-30 11:02:49.450365	1
937021ec-0f8e-4388-b81f-e93da7d2d985	1	PARA877	montized- 10mg	\N	drugs	consumable	Strips	Each	1	20	0	477	1377	6	384	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.462132	2026-03-30 11:02:49.462132	1
e6225b9d-e12f-4e89-a717-03c45737e2dc	1	PARA878	moov	\N	drugs	consumable	tube	Each	1	0	0	478	1378	10	385	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.47298	2026-03-30 11:02:49.47298	1
a90e3a13-899f-4a2d-8533-e5d5676c2021	1	PARA879	Motilium	\N	drugs	consumable	Strips	Each	1	19	0	479	1379	5	386	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.478935	2026-03-30 11:02:49.478935	1
a64debc2-2a5d-47c0-b1db-cfcf85714ad0	1	PARA880	Moxclear	\N	drugs	consumable	Drops	Each	1	8	0	480	1380	5	387	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.488113	2026-03-30 11:02:49.488113	1
7acf5aa8-32d2-43d3-a625-4b034015fa17	1	PARA881	moxiclav 1g	\N	drugs	consumable	Tablets	Each	1	6	0	481	1381	5	388	weighted_average	25000.0000	25000.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.495676	2026-03-30 11:02:49.495676	1
c5537839-8645-4b81-a244-d9c454628a94	1	PARA882	moxiclear	\N	drugs	consumable	Bottles	Each	1	8	0	482	1382	10	389	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.504139	2026-03-30 11:02:49.504139	1
2094d0c4-b5f7-4419-ab75-dc424a4a359e	1	PARA883	Moxiflox	\N	drugs	consumable	strips	Each	1	15	0	483	1383	5	390	weighted_average	34250.0000	34250.0000	68500.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.510892	2026-03-30 11:02:49.510892	1
71a37808-f98b-4686-a1c8-6dc2ed9be352	1	PARA884	moxyclav	\N	drugs	consumable	Strips	Each	1	1	0	484	1384	3	391	weighted_average	14000.0000	14000.0000	28000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.520051	2026-03-30 11:02:49.520051	1
75bbe8ac-912c-4960-8780-d76b7841e164	1	PARA885	moxyclav 457	\N	drugs	consumable	bott	Each	1	0	0	485	1385	10	392	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.531943	2026-03-30 11:02:49.531943	1
617fd668-618e-45f8-9056-ec18dbd9c288	1	PARA886	MSF	\N	drugs	consumable	pkt	Each	1	0	0	486	1386	10	393	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.537149	2026-03-30 11:02:49.537149	1
d94b44e1-dccd-4ce3-975b-84458977352b	1	PARA887	mvit	\N	drugs	consumable	strips	Each	1	0	0	487	1387	10	394	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.542291	2026-03-30 11:02:49.542291	1
43cb2273-fd03-4a8d-80fe-046b6da5e80f	1	PARA888	mycoren	\N	drugs	consumable	strips	Each	1	7	0	488	1388	20	395	weighted_average	0.0000	0.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.545999	2026-03-30 11:02:49.545999	1
c3de5d76-3575-4ef9-b0b5-c905ec743e73	1	PARA889	N.G.T 18	\N	drugs	consumable	Strips	Each	1	38	0	489	1389	10	396	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.552533	2026-03-30 11:02:49.552533	1
5368020a-de48-4e99-aa20-8ec485fd6848	1	PARA890	Nas-Uro	\N	drugs	consumable	Strips	Each	1	8	0	490	1390	3	397	weighted_average	9000.0000	9000.0000	18000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.564838	2026-03-30 11:02:49.564838	1
44c573ea-2835-4585-b0e1-556ea1879497	1	PARA891	Nasal Oxygen Cannula	\N	drugs	consumable	Pieces	Each	1	16	0	491	1391	10	398	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.577785	2026-03-30 11:02:49.577785	1
bf07d60c-95da-491c-aefe-84a916834b70	1	PARA892	neurovit	\N	drugs	consumable	Strips	Each	1	4	0	492	1392	3	399	weighted_average	5000.0000	5000.0000	7500.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.588747	2026-03-30 11:02:49.588747	1
41a0a01d-1744-4624-9084-4bf0d5c17c9a	1	PARA893	nexium	\N	drugs	consumable	strips	Each	1	0	0	493	1393	10	400	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.595471	2026-03-30 11:02:49.595471	1
d9b8d7d3-537d-40e9-a824-6ae8c173e488	1	PARA894	nifet	\N	drugs	consumable	strips	Each	1	0	0	494	1394	20	401	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.597585	2026-03-30 11:02:49.597585	1
1b72067d-3ea2-4e90-a276-af3e0dcb92df	1	PARA895	Nitro mak retard	\N	drugs	consumable	strips	Each	1	0	0	495	1395	10	402	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.60042	2026-03-30 11:02:49.60042	1
cf8c5dd7-db9c-463a-96eb-e2922f378a1b	1	PARA896	noflu	\N	drugs	consumable	strips	Each	1	0	0	496	1396	10	403	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.603648	2026-03-30 11:02:49.603648	1
6391525f-0b10-403f-9749-910d445aba59	1	PARA897	noradol 5mg	\N	drugs	consumable	ampules	Each	1	0	0	497	1397	10	404	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.608077	2026-03-30 11:02:49.608077	1
ebad58d3-5541-44ef-9c49-32cae0474f35	1	PARA898	norethisterone	\N	drugs	consumable	strips	Each	1	0	0	498	1398	10	405	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.610072	2026-03-30 11:02:49.610072	1
34511e26-4ded-4867-8253-d3b005eacc97	1	PARA899	normal saline	\N	drugs	consumable	Bottles	Each	1	37	0	499	1399	10	406	weighted_average	5000.0000	5000.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.617733	2026-03-30 11:02:49.617733	1
2be0d397-43a6-4d81-89cf-23eeb3759b35	1	PARA900	norodol	\N	drugs	consumable	Strips	Each	1	13	0	500	1400	5	407	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.628376	2026-03-30 11:02:49.628376	1
539c94a0-68b6-4e04-8686-7ea9999b7f86	1	PARA901	nospasum	\N	drugs	consumable	bott	Each	1	0	0	501	1401	10	408	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.639154	2026-03-30 11:02:49.639154	1
e16812f5-590a-4ea0-86c0-4a67be8a7b6b	1	PARA902	NU-SPASM	\N	drugs	consumable	ampules	Each	1	0	0	502	1402	10	409	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.643034	2026-03-30 11:02:49.643034	1
3c6cd7f5-7642-460a-9407-1e703368c6c1	1	PARA903	Nubulizer Mask	\N	drugs	consumable	Pieces	Each	1	14	0	503	1403	5	410	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.64847	2026-03-30 11:02:49.64847	1
db6dba6d-bac2-42c1-a863-28e4d77cb508	1	PARA904	NumbOn 2%	\N	drugs	consumable	tube	Each	1	0	0	504	1404	10	411	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.662694	2026-03-30 11:02:49.662694	1
5fa2f976-bca7-4d11-b33a-5ad76720b783	1	PARA905	nyrobina	\N	drugs	consumable	strips	Each	1	0	0	505	1405	10	412	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.664645	2026-03-30 11:02:49.664645	1
6ffd653f-0b07-4ac0-b7db-4a07422307c8	1	PARA906	nystatin	\N	drugs	consumable	Strips	Each	1	7	0	506	1406	10	413	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.666885	2026-03-30 11:02:49.666885	1
4bddddbb-d5f3-475b-a0be-adb80e171ba4	1	PARA907	nystatin oral	\N	drugs	consumable	Drops	Each	1	0	0	507	1407	10	414	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.678883	2026-03-30 11:02:49.678883	1
82c5cfd4-e453-4a68-b289-a5903b745275	1	PARA908	ocuflox	\N	drugs	consumable	bott	Each	1	0	0	508	1408	10	415	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.680851	2026-03-30 11:02:49.680851	1
5adff9c7-ed31-4b69-8cf1-f4569692ac3a	1	PARA909	ofrivid	\N	drugs	consumable	bott	Each	1	0	0	509	1409	10	416	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.682234	2026-03-30 11:02:49.682234	1
0d961bb7-fb94-4928-b93e-783c3480c8ae	1	PARA910	Olanzapine	\N	drugs	consumable	Strips	Each	1	5	0	510	1410	4	417	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.686425	2026-03-30 11:02:49.686425	1
1a7d5ad1-1a2f-4e47-a0c3-683300fb6a54	1	PARA911	Olazorix	\N	drugs	consumable	Strips	Each	1	14	0	511	1411	5	418	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.69194	2026-03-30 11:02:49.69194	1
3480185b-8d17-4887-930f-c63e6f47c209	1	PARA912	olme 20H	\N	drugs	consumable	strips	Each	1	7	0	512	1412	5	419	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.69873	2026-03-30 11:02:49.69873	1
7048cb75-b218-4f02-ae82-3a1821bdf001	1	PARA913	olme20AH	\N	drugs	consumable	Strips	Each	1	0	0	513	1413	10	420	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.709218	2026-03-30 11:02:49.709218	1
a2db380c-f167-4cc5-9953-81def8728b74	1	PARA914	olme20H	\N	drugs	consumable	strips	Each	1	0	0	514	1414	10	421	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.714733	2026-03-30 11:02:49.714733	1
1160ebc5-9250-4e22-868f-7e83a9228b1c	1	PARA915	olurus	\N	drugs	consumable	bott	Each	1	0	0	515	1415	10	422	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.721119	2026-03-30 11:02:49.721119	1
d516b631-27d1-441c-a2b9-947e9dff56c4	1	PARA916	omega a.i.t	\N	drugs	consumable	Strips	Each	1	10	0	516	1416	10	423	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.737061	2026-03-30 11:02:49.737061	1
fc042240-c4a6-443a-afa8-b1d1778334a6	1	PARA917	omega h3	\N	drugs	consumable	pkt	Each	1	0	0	517	1417	10	424	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.746813	2026-03-30 11:02:49.746813	1
7c8440a5-1cbf-44be-9feb-00e252151138	1	PARA918	omeprazole 20mg	\N	drugs	consumable	Strips	Each	1	17	0	518	1418	10	425	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.748943	2026-03-30 11:02:49.748943	1
1194fdde-df74-458c-9df8-2638b5fede97	1	PARA919	omeprazole 40mg	\N	drugs	consumable	Vials	Each	1	21	0	519	1419	10	426	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.762628	2026-03-30 11:02:49.762628	1
6569eefa-4de7-46d9-832c-bb45d266d5e4	1	PARA920	omlink	\N	drugs	consumable	pkt	Each	1	0	0	520	1420	10	427	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.772798	2026-03-30 11:02:49.772798	1
f59d5085-4108-4d0e-ba2f-1e2324e151ca	1	PARA921	omvit 3	\N	drugs	consumable	pkt	Each	1	2	0	521	1421	10	428	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.776073	2026-03-30 11:02:49.776073	1
9cdd5f1a-0e2f-4233-a481-b26e7dfe64d3	1	PARA922	On Call plus strips	\N	drugs	consumable	Bott	Each	1	0	0	522	1422	20	429	weighted_average	40000.0000	40000.0000	80000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.787178	2026-03-30 11:02:49.787178	1
7de3af20-2a5f-405f-aa76-f17b309de3d3	1	PARA923	one plus glucometer strips	\N	drugs	consumable	pkt	Each	1	0	0	523	1423	10	430	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.793843	2026-03-30 11:02:49.793843	1
eba5ec7e-d7db-4cb8-9a5e-14f45b57daaf	1	PARA924	oplex-N	\N	drugs	consumable	bottle	Each	1	0	0	524	1424	10	431	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.797032	2026-03-30 11:02:49.797032	1
da1e39ad-f039-40de-962c-2cbfb2290697	1	PARA925	Opranate	\N	drugs	consumable	strips	Each	1	4	0	525	1425	10	432	weighted_average	24000.0000	24000.0000	48000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.803496	2026-03-30 11:02:49.803496	1
d9d2e458-b0da-41a4-9dd0-f088396f4c56	1	PARA926	optive	\N	drugs	consumable	Drops	Each	1	7	0	526	1426	10	433	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.81211	2026-03-30 11:02:49.81211	1
e0943937-a89c-475b-9ee5-845b81730537	1	PARA927	oral zinc	\N	drugs	consumable	bottle	Each	1	0	0	527	1427	20	434	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.820337	2026-03-30 11:02:49.820337	1
42085aee-7bbf-4303-8f02-2a88e3b9d883	1	PARA928	ORS	\N	drugs	consumable	Sachets	Each	1	25	0	528	1428	5	435	weighted_average	1500.0000	1500.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.827414	2026-03-30 11:02:49.827414	1
ba0c6796-92a0-408f-a6f5-f9193615c678	1	PARA929	osteocare	\N	drugs	consumable	Strips	Each	1	13	0	529	1429	4	436	weighted_average	30000.0000	30000.0000	60000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.832167	2026-03-30 11:02:49.832167	1
0e19ab6f-a257-4794-9490-3f592728ca1b	1	PARA930	otocort	\N	drugs	consumable	bott	Each	1	0	0	530	1430	10	437	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.839714	2026-03-30 11:02:49.839714	1
4971685a-185f-42d8-a559-c3fe68b688a4	1	PARA931	otrivin adults	\N	drugs	consumable	Bottles	Each	1	6	0	531	1431	10	438	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.842891	2026-03-30 11:02:49.842891	1
66642bb7-341d-4fee-a731-66db7fddf83c	1	PARA932	otrivin children	\N	drugs	consumable	Bottles	Each	1	8	0	532	1432	5	439	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.84804	2026-03-30 11:02:49.84804	1
3ed663ef-ab18-4f6f-980e-cc8de020e70b	1	PARA933	ovagestone	\N	drugs	consumable	Tablets	Each	1	1	0	533	1433	2	440	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.855857	2026-03-30 11:02:49.855857	1
d699b7f2-576b-48a8-94bb-3cb687042ffe	1	PARA934	Oxyen Mask	\N	drugs	consumable	Pieces	Each	1	4	0	534	1434	2	441	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.863244	2026-03-30 11:02:49.863244	1
f8d9fe00-7e57-4936-8a2e-6e02147119e7	1	PARA935	oxytocin injection	\N	drugs	consumable	Packs	Each	1	20	0	535	1435	10	442	weighted_average	18000.0000	18000.0000	36000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.870494	2026-03-30 11:02:49.870494	1
93915044-d680-4fbc-a0ee-a13227628cea	1	PARA936	P-Alaxin	\N	drugs	consumable	Strips	Each	1	4	0	536	1436	5	443	weighted_average	14000.0000	14000.0000	28000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.876341	2026-03-30 11:02:49.876341	1
f2f2a7fd-d89a-470e-a78f-e06e35c72b02	1	PARA937	p-alaxin Syrup	\N	drugs	consumable	Bottles	Each	1	8	0	537	1437	5	444	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.882796	2026-03-30 11:02:49.882796	1
a7843843-5638-4389-8d70-8ecbb47d4c8f	1	PARA938	p-alaxin ts	\N	drugs	consumable	Strips	Each	1	11	0	538	1438	5	445	weighted_average	17000.0000	17000.0000	34000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.886987	2026-03-30 11:02:49.886987	1
04ba3489-ef97-4710-b72f-e9ac6cb83041	1	PARA939	pain rest	\N	drugs	consumable	Strips	Each	1	18	0	539	1439	5	446	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.891528	2026-03-30 11:02:49.891528	1
bf7433c9-707d-43fc-97e2-92f81c13bc58	1	PARA940	painNex	\N	drugs	consumable	strips	Each	1	0	0	540	1440	20	447	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.896063	2026-03-30 11:02:49.896063	1
914f1f08-e05e-49df-a273-7e085b999cd4	1	PARA941	pamper	\N	drugs	consumable	Tablets	Each	1	0	0	541	1441	10	448	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.898686	2026-03-30 11:02:49.898686	1
f903c6b1-5a20-480a-98be-5df479987b22	1	PARA942	panadol extra	\N	drugs	consumable	strips	Each	1	0	0	542	1442	20	449	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.900506	2026-03-30 11:02:49.900506	1
87ef81d6-ee87-4f77-8514-cde1f6bd6245	1	PARA943	panadol extra advance	\N	drugs	consumable	strips	Each	1	0	0	543	1443	20	450	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.901911	2026-03-30 11:02:49.901911	1
9949feb6-143f-42c2-b6a5-5fe9c8dc94e7	1	PARA944	panadol infusion	\N	drugs	consumable	Tablets	Each	1	3	0	544	1444	5	451	weighted_average	10000.0000	10000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.906091	2026-03-30 11:02:49.906091	1
119e4b0f-4da5-40d1-92b6-af8ac1c68f9b	1	PARA945	panadol normal	\N	drugs	consumable	Strips	Each	1	10	0	545	1445	5	452	weighted_average	1000.0000	1000.0000	2000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.914525	2026-03-30 11:02:49.914525	1
ea045e7b-df7b-45c8-a7c5-3485f1458c6e	1	PARA946	panta pra	\N	drugs	consumable	ampules	Each	1	0	0	546	1446	20	453	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.919482	2026-03-30 11:02:49.919482	1
57604847-fb7a-4de2-8282-8d85ece01019	1	PARA947	pantodac	\N	drugs	consumable	vial	Each	1	0	0	547	1447	10	454	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.921654	2026-03-30 11:02:49.921654	1
adf209a2-f4aa-481d-94c2-20fa5badc72e	1	PARA948	pantoprazole 40mg	\N	drugs	consumable	Vials	Each	1	15	0	548	1448	10	455	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.924474	2026-03-30 11:02:49.924474	1
c42b35e5-5dd1-4beb-be57-7747bc6a3547	1	PARA949	pantoprazole tablets	\N	drugs	consumable	Tablets	Each	1	27	0	549	1449	5	456	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.927437	2026-03-30 11:02:49.927437	1
43d66589-33af-480b-845b-73006287a4d5	1	PARA950	paracetamol	\N	drugs	consumable	Bottles	Each	1	7	0	550	1450	20	457	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.929926	2026-03-30 11:02:49.929926	1
af901d9d-299d-413c-aa90-24f824dd2649	1	PARA951	paracetamol 1g	\N	drugs	consumable	Bottles	Each	1	44	0	551	1451	10	458	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.932368	2026-03-30 11:02:49.932368	1
2eb420b4-8f3c-441e-89c0-3361cf4adf84	1	PARA952	paracetamol 500mg	\N	drugs	consumable	Strips	Each	1	8	0	552	1452	10	459	weighted_average	1000.0000	1000.0000	2000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.935544	2026-03-30 11:02:49.935544	1
f640dc10-6b44-4815-bf7c-79708c05ccda	1	PARA953	paxera	\N	drugs	consumable	Strips	Each	1	6	0	553	1453	2	460	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.951452	2026-03-30 11:02:49.951452	1
ddfd3bb5-3f99-45c7-b05a-146790e41a8b	1	PARA954	perfectil	\N	drugs	consumable	pkt	Each	1	0	0	554	1454	10	461	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.969697	2026-03-30 11:02:49.969697	1
b6ede438-c51e-44f3-b361-f04737d38c32	1	PARA955	perlex syrup	\N	drugs	consumable	bott	Each	1	4	0	555	1455	5	462	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.976785	2026-03-30 11:02:49.976785	1
2b0897a6-3d20-4ad5-aa8c-3140125961ed	1	PARA956	picolax	\N	drugs	consumable	Bottles	Each	1	11	0	556	1456	5	463	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:49.990797	2026-03-30 11:02:49.990797	1
8d584b8f-9000-4d30-b459-840963936f66	1	PARA957	piritex baby	\N	drugs	consumable	Bottles	Each	1	5	0	557	1457	20	464	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.001091	2026-03-30 11:02:50.001091	1
8bd722c2-1514-45fb-b2f6-8200d410ed11	1	PARA958	piritex junior	\N	drugs	consumable	bottle	Each	1	0	0	558	1458	20	465	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.005344	2026-03-30 11:02:50.005344	1
be9e3086-5e8e-4ac2-94eb-c0daaeeb4b4a	1	PARA959	piroxicam	\N	drugs	consumable	Strips	Each	1	5	0	559	1459	5	466	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.009139	2026-03-30 11:02:50.009139	1
77bc21d7-1535-4720-be2c-47fb4419f9fb	1	PARA960	plavix	\N	drugs	consumable	strips	Each	1	0	0	560	1460	10	467	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.021288	2026-03-30 11:02:50.021288	1
14192fb3-b7aa-4315-b602-cecb69897e96	1	PARA961	polyderm	\N	drugs	consumable	Tubes	Each	1	1	0	561	1461	3	468	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.027158	2026-03-30 11:02:50.027158	1
794389c3-e9e6-4491-a7bf-5694c19c2909	1	PARA962	polygel	\N	drugs	consumable	Bott	Each	1	0	0	562	1462	20	469	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.038434	2026-03-30 11:02:50.038434	1
c8e2fa32-cbfd-44db-8164-d29c389182f7	1	PARA963	ponpon	\N	drugs	consumable	piece	Each	1	0	0	563	1463	10	470	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.042586	2026-03-30 11:02:50.042586	1
59072252-117f-4ed3-b837-af2323bc335a	1	PARA964	postinor 2	\N	drugs	consumable	strips	Each	1	8	0	564	1464	5	471	weighted_average	14000.0000	14000.0000	28000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.045643	2026-03-30 11:02:50.045643	1
710ccb9f-6bd4-4760-bd6c-2a86d947202d	1	PARA965	potassium	\N	drugs	consumable	ampules	Each	1	0	0	565	1465	10	472	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.056856	2026-03-30 11:02:50.056856	1
0bd0c60d-e0a6-44f1-a798-498b36f5d9f1	1	PARA966	predleb	\N	drugs	consumable	bott	Each	1	0	0	566	1466	10	473	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.058824	2026-03-30 11:02:50.058824	1
9a9715a5-d900-4e4c-81f9-ce3f8ac6d04a	1	PARA967	predni	\N	drugs	consumable	bott	Each	1	0	0	567	1467	10	474	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.060763	2026-03-30 11:02:50.060763	1
e4d444ad-cafd-40c3-b98a-a2dfc1d92ca8	1	PARA968	prednisolone 20mg	\N	drugs	consumable	Strips	Each	1	4	0	568	1468	5	475	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.065618	2026-03-30 11:02:50.065618	1
133793a7-3c70-40cf-8ec3-62d7eb6a5b97	1	PARA969	prednisolone 5mg	\N	drugs	consumable	Strips	Each	1	37	0	569	1469	5	476	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.072722	2026-03-30 11:02:50.072722	1
cea51ea5-b2dd-4224-b0c9-2aad045fa0ce	1	PARA970	pregab	\N	drugs	consumable	Strips	Each	1	14	0	570	1470	5	477	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.086139	2026-03-30 11:02:50.086139	1
6fc6d790-0a6f-4ffb-a694-88e95cafd946	1	PARA971	pregab plus	\N	drugs	consumable	Strips	Each	1	8	0	571	1471	5	478	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.092825	2026-03-30 11:02:50.092825	1
243256c6-366e-4e1e-80b2-a1ce14975ce7	1	PARA972	pregablin 75	\N	drugs	consumable	Strips	Each	1	33	0	572	1472	5	479	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.102365	2026-03-30 11:02:50.102365	1
3a31cafe-5056-4249-8907-1d5ef2fd15c5	1	PARA973	pregnacare conception	\N	drugs	consumable	Strips	Each	1	4	0	573	1473	5	480	weighted_average	31500.0000	31500.0000	63000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.111707	2026-03-30 11:02:50.111707	1
87c95cbb-82f9-4f4c-aa53-5f976caadca9	1	PARA974	pregnacare original	\N	drugs	consumable	Strips	Each	1	10	0	574	1474	10	481	weighted_average	32500.0000	32500.0000	65000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.123499	2026-03-30 11:02:50.123499	1
9c198f1b-369e-4272-a149-578e444fb001	1	PARA975	pregnavox	\N	drugs	consumable	pkt	Each	1	0	0	575	1475	10	482	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.129483	2026-03-30 11:02:50.129483	1
56f80473-e888-404c-82b2-c0bbbe4c8070	1	PARA976	prisoline 15ml	\N	drugs	consumable	Drops	Each	1	5	0	576	1476	5	483	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.132734	2026-03-30 11:02:50.132734	1
473376e6-c460-4619-8ded-0fcb34392422	1	PARA977	probeta- N	\N	drugs	consumable	Drops	Each	1	10	0	577	1477	20	484	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.140808	2026-03-30 11:02:50.140808	1
42a39322-919a-4d75-b97d-328247a28d34	1	PARA978	propycil	\N	drugs	consumable	Strips	Each	1	22	0	578	1478	10	485	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.144968	2026-03-30 11:02:50.144968	1
7d4273bc-6572-4c72-a29b-67a7f8f0ce0d	1	PARA979	providone iodine	\N	drugs	consumable	Bott	Each	1	6	0	579	1479	20	486	weighted_average	0.0000	0.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.153437	2026-03-30 11:02:50.153437	1
f5ae62d2-4c49-416a-a09f-f7c6935363fe	1	PARA980	quinext	\N	drugs	consumable	strips	Each	1	3	0	580	1480	20	487	weighted_average	0.0000	0.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.170439	2026-03-30 11:02:50.170439	1
2130ced6-60ca-4169-9b21-16752817fd7b	1	PARA981	Quinine	\N	drugs	consumable	Ampoules	Each	1	28	0	581	1481	5	488	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.17991	2026-03-30 11:02:50.17991	1
87740592-8895-46cf-9e0e-c950a757f2d9	1	PARA982	rabz-D	\N	drugs	consumable	Strips	Each	1	7	0	582	1482	5	489	weighted_average	11000.0000	11000.0000	22000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.190917	2026-03-30 11:02:50.190917	1
d9a0f2c3-aa22-4fb6-9ebe-7966fc3af499	1	PARA983	redepra	\N	drugs	consumable	strips	Each	1	0	0	583	1483	10	490	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.200324	2026-03-30 11:02:50.200324	1
9a8f1d99-4a55-4c0d-a041-b2609150edbf	1	PARA984	refresh eyes	\N	drugs	consumable	bott	Each	1	0	0	584	1484	10	491	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.207441	2026-03-30 11:02:50.207441	1
9e0b32ae-0bba-44ee-8a1a-621f41aca022	1	PARA985	relcer	\N	drugs	consumable	bottle	Each	1	0	0	585	1485	20	492	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.212388	2026-03-30 11:02:50.212388	1
f8fa305b-31a0-4205-afaa-0b13df72a544	1	PARA986	Releef	\N	drugs	consumable	bott	Each	1	8	0	586	1486	5	493	weighted_average	0.0000	0.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.21813	2026-03-30 11:02:50.21813	1
e5a255fd-8535-483e-a280-e5ddea5f91fa	1	PARA987	remigoline	\N	drugs	consumable	strips	Each	1	0	0	587	1487	10	494	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.226937	2026-03-30 11:02:50.226937	1
2919ad0a-4072-4c20-8fd1-bcf82fd08f19	1	PARA988	rene hand sanitizer	\N	drugs	consumable	bott	Each	1	0	0	588	1488	20	495	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.230141	2026-03-30 11:02:50.230141	1
3abdda69-16fb-4328-bda0-a8dff544045a	1	PARA989	renformin	\N	drugs	consumable	Strips	Each	1	6	0	589	1489	5	496	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.239274	2026-03-30 11:02:50.239274	1
5fce545a-c47c-4e80-97e8-6490b88520f2	1	PARA990	rezenpine	\N	drugs	consumable	strips	Each	1	4	0	590	1490	20	497	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.25286	2026-03-30 11:02:50.25286	1
6d47eff3-bb26-4bdf-b549-a36f72576caa	1	PARA991	Rezepine	\N	drugs	consumable	strips	Each	1	0	0	591	1491	10	498	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.261564	2026-03-30 11:02:50.261564	1
c5e33e80-32ff-4261-ab84-1a31cde282e2	1	PARA992	REZN	\N	drugs	consumable	strips	Each	1	20	0	592	1492	20	499	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.267025	2026-03-30 11:02:50.267025	1
f79fcfaa-b2c9-410c-a39a-bc34f2ff99c7	1	PARA993	ringer lactate	\N	drugs	consumable	Strips	Each	1	17	0	593	1493	10	500	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.276597	2026-03-30 11:02:50.276597	1
51126954-1322-43fb-98a7-8cb5aa7b9f4b	1	PARA994	Rinovil	\N	drugs	consumable	strips	Each	1	10	0	594	1494	20	501	weighted_average	0.0000	0.0000	3000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.286944	2026-03-30 11:02:50.286944	1
278c3aa0-13c7-45dc-884d-42594e546a6a	1	PARA995	ripane	\N	drugs	consumable	strips	Each	1	0	0	595	1495	10	502	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.294714	2026-03-30 11:02:50.294714	1
f54ece45-1c67-42ff-bf52-9b2151a1c73c	1	PARA996	rivamox	\N	drugs	consumable	strips	Each	1	0	0	596	1496	10	503	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.297248	2026-03-30 11:02:50.297248	1
b2068d01-01ac-46ec-85e7-b0b4aadadbf7	1	PARA997	royal honey	\N	drugs	consumable	sachets	Each	1	0	0	597	1497	10	504	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.301308	2026-03-30 11:02:50.301308	1
05c6a9b4-00eb-47d6-998a-f58746c92b69	1	PARA998	RT-fit	\N	drugs	consumable	strips	Each	1	0	0	598	1498	10	505	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.312779	2026-03-30 11:02:50.312779	1
126ccaa7-aa08-401d-9055-a8673dcf642d	1	PARA999	RTFit	\N	drugs	consumable	strips	Each	1	0	0	599	1499	10	506	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.316491	2026-03-30 11:02:50.316491	1
ecbbdaeb-cdf3-48b4-bf16-8b366f171beb	1	PARA1000	rufenac	\N	drugs	consumable	Strips	Each	1	44	0	600	1500	10	507	weighted_average	0.0000	0.0000	2500.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.324543	2026-03-30 11:02:50.324543	1
3f846d8a-208a-4a57-acdc-97753b245700	1	PARA1001	Ryles Tube	\N	drugs	consumable	Pieces	Each	1	9	0	601	1501	5	508	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.330847	2026-03-30 11:02:50.330847	1
06bc2f11-1834-4906-b705-1bad8d78e967	1	PARA1002	salbutamol	\N	drugs	consumable	Bott	Each	1	0	0	602	1502	20	509	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.339101	2026-03-30 11:02:50.339101	1
ef460b41-9cd1-4a76-a851-7d7a9d8a9dd5	1	PARA1003	salbutamol inhaler	\N	drugs	consumable	Bottles	Each	1	12	0	603	1503	5	510	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.341428	2026-03-30 11:02:50.341428	1
b9b44028-1d5d-4ad9-afb3-294a0d892b23	1	PARA1004	Salibet	\N	drugs	consumable	Tubes	Each	1	3	0	604	1504	3	511	weighted_average	25000.0000	25000.0000	50000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.350144	2026-03-30 11:02:50.350144	1
1b2d5282-f91d-4438-a734-14515ea7d2e4	1	PARA1005	saline	\N	drugs	consumable	bottle	Each	1	0	0	605	1505	10	512	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.358675	2026-03-30 11:02:50.358675	1
6876e13d-99fe-40e6-9087-b9c281afa4a0	1	PARA1006	sandoz	\N	drugs	consumable	strips	Each	1	0	0	606	1506	10	513	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.362345	2026-03-30 11:02:50.362345	1
0c3b71d5-3e9b-418a-9c1d-e0e3731b89bc	1	PARA1007	saray 1l	\N	drugs	consumable	bott	Each	1	0	0	607	1507	20	514	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.365474	2026-03-30 11:02:50.365474	1
995e24c6-2bf4-48b8-acc3-d1d3007ca73a	1	PARA1008	scofix	\N	drugs	consumable	bottle	Each	1	0	0	608	1508	10	515	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.367154	2026-03-30 11:02:50.367154	1
3a9826ec-5320-451e-b852-dc9d6ee826dc	1	PARA1009	sediproct	\N	drugs	consumable	tube	Each	1	0	0	609	1509	10	516	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.370532	2026-03-30 11:02:50.370532	1
83cec4e1-fda1-4c22-a6d4-357a74789bbe	1	PARA1010	sefal fort	\N	drugs	consumable	Strips	Each	1	8	0	610	1510	10	517	weighted_average	25000.0000	25000.0000	50000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.374362	2026-03-30 11:02:50.374362	1
c3fd73ba-8a56-44f7-bfb4-e98a2b22b56c	1	PARA1011	shal'atem	\N	drugs	consumable	strips	Each	1	0	0	611	1511	20	518	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.381001	2026-03-30 11:02:50.381001	1
5da48679-d681-4536-93ed-778f6c2c7c1b	1	PARA1012	shal'atem fort	\N	drugs	consumable	strips	Each	1	0	0	612	1512	20	519	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.387347	2026-03-30 11:02:50.387347	1
b724dcae-e987-4897-89a3-df4614d460a0	1	PARA1013	shalcip tz	\N	drugs	consumable	strips	Each	1	0	0	613	1513	20	520	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.39434	2026-03-30 11:02:50.39434	1
4272c11e-0c5a-41e1-bcc9-9d9a86f7e08a	1	PARA1014	shaldex	\N	drugs	consumable	Bott	Each	1	14	0	614	1514	20	521	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.396979	2026-03-30 11:02:50.396979	1
7fea9a2a-0ff4-42fd-9217-7269b6bb1846	1	PARA1015	shalflox	\N	drugs	consumable	strips	Each	1	16	0	615	1515	20	522	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.406503	2026-03-30 11:02:50.406503	1
81e104f6-8c3a-4f17-a98a-d57483cbf679	1	PARA1016	shalspirin	\N	drugs	consumable	strips	Each	1	0	0	616	1516	20	523	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.41526	2026-03-30 11:02:50.41526	1
80a8eb8a-27f1-4707-b639-0f55ac6c81dc	1	PARA1017	shalspirin cv	\N	drugs	consumable	Strips	Each	1	67	0	617	1517	20	524	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.417951	2026-03-30 11:02:50.417951	1
01c5f024-6745-4c84-8584-536a866d9fe6	1	PARA1018	shaltoux	\N	drugs	consumable	bott	Each	1	8	0	618	1518	20	525	weighted_average	0.0000	0.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.42577	2026-03-30 11:02:50.42577	1
61ab5731-b7ef-458f-9d45-ccb7739ed51c	1	PARA1019	sinopryl 10mg	\N	drugs	consumable	strips	Each	1	0	0	619	1519	10	526	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.429665	2026-03-30 11:02:50.429665	1
0558a76a-4ec8-4f3f-833f-1b7514e84f13	1	PARA1020	sinopryl 20mg	\N	drugs	consumable	strips	Each	1	0	0	620	1520	10	527	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.431895	2026-03-30 11:02:50.431895	1
d71ac6f7-d74d-40eb-aa04-5f5826d95195	1	PARA1021	sinopryl 5mg	\N	drugs	consumable	strips	Each	1	0	0	621	1521	10	528	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.435799	2026-03-30 11:02:50.435799	1
1e9ee659-a819-435b-8e10-1afcdd8684ae	1	PARA1022	sk derm 15mg	\N	drugs	consumable	Tubes	Each	1	5	0	622	1522	5	529	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.439437	2026-03-30 11:02:50.439437	1
6299a1db-088a-407d-abb1-a33cce75dedd	1	PARA1023	sk derm 30mg	\N	drugs	consumable	Tubes	Each	1	9	0	623	1523	5	530	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.444354	2026-03-30 11:02:50.444354	1
0576da5c-d3d6-4f49-9411-b32f8654b3f5	1	PARA1024	soffrim	\N	drugs	consumable	tube	Each	1	0	0	624	1524	10	531	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.452847	2026-03-30 11:02:50.452847	1
afdbc5ea-8599-4db8-9067-f2ede51a0390	1	PARA1025	sonident	\N	drugs	consumable	Tubes	Each	1	3	0	625	1525	3	532	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.455353	2026-03-30 11:02:50.455353	1
c2946cef-4c3b-45a2-997e-0d54353e73d7	1	PARA1026	soniquine	\N	drugs	consumable	Bottles	Each	1	16	0	626	1526	5	533	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.458538	2026-03-30 11:02:50.458538	1
5e714568-c135-4ee5-b60b-ab0601f61c1d	1	PARA1027	spasmodigestion	\N	drugs	consumable	strips	Each	1	0	0	627	1527	10	534	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.465707	2026-03-30 11:02:50.465707	1
0640168c-9e6c-4111-ac5b-d2c7e6e0788b	1	PARA1028	spirolon	\N	drugs	consumable	strips	Each	1	0	0	628	1528	10	535	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.470049	2026-03-30 11:02:50.470049	1
92fb5deb-7aa9-4b24-b15d-15a7543a782c	1	PARA1029	squam	\N	drugs	consumable	Bottles	Each	1	17	0	629	1529	5	536	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.472488	2026-03-30 11:02:50.472488	1
4c8be8ee-ef9c-404e-a996-19f086e4153c	1	PARA1030	steri	\N	drugs	consumable	10	Each	1	0	0	630	1530	0	537	weighted_average	2026.0000	2026.0000	3250.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.475457	2026-03-30 11:02:50.475457	1
ccc63556-ca3c-4270-868e-439cb074e306	1	PARA1031	stopdol	\N	drugs	consumable	Sachets	Each	1	14	0	631	1531	10	538	weighted_average	3000.0000	3000.0000	6000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.476794	2026-03-30 11:02:50.476794	1
e18da44f-c42a-4b73-ad4d-349ee56b95cd	1	PARA1032	Streptomycin Sulfate	\N	drugs	consumable	Vials	Each	1	11	0	632	1532	15	539	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.479322	2026-03-30 11:02:50.479322	1
927b1baf-8f2e-4d2d-8622-f4ed8a9ea407	1	PARA1033	suger free	\N	drugs	consumable	pkt	Each	1	0	0	633	1533	10	540	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.491464	2026-03-30 11:02:50.491464	1
b3fa89a1-4e46-4995-8aed-3133c620bd7f	1	PARA1034	sulfatrim fort	\N	drugs	consumable	strips	Each	1	3	0	634	1534	20	541	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.493894	2026-03-30 11:02:50.493894	1
1ee17a71-241c-4e17-9da0-e25a2a2fa492	1	PARA1035	sunat 30	\N	drugs	consumable	Vials	Each	1	9	0	635	1535	5	542	weighted_average	3500.0000	3500.0000	6125.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.497657	2026-03-30 11:02:50.497657	1
375ac87d-81d9-41e1-87d7-183898e0ab16	1	PARA1036	Sunpecia-5	\N	drugs	consumable	strips	Each	1	0	0	636	1536	10	543	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.501462	2026-03-30 11:02:50.501462	1
19cbd550-3879-4665-9dd0-28ece8c66526	1	PARA1037	super apeti	\N	drugs	consumable	Strips	Each	1	9	0	637	1537	6	544	weighted_average	1000.0000	1000.0000	2000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.504292	2026-03-30 11:02:50.504292	1
68e27ec8-8b1b-4105-a37f-93efb2a4fd1e	1	PARA1038	syringe 2ml	\N	drugs	consumable	Tablets	Each	1	0	0	638	1538	20	545	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.507695	2026-03-30 11:02:50.507695	1
b479bf8e-04c3-4f13-ad5f-35ff595038cd	1	PARA1039	tamoxifem 10mg	\N	drugs	consumable	Strips	Each	1	8	0	639	1539	5	546	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.509257	2026-03-30 11:02:50.509257	1
e8fdde05-107d-41e0-ae21-e59eec1bd7eb	1	PARA1040	tamoxifem 20mg	\N	drugs	consumable	Strips	Each	1	4	0	640	1540	5	547	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.512714	2026-03-30 11:02:50.512714	1
18596fd5-0844-4ced-84da-dd52227a3112	1	PARA1041	tamsulin	\N	drugs	consumable	strips	Each	1	0	0	641	1541	10	548	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.515495	2026-03-30 11:02:50.515495	1
93a2a0c7-b845-4ee2-a1be-1e31855c3815	1	PARA1042	Tamzed	\N	drugs	consumable	strips	Each	1	0	0	642	1542	10	549	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.517492	2026-03-30 11:02:50.517492	1
77e05cd8-a9e2-4680-948e-ad71b474a7fe	1	PARA1043	Tamzed Duo	\N	drugs	consumable	strips	Each	1	0	0	643	1543	10	550	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.519868	2026-03-30 11:02:50.519868	1
6f59b564-57f4-4d61-b00e-2120fd072f00	1	PARA1044	tanzol	\N	drugs	consumable	bott	Each	1	25	0	644	1544	10	551	weighted_average	0.0000	0.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.521521	2026-03-30 11:02:50.521521	1
b8d70560-55b0-4825-a8e9-64a51f40ae9b	1	PARA1045	tegretol	\N	drugs	consumable	Strips	Each	1	4	0	645	1545	5	552	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.524387	2026-03-30 11:02:50.524387	1
34bed99b-9761-4ed3-bf73-6bcf334d6649	1	PARA1046	Tegretol CR	\N	drugs	consumable	Strips	Each	1	8	0	646	1546	5	553	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.527402	2026-03-30 11:02:50.527402	1
b18c3972-46bd-4fd9-898a-14b8b5dbb3ad	1	PARA1047	tenofovir	\N	drugs	consumable	Packs	Each	1	5	0	647	1547	2	554	weighted_average	50000.0000	50000.0000	100000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.530741	2026-03-30 11:02:50.530741	1
48f92fdb-8c13-436c-aa98-01bef28c7c92	1	PARA1048	terbin 1%	\N	drugs	consumable	Tubes	Each	1	8	0	648	1548	10	555	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.533941	2026-03-30 11:02:50.533941	1
6be28839-4c95-40d5-b6c9-616ff7d4bc3f	1	PARA1049	Terbin 250mg	\N	drugs	consumable	Strips	Each	1	7	0	649	1549	3	556	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.537688	2026-03-30 11:02:50.537688	1
b499e6d4-9fbf-4e5f-a7ac-346a74480296	1	PARA1050	tetra-250	\N	drugs	consumable	Strips	Each	1	21	0	650	1550	10	557	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.540037	2026-03-30 11:02:50.540037	1
fe9eea0f-958d-430c-a17a-affbe5a8ee1b	1	PARA1051	tetracycline	\N	drugs	consumable	Tubes	Each	1	8	0	651	1551	5	558	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.54356	2026-03-30 11:02:50.54356	1
6659fa81-b7df-4d2e-9a27-8e902b3b6751	1	PARA1052	tfine	\N	drugs	consumable	Tubes	Each	1	5	0	652	1552	3	559	weighted_average	12500.0000	12500.0000	25000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.546123	2026-03-30 11:02:50.546123	1
7994abbe-c630-4553-8dba-931c80d96ac9	1	PARA1053	thiazone	\N	drugs	consumable	strip	Each	1	0	0	653	1553	10	560	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.54847	2026-03-30 11:02:50.54847	1
0f29c66a-a179-4092-a3bf-09e739b991e8	1	PARA1054	thirgecef	\N	drugs	consumable	Bottles	Each	1	9	0	654	1554	5	561	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.549693	2026-03-30 11:02:50.549693	1
be33fbcc-8e30-4f04-b079-801616410a0d	1	PARA1055	thyromazol	\N	drugs	consumable	Strips	Each	1	15	0	655	1555	5	562	weighted_average	37500.0000	37500.0000	75000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.552218	2026-03-30 11:02:50.552218	1
13dccd6e-2192-433e-b625-f5aec6c2a821	1	PARA1056	ticanase	\N	drugs	consumable	Bottles	Each	1	5	0	656	1556	10	563	weighted_average	28000.0000	28000.0000	56000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.555879	2026-03-30 11:02:50.555879	1
a996c396-fb3a-4d22-bb44-2bf1d07bc2af	1	PARA1057	tinidazole	\N	drugs	consumable	Strips	Each	1	24	0	657	1557	4	564	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.558783	2026-03-30 11:02:50.558783	1
def045f5-f9ee-4aec-bc88-7731755f806a	1	PARA1058	tinizol	\N	drugs	consumable	strips	Each	1	9	0	658	1558	20	565	weighted_average	0.0000	0.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.561075	2026-03-30 11:02:50.561075	1
4fca8095-371d-49db-9466-76664169f058	1	PARA1059	Tramadol	\N	drugs	consumable	Ampoules	Each	1	22	0	659	1559	10	566	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.564475	2026-03-30 11:02:50.564475	1
e807104e-ba10-45e6-8b80-ff675c3dcdeb	1	PARA1060	trant 500mg	\N	drugs	consumable	amp	Each	1	0	0	660	1560	10	567	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.569004	2026-03-30 11:02:50.569004	1
665df1a2-2d23-45bd-a906-ce6d5f0402a0	1	PARA1061	trantum	\N	drugs	consumable	strips	Each	1	0	0	661	1561	10	568	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.571616	2026-03-30 11:02:50.571616	1
5e8c2c52-ed81-4aa1-b487-5aec888e16ca	1	PARA1062	triofen	\N	drugs	consumable	bott	Each	1	0	0	662	1562	10	569	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.573539	2026-03-30 11:02:50.573539	1
8f18da8b-3c83-49e6-b50e-f7b5d35ce5e8	1	PARA1063	udimox	\N	drugs	consumable	strips	Each	1	0	0	663	1563	10	570	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.574868	2026-03-30 11:02:50.574868	1
2f2b1fe5-2e60-4860-8631-96842b3ed0a5	1	PARA1064	uniclavix	\N	drugs	consumable	Strips	Each	1	23	0	664	1564	5	571	weighted_average	6000.0000	6000.0000	12000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.57587	2026-03-30 11:02:50.57587	1
9a9721f1-4160-4cc6-94d3-beae944d5a74	1	PARA1065	unidipine	\N	drugs	consumable	strips	Each	1	0	0	665	1565	10	572	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.578028	2026-03-30 11:02:50.578028	1
c3732ab6-cb68-4582-b09f-4e780377ebf4	1	PARA1066	uniphage 500mg	\N	drugs	consumable	strips	Each	1	0	0	666	1566	10	573	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.579265	2026-03-30 11:02:50.579265	1
4d1573a7-c1c3-4438-a2b4-413ad1fd1d8b	1	PARA1067	uniphage 850mg	\N	drugs	consumable	strips	Each	1	17	0	667	1567	10	574	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.582594	2026-03-30 11:02:50.582594	1
c50d639f-0a63-400e-8642-eb0e8395fe56	1	PARA1068	unitan	\N	drugs	consumable	strips	Each	1	0	0	668	1568	10	575	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.589927	2026-03-30 11:02:50.589927	1
7246d760-f35b-416a-8b4a-902882dc2c66	1	PARA1069	unitan 50	\N	drugs	consumable	strips	Each	1	135	0	669	1569	10	576	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.591559	2026-03-30 11:02:50.591559	1
383fd0ff-cf56-44e6-a3f9-17694e65da19	1	PARA1070	uricol	\N	drugs	consumable	pkt	Each	1	3	0	670	1570	10	577	weighted_average	3500.0000	3500.0000	7000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.596479	2026-03-30 11:02:50.596479	1
b0a8ac90-8e3a-413e-8503-a8a3e96119d5	1	PARA1071	urine catheter 18	\N	drugs	consumable	Pieces	Each	1	44	0	671	1571	10	578	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.605378	2026-03-30 11:02:50.605378	1
83eacbce-f0ab-4968-9e8d-f1df167c05ac	1	PARA1072	urine catheter 20	\N	drugs	consumable	Packs	Each	1	47	0	672	1572	10	579	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.61361	2026-03-30 11:02:50.61361	1
a64f6e1c-e28e-4e2d-b908-0ebda4dc4137	1	PARA1073	urinex	\N	drugs	consumable	Strips	Each	1	4	0	673	1573	10	580	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.619723	2026-03-30 11:02:50.619723	1
9d9e9deb-18ae-4948-a7c5-70ff9987dfa2	1	PARA1074	uroday	\N	drugs	consumable	strips	Each	1	5	0	674	1574	10	581	weighted_average	20000.0000	20000.0000	40000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.622797	2026-03-30 11:02:50.622797	1
44db1d9a-ddba-40ad-8636-0c3fcd3943fa	1	PARA1075	utim 0.5	\N	drugs	consumable	bott	Each	1	0	0	675	1575	20	582	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.627399	2026-03-30 11:02:50.627399	1
c8cfccbe-17ef-470f-a089-377279104d08	1	PARA1076	V2 plus	\N	drugs	consumable	strips	Each	1	0	0	676	1576	10	583	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.631385	2026-03-30 11:02:50.631385	1
29fa62bc-c552-423c-8b9c-aec2d52d7d8b	1	PARA1077	valgestril	\N	drugs	consumable	strips	Each	1	0	0	677	1577	10	584	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.634029	2026-03-30 11:02:50.634029	1
fc087375-d408-4e4d-9f9f-f229cdac1a49	1	PARA1078	velpitaz	\N	drugs	consumable	vial	Each	1	0	0	678	1578	20	585	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.641344	2026-03-30 11:02:50.641344	1
565a34f5-7f86-48dc-a74f-d5da83ad97b5	1	PARA1079	ventolin 2.5/2.5ml	\N	drugs	consumable	Bottles	Each	1	30	0	679	1579	10	586	weighted_average	4000.0000	4000.0000	8000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.644252	2026-03-30 11:02:50.644252	1
921006e3-9835-4ab9-86d0-782feedd66de	1	PARA1080	vintem ds	\N	drugs	consumable	Strips	Each	1	0	0	680	1580	20	587	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.648194	2026-03-30 11:02:50.648194	1
70e779c2-6fd4-4b00-af12-ee283c2e769c	1	PARA1081	vitacee	\N	drugs	consumable	strips	Each	1	0	0	681	1581	20	588	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.653032	2026-03-30 11:02:50.653032	1
4ab3b288-4817-43d5-954b-487270297b7c	1	PARA1082	Vitamin B complex	\N	drugs	consumable	Ampoules	Each	1	20	0	682	1582	10	589	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.655833	2026-03-30 11:02:50.655833	1
6ad68105-b9d0-4c09-8795-845117cc3e8c	1	PARA1083	Vitamin E	\N	drugs	consumable	strips	Each	1	0	0	683	1583	10	590	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.658514	2026-03-30 11:02:50.658514	1
2a8bc2af-aad0-4aae-9ac1-75ed934e6694	1	PARA1084	Vitamin K1	\N	drugs	consumable	Ampoules	Each	1	10	0	684	1584	5	591	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.660787	2026-03-30 11:02:50.660787	1
75e30cb0-6b7c-4b07-948a-6c7940f7f59b	1	PARA1085	Vomset	\N	drugs	consumable	Strips	Each	1	29	0	685	1585	10	592	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.664812	2026-03-30 11:02:50.664812	1
b4499525-0bfb-4e0a-8875-9bbb4c2f650a	1	PARA1086	VOMSETON	\N	drugs	consumable	Ampoules	Each	1	7	0	686	1586	2	593	weighted_average	5000.0000	5000.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.668516	2026-03-30 11:02:50.668516	1
b8835c7c-e797-4727-b6ec-47f9e6ba4aad	1	PARA1087	VoXflora	\N	drugs	consumable	strips	Each	1	0	0	687	1587	10	594	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.673075	2026-03-30 11:02:50.673075	1
8d7d0787-74ad-4261-b8ab-917840a923a4	1	PARA1088	voxvision	\N	drugs	consumable	Strips	Each	1	3	0	688	1588	3	595	weighted_average	9000.0000	9000.0000	18000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.674491	2026-03-30 11:02:50.674491	1
08bbf7b9-40ee-4d6b-83f0-1eba1b1d4ce6	1	PARA1089	wax out	\N	drugs	consumable	bottle	Each	1	0	0	689	1589	10	596	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.678116	2026-03-30 11:02:50.678116	1
4cc465d1-33fe-4927-a89c-1ba2dea0fd4c	1	PARA1090	Wellman Conception	\N	drugs	consumable	Strips	Each	1	8	0	690	1590	5	597	weighted_average	23000.0000	23000.0000	46000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.680521	2026-03-30 11:02:50.680521	1
f6abe5b2-d0fd-4617-ba77-ea04412bf827	1	PARA1091	Wellman Origin	\N	drugs	consumable	Strips	Each	1	0	0	691	1591	10	598	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.686362	2026-03-30 11:02:50.686362	1
ecbd01e7-8277-4dcc-bce9-674ca8b3dbed	1	PARA1092	whippers	\N	drugs	consumable	Tablets	Each	1	0	0	692	1592	10	599	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.688437	2026-03-30 11:02:50.688437	1
a96e322f-832f-41b6-b59c-e491272f9f29	1	PARA1093	wormex	\N	drugs	consumable	Bott	Each	1	22	0	693	1593	20	600	weighted_average	0.0000	0.0000	10000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.690693	2026-03-30 11:02:50.690693	1
21235db6-9ff4-4f66-b329-5b68ee54d9f3	1	PARA1094	wormex 500	\N	drugs	consumable	strips	Each	1	16	0	694	1594	5	601	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.700946	2026-03-30 11:02:50.700946	1
28067f78-0dc5-4c2d-a445-cd13fc893933	1	PARA1095	Xanthibux	\N	drugs	consumable	Strips	Each	1	12	0	695	1595	10	602	weighted_average	8000.0000	8000.0000	16000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.718605	2026-03-30 11:02:50.718605	1
24b03976-d78c-471b-aee5-4600710b9f40	1	PARA1096	xerelto 10	\N	drugs	consumable	strips	Each	1	0	0	696	1596	10	603	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.729688	2026-03-30 11:02:50.729688	1
92cb7d70-12e7-4fcf-b8fe-37a9666eb20b	1	PARA1097	xerelto 15	\N	drugs	consumable	strips	Each	1	0	0	697	1597	10	604	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.744224	2026-03-30 11:02:50.744224	1
db85bddd-6758-47e0-824d-e4fc25c35535	1	PARA1098	xerelto 20	\N	drugs	consumable	strips	Each	1	0	0	698	1598	10	605	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.751584	2026-03-30 11:02:50.751584	1
8cefdc04-4200-496d-a04c-22e0e2745f48	1	PARA1099	xilone	\N	drugs	consumable	bottle	Each	1	0	0	699	1599	10	606	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.756116	2026-03-30 11:02:50.756116	1
80c3b0ce-f51b-4a03-a0d2-810d73e11ea8	1	PARA1100	xydone	\N	drugs	consumable	Bottles	Each	1	0	0	700	1600	5	607	weighted_average	23000.0000	23000.0000	46000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.759535	2026-03-30 11:02:50.759535	1
e9fff166-d962-448d-9166-86784e613eaa	1	PARA1101	yenixine	\N	drugs	consumable	bottle	Each	1	0	0	701	1601	10	608	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.763743	2026-03-30 11:02:50.763743	1
4b93ac47-a5fa-4501-9ee6-4ff509b89282	1	PARA1102	z-oflox	\N	drugs	consumable	Strips	Each	1	15	0	702	1602	5	609	weighted_average	17500.0000	17500.0000	35000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.770771	2026-03-30 11:02:50.770771	1
6b0b749c-da9d-469a-ae17-d997fdc548e9	1	PARA1103	zebatin	\N	drugs	consumable	Strips	Each	1	3	0	703	1603	3	610	weighted_average	75000.0000	75000.0000	150000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.779059	2026-03-30 11:02:50.779059	1
d43006fa-6a89-43fb-9f79-84ecc5319df5	1	PARA1104	zecuf	\N	drugs	consumable	Bott	Each	1	4	0	704	1604	20	611	weighted_average	0.0000	0.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.791347	2026-03-30 11:02:50.791347	1
c66e4331-29a8-4bd6-bd41-43bbc0ea9b01	1	PARA1105	Zecuf Lozenges	\N	drugs	consumable	Strips	Each	1	82	0	705	1605	10	612	weighted_average	2000.0000	2000.0000	4000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.795983	2026-03-30 11:02:50.795983	1
ff5f72ea-88ab-44d2-97bd-a6890028e65e	1	PARA1106	zecuf syrup 100ml	\N	drugs	consumable	Bottles	Each	1	11	0	706	1606	3	613	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.804009	2026-03-30 11:02:50.804009	1
321c8758-0ff3-4fc2-ad12-9bbff71c162d	1	PARA1107	zhevair	\N	drugs	consumable	strips	Each	1	0	0	707	1607	10	614	weighted_average	0.0000	0.0000	0.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.811222	2026-03-30 11:02:50.811222	1
c770230f-e6a8-44e5-bd45-a08c6c50adee	1	PARA1108	Zinc Sulfate	\N	drugs	consumable	strips	Each	1	22	0	708	1608	10	615	weighted_average	2500.0000	2500.0000	5000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.816758	2026-03-30 11:02:50.816758	1
78b269c9-f0ed-45cb-8de2-70a8399e6b6e	1	PARA1109	zincoheal cream	\N	drugs	consumable	Tubes	Each	1	2	0	709	1609	3	616	weighted_average	15000.0000	15000.0000	30000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.826678	2026-03-30 11:02:50.826678	1
7b21c803-a5f0-4c99-8a3e-4d2ca3dff91d	1	PARA1110	zincomist	\N	drugs	consumable	Bottles	Each	1	15	0	710	1610	5	617	weighted_average	23000.0000	23000.0000	46000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.833042	2026-03-30 11:02:50.833042	1
0e1f2a5e-4f78-48e8-801c-f2fd56b1e8fd	1	PARA1111	zofen	\N	drugs	consumable	tube	Each	1	9	0	711	1611	10	618	weighted_average	7500.0000	7500.0000	15000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.843641	2026-03-30 11:02:50.843641	1
71d3854e-0200-43da-8dfe-90c4e8ec803c	1	PARA1112	zofen gel	\N	drugs	consumable	tube	Each	1	1	0	712	1612	5	619	weighted_average	10000.0000	10000.0000	20000.0000	SSP	\N	\N	\N	t	t	f	f	t	\N	\N	\N	\N	\N	2026-03-30 11:02:50.852873	2026-03-30 11:02:50.852873	1
\.


--
-- Data for Name: inventory_reservations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_reservations (id, clinic_id, item_id, location_id, reservation_type, quantity_reserved, reserve_date, required_date, reference_id, reference_type, status, fulfilled_date, reserved_by, created_at) FROM stdin;
\.


--
-- Data for Name: inventory_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_settings (id, clinic_id, default_valuation_method, auto_create_po_at_min_stock, min_stock_alert_threshold, warn_expiry_days, auto_flag_expired, require_batch_entry_for_all, auto_post_cogs_monthly, cogs_posting_day, track_by_location, default_location_id, inventory_account_id, cogs_account_id, usage_account_id, adjustment_account_id, allow_negative_stock, require_approval_for_adjustments_above, updated_at) FROM stdin;
\.


--
-- Data for Name: inventory_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type, quantity_change, from_location_id, to_location_id, batch_id, unit_cost, total_cost, cost_currency, exchange_rate, gl_entry_id, gl_entry_created, gl_entry_posted, reference_type, reference_id, transaction_date, transaction_time, notes, approval_required, approved_by, approval_date, created_by, created_at, branch_id) FROM stdin;
420b66f3-ff3b-4f83-aa7b-93628227e59b	1	TXN-GRN-20260327-0001	42d42a1d-1011-4ad0-b61e-01e55f661457	receipt	10	\N	\N	9b419798-df93-44f8-8dee-0b0d95572098	0.0000	0.00	SSP	1.000000	\N	f	f	grn	45da11d0-6865-4bc4-9475-5ce0d30fa468	2026-03-27	\N	GRN GRN-2026-0001 accepted	f	\N	\N	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-27 12:36:31.915353	\N
9f2743c9-e9a1-422d-86c3-13be5b8e61b8	1	TXN-DISP-DISP-202603-0001	fb4df775-f305-42f7-873b-f4ee63b6cf9c	dispense	-20	\N	\N	e8d15a22-6ffc-4a5f-927d-ea3b9b5a18a7	0.0000	0.00	SSP	1.000000	\N	f	f	dispensing	DISP-202603-0001	2026-03-30	\N	Dispensed to patient	f	\N	\N	\N	2026-03-30 10:41:50.67825	\N
f90d64c2-5ab0-480c-b950-0c8ebde82962	1	TXN-DISP-DISP-202604-0001	a12ea35b-c54e-4d7c-859f-7016a996812b	dispense	-2	\N	\N	\N	0.0000	0.00	SSP	1.000000	\N	f	f	dispensing	DISP-202604-0001	2026-04-06	\N	Dispensed to patient	f	\N	\N	\N	2026-04-06 16:04:37.308926	\N
26268217-f3e9-408e-8614-5b1db0149f4f	1	TXN-DISP-DISP-202604-0011	9d78ed43-deab-4871-b7a2-3024901cf613	dispense	-2	\N	\N	\N	0.0000	0.00	SSP	1.000000	\N	f	f	dispensing	DISP-202604-0011	2026-04-06	\N	Dispensed to patient	f	\N	\N	\N	2026-04-06 16:04:37.702465	\N
0c58ea6f-ccae-4825-9569-5df7e8266883	1	TXN-DISP-DISP-202604-0021	9d78ed43-deab-4871-b7a2-3024901cf613	dispense	-1	\N	\N	\N	0.0000	0.00	SSP	1.000000	\N	f	f	dispensing	DISP-202604-0021	2026-04-06	\N	Dispensed to patient	f	\N	\N	\N	2026-04-06 16:09:32.473106	\N
a6ea52d1-e5dc-4e82-8a1a-4d8afa72d951	1	TXN-DISP-DISP-202604-0031	2ce2654f-48c7-4dfe-b8d0-1b45d6b1de06	dispense	-1	\N	\N	\N	0.0000	0.00	SSP	1.000000	\N	f	f	dispensing	DISP-202604-0031	2026-04-06	\N	Dispensed to patient	f	\N	\N	\N	2026-04-06 16:09:32.699336	\N
9d0904e6-d3ce-4cc5-b833-65bea0f917c8	1	TXN-DISP-DISP-202604-0041	a12ea35b-c54e-4d7c-859f-7016a996812b	dispense	-1	\N	\N	\N	0.0000	0.00	SSP	1.000000	\N	f	f	dispensing	DISP-202604-0041	2026-04-06	\N	Dispensed to patient	f	\N	\N	\N	2026-04-06 16:11:20.245475	\N
\.


--
-- Data for Name: inventory_valuation; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.inventory_valuation (id, clinic_id, item_id, valuation_date, quantity_on_hand, quantity_reserved, fifo_value, lifo_value, weighted_average_value, selected_method, inventory_value, gl_entry_id, gl_posting_date, created_at) FROM stdin;
\.


--
-- Data for Name: invoice_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.invoice_items (id, invoice_id, service_id, description, quantity, unit_price, amount, currency, created_at) FROM stdin;
2fcbee6f-030c-4c66-8c6e-e5b702a7b4cb	911645b6-04d0-4d3b-91ad-f5f4a0bd6822	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-23 22:14:43.875706
85c984c7-807c-43a8-a6c1-6ad90f4be225	40b49569-69d7-4f4b-a61c-0211dfa098d9	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-24 09:28:28.601369
a5768235-36ec-4938-be9a-b72533fdd7a5	de991b29-bdeb-4833-9c4e-5f62adfa7dc1	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-24 09:42:40.324479
3444d516-602b-4779-a14a-951e4800f2a3	de991b29-bdeb-4833-9c4e-5f62adfa7dc1	0b9d5901-aff4-48cf-8f16-74a0d158ef0e	X-Ray Chest	1	0.00	0.00	SSP	2026-03-24 09:42:40.324479
0918abce-15ad-442e-a28a-f071d0de74f1	de991b29-bdeb-4833-9c4e-5f62adfa7dc1	e25891b7-5e83-4ebc-9d8c-299930df2da9	KNEE JNT  X-Ray	1	0.00	0.00	SSP	2026-03-24 09:42:40.324479
c8c72054-a95d-490d-bcbe-3b7c4cb6647b	de991b29-bdeb-4833-9c4e-5f62adfa7dc1	08dbe734-59aa-4e34-a329-24196599e346	LEG X-Ray	1	0.00	0.00	SSP	2026-03-24 09:42:40.324479
ffdf9f5c-da94-4bd0-9524-944d1c3cba19	f5d3a3e3-362e-43ad-9ead-3df947bdce7c	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-24 09:53:59.91448
093effa7-a581-48ef-9422-2da27187d84d	f5d3a3e3-362e-43ad-9ead-3df947bdce7c	0b9d5901-aff4-48cf-8f16-74a0d158ef0e	X-Ray Chest	1	0.00	0.00	SSP	2026-03-24 09:53:59.91448
15d346c7-c00b-4ab4-a839-7935780e472c	f5d3a3e3-362e-43ad-9ead-3df947bdce7c	e25891b7-5e83-4ebc-9d8c-299930df2da9	KNEE JNT  X-Ray	1	0.00	0.00	SSP	2026-03-24 09:53:59.91448
d93b9641-8d38-476f-8ce8-caa216a3092d	f5d3a3e3-362e-43ad-9ead-3df947bdce7c	08dbe734-59aa-4e34-a329-24196599e346	LEG X-Ray	1	0.00	0.00	SSP	2026-03-24 09:53:59.91448
639e22c0-3be5-4246-ab40-5ac3d7ada108	f5d3a3e3-362e-43ad-9ead-3df947bdce7c	b7ba2fa7-8d91-4815-9555-8518cf42a9d2	Neck X-Ray	1	0.00	0.00	SSP	2026-03-24 09:53:59.91448
e862a2a5-6e46-443d-8304-17f8ca743f38	f5d3a3e3-362e-43ad-9ead-3df947bdce7c	2944adb8-9408-4402-9788-fc90c82a2ce9	Pelvis X-Ray	1	0.00	0.00	SSP	2026-03-24 09:53:59.91448
28edc585-3a76-497b-a438-2d40fe60c721	fb35bd38-6236-4594-a210-158da7071c78	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-24 09:54:22.518564
e9c3f1a9-1d86-4d0d-a8ba-ffbc246d3375	fb35bd38-6236-4594-a210-158da7071c78	0b9d5901-aff4-48cf-8f16-74a0d158ef0e	X-Ray Chest	1	0.00	0.00	SSP	2026-03-24 09:54:22.518564
97d697ad-9148-49d6-95e3-f9c1ddbf14e7	fb35bd38-6236-4594-a210-158da7071c78	2944adb8-9408-4402-9788-fc90c82a2ce9	Pelvis X-Ray	1	0.00	0.00	SSP	2026-03-24 09:54:22.518564
a2131278-db36-4445-8842-cbe0af6493e6	fb35bd38-6236-4594-a210-158da7071c78	ef8e7b72-286d-4882-9c5a-75109aaed40c	Consultaion - Pediatric	1	50000.00	50000.00	SSP	2026-03-24 09:54:22.518564
9f20de9f-d897-42fd-9c47-910c43acbb5f	780c717d-0a5d-44e5-b68f-25e93f0d53e4	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-24 10:00:24.729864
08396706-a82d-4d17-90ac-e7794a14b43d	780c717d-0a5d-44e5-b68f-25e93f0d53e4	0b9d5901-aff4-48cf-8f16-74a0d158ef0e	X-Ray Chest	1	0.00	0.00	SSP	2026-03-24 10:00:24.729864
ac1a6b72-fd3d-4bfe-98b6-e1c5daa7cf9f	780c717d-0a5d-44e5-b68f-25e93f0d53e4	e25891b7-5e83-4ebc-9d8c-299930df2da9	KNEE JNT  X-Ray	1	0.00	0.00	SSP	2026-03-24 10:00:24.729864
c136f87e-b596-4ca3-9aec-fb8b08483722	780c717d-0a5d-44e5-b68f-25e93f0d53e4	08dbe734-59aa-4e34-a329-24196599e346	LEG X-Ray	1	0.00	0.00	SSP	2026-03-24 10:00:24.729864
753e957e-cd01-4f80-9838-b43021de7a1c	780c717d-0a5d-44e5-b68f-25e93f0d53e4	b7ba2fa7-8d91-4815-9555-8518cf42a9d2	Neck X-Ray	1	0.00	0.00	SSP	2026-03-24 10:00:24.729864
92a9a044-bb32-4ebb-907f-1a277c7a91a0	780c717d-0a5d-44e5-b68f-25e93f0d53e4	2944adb8-9408-4402-9788-fc90c82a2ce9	Pelvis X-Ray	1	0.00	0.00	SSP	2026-03-24 10:00:24.729864
1f5840fc-b74b-419f-8b51-53f3b8274cb2	6983217e-84a5-470f-8874-0f5cb700d522	94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	1	20000.00	20000.00	SSP	2026-03-30 16:59:37.205043
00eb6320-1b76-4473-bfe9-4f1da70eb407	4a415c8b-5d61-4982-9193-9124131e3ee3	\N	absorbent gauze sponge	2	4000.00	8000.00	SSP	2026-04-06 16:04:54.910105
5d9e9b45-bad9-454d-8026-b5af9675ebfd	4a415c8b-5d61-4982-9193-9124131e3ee3	\N	abnal	2	10000.00	20000.00	SSP	2026-04-06 16:04:54.910105
\.


--
-- Data for Name: invoice_payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.invoice_payments (id, invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, created_at) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.invoices (id, clinic_id, branch_id, bill_id, patient_id, patient_name, invoice_number, amount, amount_paid, balance_due, currency, payment_terms, due_date, status, notes, created_by, updated_by, created_at, updated_at, scheme_id, scheme_name, exchange_rate, amount_in_base_currency) FROM stdin;
911645b6-04d0-4d3b-91ad-f5f4a0bd6822	1	1	413451c3-c20b-4558-b711-92d398c8a664	fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	Single Dee	INV-2603-0001	20000.00	0.00	20000.00	SSP	30	2026-04-22	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-23 22:14:43.875706	2026-03-23 22:14:43.875706	\N	\N	\N	\N
40b49569-69d7-4f4b-a61c-0211dfa098d9	1	1	c2f7de2e-fadf-43bc-90f7-a7c664f08964	f13d0c29-3fef-494a-9642-2f390835d83f	Narting Abui Joseph	INV-2603-0011	20000.00	0.00	20000.00	SSP	30	2026-04-23	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-24 09:28:28.601369	2026-03-24 09:28:28.601369	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	UNIVERSAL HOSPITAL STAFF	\N	\N
de991b29-bdeb-4833-9c4e-5f62adfa7dc1	1	1	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	80980441-a1c1-483f-8d56-d6ac83732cae	Lil Been	INV-2603-0021	20000.00	0.00	20000.00	SSP	30	2026-04-23	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-24 09:42:40.324479	2026-03-24 09:42:40.324479	\N	\N	\N	\N
f5d3a3e3-362e-43ad-9ead-3df947bdce7c	1	1	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	80980441-a1c1-483f-8d56-d6ac83732cae	Lil Been	INV-2603-0031	20000.00	0.00	20000.00	SSP	30	2026-04-23	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-24 09:53:59.91448	2026-03-24 09:53:59.91448	\N	\N	\N	\N
fb35bd38-6236-4594-a210-158da7071c78	1	1	c2f7de2e-fadf-43bc-90f7-a7c664f08964	f13d0c29-3fef-494a-9642-2f390835d83f	Narting Abui Joseph	INV-2603-0041	70000.00	0.00	70000.00	SSP	30	2026-04-23	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-24 09:54:22.518564	2026-03-24 09:54:22.518564	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	UNIVERSAL HOSPITAL STAFF	\N	\N
780c717d-0a5d-44e5-b68f-25e93f0d53e4	1	1	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	80980441-a1c1-483f-8d56-d6ac83732cae	Lil Been	INV-2603-0051	20000.00	0.00	20000.00	SSP	30	2026-04-23	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-24 10:00:24.729864	2026-03-24 10:00:24.729864	\N	\N	\N	\N
6983217e-84a5-470f-8874-0f5cb700d522	1	1	69125236-c7b5-4aa8-a221-891e07ec2067	d847f88c-e89d-444e-bf03-c15aed4b1d10	Martin Ssebuga	INV-2603-0061	20000.00	0.00	20000.00	SSP	30	2026-04-29	unpaid	\N	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-03-30 16:59:37.205043	2026-03-30 16:59:37.205043	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	UNIVERSAL HOSPITAL STAFF	\N	\N
4a415c8b-5d61-4982-9193-9124131e3ee3	1	1	\N	bbb36bc2-4834-4bfe-9b37-2311f79a716c	John Ohisa	INV-2604-0001	28000.00	0.00	28000.00	SSP	30	2026-05-06	unpaid	Pharmacy Dispensing — DISP-202604-0011	a63c3829-1709-49da-ae07-699d0e52082c	\N	2026-04-06 16:04:54.910105	2026-04-06 16:04:54.910105	\N	\N	\N	\N
\.


--
-- Data for Name: item_pricing_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.item_pricing_history (id, item_id, supplier_id, unit_cost, cost_currency, effective_from, effective_to, source, created_at) FROM stdin;
\.


--
-- Data for Name: journal_entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.journal_entries (id, clinic_id, je_number, entry_date, description, narration, reference, total_debit, total_credit, status, created_by, approved_by, approved_date, posted_by, posted_date, created_at, updated_at, transaction_currency, base_currency, exchange_rate, base_total_debit, base_total_credit) FROM stdin;
736ab11d-0d3e-4a52-beec-56730e8ec17f	1	JE-202603-0001	2026-03-31	Cash Transfer: Cash → Cash	Cash transfer	SHIFT-manual	70000.00	70000.00	posted	system	\N	\N	system	2026-03-31 11:07:09.398	2026-03-31 11:07:09.402	2026-03-31 11:07:09.402	SSP	SSP	1.000000	70000.00	70000.00
de9fd040-72e9-487d-9ed7-3a7868ff3bb7	1	JE-202603-0002	2026-03-31	Cash Transfer: Cash at Hand → Cash at Hand	Cash transfer	SHIFT-manual	50000.00	50000.00	posted	system	\N	\N	system	2026-03-31 11:48:31.952	2026-03-31 11:48:31.956	2026-03-31 11:48:31.956	SSP	SSP	1.000000	50000.00	50000.00
c852b913-09d6-47fe-9054-1253141a9553	1	JE-202604-0001	2026-04-06	Cash Transfer: Cash → Petty Cash	Cash transfer	CT-1	200.00	200.00	posted	system	\N	\N	system	2026-04-06 17:11:46.052	2026-04-06 17:11:46.064	2026-04-06 17:11:46.064	SSP	SSP	1.000000	200.00	200.00
16c40e59-9bdf-437c-91f8-ea74c477a223	1	JE-202604-0002	2026-04-06	Cash Transfer: Accounts Receivable - Patients → Petty Cash	Cash transfer	CT-2	200000.00	200000.00	posted	system	\N	\N	system	2026-04-06 17:17:47.054	2026-04-06 17:17:47.056	2026-04-06 17:17:47.056	SSP	SSP	1.000000	200000.00	200000.00
04a66080-fe4a-4c73-bb97-a3014a4163c6	1	JE-202604-0003	2026-04-06	Payment: Bill b945c6d0-e80f-4d44-b96e-85f2cb456107 (cash)	Receipt RCP-01236119	RCP-582f8b87-8807-4651-b63e-995ea2d2753c	20000.00	20000.00	posted	a63c3829-1709-49da-ae07-699d0e52082c	\N	\N	a63c3829-1709-49da-ae07-699d0e52082c	2026-04-06 18:47:16.145	2026-04-06 18:47:16.149	2026-04-06 18:47:16.149	SSP	SSP	1.000000	20000.00	20000.00
\.


--
-- Data for Name: journal_entry_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.journal_entry_lines (id, je_id, account_id, debit_amount, credit_amount, description, created_at, updated_at, base_debit_amount, base_credit_amount, currency_code, amount_in_currency, exchange_rate) FROM stdin;
bb70299b-b948-4f1f-9c61-eec0571ad134	736ab11d-0d3e-4a52-beec-56730e8ec17f	110c5b3b-8445-46c9-bfbd-b3f2a1207639	70000.00	0.00	Transfer from Cash	2026-03-31 11:07:09.414	2026-03-31 11:07:09.414	70000.00	0.00	\N	\N	\N
a6a945d5-2185-4e85-9a46-19a62f9cbf4b	736ab11d-0d3e-4a52-beec-56730e8ec17f	110c5b3b-8445-46c9-bfbd-b3f2a1207639	0.00	70000.00	Transfer to Cash	2026-03-31 11:07:09.414	2026-03-31 11:07:09.414	0.00	70000.00	\N	\N	\N
6e0b2047-312a-4add-914d-cdfd4eab6918	de9fd040-72e9-487d-9ed7-3a7868ff3bb7	b73ebe93-4804-4972-bf35-bb5da70ffe52	50000.00	0.00	Transfer from Cash at Hand	2026-03-31 11:48:31.97	2026-03-31 11:48:31.97	50000.00	0.00	\N	\N	\N
66bc9332-8416-4d49-b8fb-1e4a27f541c4	de9fd040-72e9-487d-9ed7-3a7868ff3bb7	b73ebe93-4804-4972-bf35-bb5da70ffe52	0.00	50000.00	Transfer to Cash at Hand	2026-03-31 11:48:31.97	2026-03-31 11:48:31.97	0.00	50000.00	\N	\N	\N
d769fa1d-898b-4456-a8ee-970615a42089	c852b913-09d6-47fe-9054-1253141a9553	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	200.00	0.00	Transfer from Cash	2026-04-06 17:11:46.076	2026-04-06 17:11:46.076	200.00	0.00	\N	\N	\N
e58a01bb-7a02-401c-b3fd-27aafb22d680	c852b913-09d6-47fe-9054-1253141a9553	110c5b3b-8445-46c9-bfbd-b3f2a1207639	0.00	200.00	Transfer to Petty Cash	2026-04-06 17:11:46.076	2026-04-06 17:11:46.076	0.00	200.00	\N	\N	\N
f961e19b-8564-4692-a7e9-06f35a65aa06	16c40e59-9bdf-437c-91f8-ea74c477a223	b3d38820-2b7c-4c67-aee7-5cb96130c3b4	200000.00	0.00	Transfer from Accounts Receivable - Patients	2026-04-06 17:17:47.064	2026-04-06 17:17:47.064	200000.00	0.00	\N	\N	\N
54b329a0-75af-4ad1-8d32-60e8fc431d49	16c40e59-9bdf-437c-91f8-ea74c477a223	9eba4107-889c-4c2f-ba38-395f747dafa4	0.00	200000.00	Transfer to Petty Cash	2026-04-06 17:17:47.064	2026-04-06 17:17:47.064	0.00	200000.00	\N	\N	\N
056e65ec-1edc-4214-a2cf-0b2ffbd06ccd	04a66080-fe4a-4c73-bb97-a3014a4163c6	b73ebe93-4804-4972-bf35-bb5da70ffe52	20000.00	0.00	Payment received (cash)	2026-04-06 18:47:16.155	2026-04-06 18:47:16.155	20000.00	0.00	\N	\N	\N
5f398be5-b3ff-4778-aee5-8c62a537c621	04a66080-fe4a-4c73-bb97-a3014a4163c6	9eba4107-889c-4c2f-ba38-395f747dafa4	0.00	20000.00	Revenue from bill b945c6d0-e80f-4d44-b96e-85f2cb456107	2026-04-06 18:47:16.155	2026-04-06 18:47:16.155	0.00	20000.00	\N	\N	\N
\.


--
-- Data for Name: lab_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lab_requests (id, patient_id, patient_name, visit_id, test_name, test_code, requested_by, requested_at, status, clinic_id, priority, notes, branch_id, created_at, updated_at, test_id, sample_collected, sample_collection_date, result_date) FROM stdin;
7c91e785-67ef-4ee5-ac61-7ed96e5d56ca	f13d0c29-3fef-494a-9642-2f390835d83f	\N	c5e724d8-5eaf-432c-aedb-2e53574dee8d	Blood Group & Rh Factor	BLO	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-26 08:56:33.706489	pending	1	normal	Lab test requested during clinical visit	1	2026-03-26 08:56:33.706489	2026-03-26 08:56:33.706489	\N	f	\N	\N
e55fcccc-a47f-4212-b6ca-6c42e2581452	f13d0c29-3fef-494a-9642-2f390835d83f	\N	c5e724d8-5eaf-432c-aedb-2e53574dee8d	Hepatitis C Virus Antibody	HEP	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-26 08:56:33.717034	pending	1	normal	Lab test requested during clinical visit	1	2026-03-26 08:56:33.717034	2026-03-26 08:56:33.717034	\N	f	\N	\N
47522ef2-5cee-491c-b114-33457019068d	d847f88c-e89d-444e-bf03-c15aed4b1d10	\N	00bc3ea7-bb60-47fd-8ae9-1fedc59e2f92	Serum Creatinine	SER	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-30 17:01:53.576584	pending	1	normal	Lab test requested during clinical visit	1	2026-03-30 17:01:53.576584	2026-03-30 17:01:53.576584	\N	f	\N	\N
1ad5c4c1-e535-485a-812a-71a19aa870ca	d847f88c-e89d-444e-bf03-c15aed4b1d10	\N	00bc3ea7-bb60-47fd-8ae9-1fedc59e2f92	Coagulation Profile	COA	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-30 17:01:53.59263	pending	1	normal	Lab test requested during clinical visit	1	2026-03-30 17:01:53.59263	2026-03-30 17:01:53.59263	\N	f	\N	\N
\.


--
-- Data for Name: lab_result_component_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lab_result_component_values (id, result_id, component_name, value, unit, normal_range, is_abnormal, remark, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lab_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lab_results (id, lab_request_id, patient_id, patient_name, test_name, results, result_date, performed_by, clinic_id, is_partial, total_components, completed_components, branch_id, created_at, updated_at, verified_by, verified_at, status) FROM stdin;
\.


--
-- Data for Name: lab_test_components; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lab_test_components (id, lab_test_id, component_name, unit, reference_range, created_at, clinic_id, display_order, updated_at) FROM stdin;
8c783249-83f2-4637-8773-ca387fd87463	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Hemoglobin	g/dL	Male: 13.5-17.5 | Female: 12.0-16.0	2026-03-23 20:06:14.486647	1	1	2026-03-23 20:06:14.486647
aa4e3f6d-1daf-4e25-b0b9-75c69bc97abe	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Hematocrit	%	Male: 41-53 | Female: 36-45	2026-03-23 20:06:14.492755	1	2	2026-03-23 20:06:14.492755
c7370564-c2dc-4d30-a1e7-afa66771e135	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	RBC Count	10^12/L	Male: 4.5-5.9 | Female: 4.0-5.2	2026-03-23 20:06:14.497967	1	3	2026-03-23 20:06:14.497967
bca699e8-e227-4259-9586-1bb9932412f5	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	MCV	fL	80-100	2026-03-23 20:06:14.502601	1	4	2026-03-23 20:06:14.502601
11572f74-c9be-4d33-a684-30c3192f1bd5	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	MCH	pg	27-32	2026-03-23 20:06:14.513071	1	5	2026-03-23 20:06:14.513071
ac24bfe1-f486-41f2-968e-62dc40e714b1	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	MCHC	g/dL	32-36	2026-03-23 20:06:14.516431	1	6	2026-03-23 20:06:14.516431
e607757b-e681-4c2e-a3ae-9f0b97e816b4	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	RDW	%	11.5-14.5	2026-03-23 20:06:14.526208	1	7	2026-03-23 20:06:14.526208
0f62df1c-6ab0-4ae9-9678-1abbda3182ec	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	WBC Count	10^9/L	4.0-11.0	2026-03-23 20:06:14.533203	1	8	2026-03-23 20:06:14.533203
f38219d3-9ff2-4d9f-9535-bd3fdb2372d2	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Neutrophils	%	40-70	2026-03-23 20:06:14.538711	1	9	2026-03-23 20:06:14.538711
922043cb-bb1a-4fe9-af48-29f0a19a5c10	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Lymphocytes	%	20-40	2026-03-23 20:06:14.545827	1	10	2026-03-23 20:06:14.545827
0dd1d272-6450-4763-a89d-538839d79bda	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Monocytes	%	2-8	2026-03-23 20:06:14.550506	1	11	2026-03-23 20:06:14.550506
c48c9998-e096-49c9-9597-b9dc518e9dd1	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Eosinophils	%	1-4	2026-03-23 20:06:14.573436	1	12	2026-03-23 20:06:14.573436
cf82d433-675e-46a0-967a-9d3159c6d701	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Basophils	%	0-1	2026-03-23 20:06:14.578447	1	13	2026-03-23 20:06:14.578447
4abfefd6-61e4-4a12-9d8f-d231f3b1efcb	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Neutrophils Absolute	10^9/L	2.0-7.5	2026-03-23 20:06:14.582463	1	14	2026-03-23 20:06:14.582463
4e60a34a-a850-4cfa-b4eb-0abb70c30777	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Lymphocytes Absolute	10^9/L	1.0-4.0	2026-03-23 20:06:14.593793	1	15	2026-03-23 20:06:14.593793
1a9bba9d-e71a-4ae2-aef2-b1938cb8561f	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Monocytes Absolute	10^9/L	0.2-1.0	2026-03-23 20:06:14.596503	1	16	2026-03-23 20:06:14.596503
1d794708-ec78-45e1-90e2-fb4ffad2f875	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Eosinophils Absolute	10^9/L	0.0-0.5	2026-03-23 20:06:14.599685	1	17	2026-03-23 20:06:14.599685
6ea4d069-db2a-4f25-8243-dc9b82210426	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Basophils Absolute	10^9/L	0.0-0.1	2026-03-23 20:06:14.60214	1	18	2026-03-23 20:06:14.60214
c58b3d9c-4166-4442-828a-eddca06470de	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Platelet Count	10^9/L	150-400	2026-03-23 20:06:14.6057	1	19	2026-03-23 20:06:14.6057
4ae21904-e611-4564-a168-6845b43c60ad	beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	MPV	fL	7.5-11.5	2026-03-23 20:06:14.614888	1	20	2026-03-23 20:06:14.614888
8c8ed6fc-00df-4734-875b-0587757ec937	4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	WBC Count	cu/mm	4000-11000	2026-03-23 20:06:14.633051	1	1	2026-03-23 20:06:14.633051
450302cf-0917-4f81-aee8-29f115eb732a	4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	Neutrophils	%	40-70	2026-03-23 20:06:14.641664	1	2	2026-03-23 20:06:14.641664
4ad741ee-fcb8-4818-ae7b-aee23bc4c0a7	4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	Lymphocytes	%	20-40	2026-03-23 20:06:14.647135	1	3	2026-03-23 20:06:14.647135
6f7929b1-903f-4fc2-9a8d-a3a6376279ac	4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	Monocytes	%	2-8	2026-03-23 20:06:14.652224	1	4	2026-03-23 20:06:14.652224
216dac78-8bc4-4e9b-8c97-534080c3a3ac	4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	Eosinophils	%	1-4	2026-03-23 20:06:14.656128	1	5	2026-03-23 20:06:14.656128
cb302fbe-819a-4f64-9cbe-c3d3f2fbf134	4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	Basophils	%	0-1	2026-03-23 20:06:14.665429	1	6	2026-03-23 20:06:14.665429
8d0c15f8-e76d-407d-82a9-1322e67e75a2	33eb4979-f09a-46e8-967e-2665c917faed	Hemoglobin	g/dL	Male: 13.5-17.5 | Female: 12.0-16.0	2026-03-23 20:06:14.684175	1	1	2026-03-23 20:06:14.684175
5ac8e2e9-202a-4a5a-84e6-1fdf6641de2f	33eb4979-f09a-46e8-967e-2665c917faed	Hematocrit	%	Male: 41-53 | Female: 36-45	2026-03-23 20:06:14.685621	1	2	2026-03-23 20:06:14.685621
0ff89c15-422d-43fa-b02d-6804fa7316ce	75fc4815-0722-4e86-881e-1d46932d3304	Malaria Parasites	\N	Negative	2026-03-23 20:06:14.719497	1	1	2026-03-23 20:06:14.719497
1075d8b6-d9c6-43fc-ba23-14e7119732d0	75fc4815-0722-4e86-881e-1d46932d3304	Species Identified	\N	None	2026-03-23 20:06:14.727808	1	2	2026-03-23 20:06:14.727808
980c95dc-5f52-4054-bf7c-0f590eb26d45	75fc4815-0722-4e86-881e-1d46932d3304	Parasitemia	parasites/UL	Negative	2026-03-23 20:06:14.73492	1	3	2026-03-23 20:06:14.73492
94419dc2-09b0-42ed-bcc2-ae15c8a70f1b	059f4b88-7df0-4391-919d-efa81957aefe	Blood Group	\N	A / B / AB / O	2026-03-23 20:06:14.752246	1	1	2026-03-23 20:06:14.752246
ca2dd85c-d452-4eb9-864f-6473394fc013	059f4b88-7df0-4391-919d-efa81957aefe	Rh Factor	\N	Positive / Negative	2026-03-23 20:06:14.756392	1	2	2026-03-23 20:06:14.756392
b7ab9417-d2f7-4423-951f-1ff826c6bebe	5b8cd13a-bc3b-4858-aad6-13d08d167c60	Urea	mg/dL	15-45	2026-03-23 20:06:14.77136	1	1	2026-03-23 20:06:14.77136
0679c098-23ba-4ce5-b507-ed924e197295	5b8cd13a-bc3b-4858-aad6-13d08d167c60	Creatinine	mg/dL	Male: 0.7-1.2 | Female: 0.5-1.1	2026-03-23 20:06:14.775234	1	2	2026-03-23 20:06:14.775234
f6f3df36-093a-42a1-bfed-80ef1051603f	5b8cd13a-bc3b-4858-aad6-13d08d167c60	Sodium	mmol/L	135-145	2026-03-23 20:06:14.784734	1	3	2026-03-23 20:06:14.784734
2725ed09-d39c-428f-9df3-e59a5a8b87d9	5b8cd13a-bc3b-4858-aad6-13d08d167c60	Potassium	mmol/L	3.5-5.0	2026-03-23 20:06:14.789469	1	4	2026-03-23 20:06:14.789469
fec83ef1-7212-4920-87ae-e6063ef2a510	5b8cd13a-bc3b-4858-aad6-13d08d167c60	Chloride	mmol/L	98-107	2026-03-23 20:06:14.792186	1	5	2026-03-23 20:06:14.792186
3299b364-0ad1-43ac-8aee-76764f24c308	5b8cd13a-bc3b-4858-aad6-13d08d167c60	Bicarbonate	mmol/L	22-29	2026-03-23 20:06:14.796295	1	6	2026-03-23 20:06:14.796295
91137a65-69d5-4611-982e-a5d3bfd4479a	2cd51693-1f0a-4e90-bd9c-0b6ed69abf7d	Blood Glucose (Random)	mg/dL	70-140	2026-03-23 20:06:14.801991	1	1	2026-03-23 20:06:14.801991
9d28f835-c57a-4ef8-9201-e6377eb6e74c	7e139b91-3913-479d-95a2-4598d8bf7a55	Uric Acid	mg/dL	Male: 3.5-7.2 | Female: 2.5-6.0	2026-03-23 20:06:14.815029	1	1	2026-03-23 20:06:14.815029
a4728bf1-d3e5-4d74-afa3-c0e7f4cc77c0	db70fe20-7061-4f44-a1f7-c719385780e0	VDRL	\N	Reactive / Non-Reactive	2026-03-23 20:06:14.820985	1	1	2026-03-23 20:06:14.820985
19422ed2-14d7-48fd-b926-f2df014628f6	92dcfd59-4364-472d-889b-f093e05f408a	HBs Ag	\N	Non-Reactive	2026-03-23 20:06:14.829883	1	1	2026-03-23 20:06:14.829883
27c54dd6-dc40-461e-be3c-a30b276a0154	92dcfd59-4364-472d-889b-f093e05f408a	Anti-HCV	\N	Non-Reactive	2026-03-23 20:06:14.833453	1	1	2026-03-23 20:06:14.833453
e45adf8c-2363-40f0-9146-e78de2cf342e	c269f087-2d6d-41ab-b187-4473f63f01d9	Beta-HCG	\N	Negative (Non-Pregnant)	2026-03-23 20:06:14.849943	1	1	2026-03-23 20:06:14.849943
02f45333-9afb-4236-8081-ad725b0f44fd	8a0d9b69-6f20-422b-ac41-689c4bc38668	HIV P24 Antigen	\N	Non-Reactive	2026-03-23 20:06:14.859091	1	1	2026-03-23 20:06:14.859091
ae739da7-7236-48db-be06-cee56cce3512	8a0d9b69-6f20-422b-ac41-689c4bc38668	HIV 1/2 Antibody	\N	Non-Reactive	2026-03-23 20:06:14.861915	1	2	2026-03-23 20:06:14.861915
20d54225-c721-439e-b904-f49f64f3d0f3	73d3ac7b-e95f-4a1d-b5dc-37612d6f8817	B. Abortus	titre	< 1:80	2026-03-23 20:06:14.88871	1	1	2026-03-23 20:06:14.88871
f82d0568-0eb7-4577-b2fe-9329c5f18530	73d3ac7b-e95f-4a1d-b5dc-37612d6f8817	B. Melitensis	titre	< 1:80	2026-03-23 20:06:14.889888	1	2	2026-03-23 20:06:14.889888
3ecc488f-88bb-4d4c-a48c-12a034762a05	0c1521fe-3dd9-4da7-a2e0-2ec5a6204950	Induration	mm	< 5mm: Negative | 5-9mm: Borderline | ≥10mm: Positive	2026-03-23 20:06:14.906983	1	1	2026-03-23 20:06:14.906983
d7cd56df-b05d-45ea-b85c-9151e032c3b3	410cdcf7-b84a-4e98-a500-f391b93c8746	Color	\N	Yellow	2026-03-23 20:06:14.918696	1	1	2026-03-23 20:06:14.918696
d799c9b0-ac55-42f4-baa5-54ca7b34070c	410cdcf7-b84a-4e98-a500-f391b93c8746	Appearance	\N	Clear	2026-03-23 20:06:14.920469	1	2	2026-03-23 20:06:14.920469
5b9ab50e-dc91-4f76-948d-35a53b06b1da	410cdcf7-b84a-4e98-a500-f391b93c8746	Protein	\N	Negative	2026-03-23 20:06:14.927525	1	3	2026-03-23 20:06:14.927525
759c2ad2-770e-4e59-87bc-4a542537f4e9	410cdcf7-b84a-4e98-a500-f391b93c8746	Sugar/Glucose	\N	Negative	2026-03-23 20:06:14.929212	1	4	2026-03-23 20:06:14.929212
f9599acd-941a-4a13-bf8d-63babf898d15	410cdcf7-b84a-4e98-a500-f391b93c8746	Acetone/Ketones	\N	Negative	2026-03-23 20:06:14.931058	1	5	2026-03-23 20:06:14.931058
218bbdd9-915a-4597-aa36-3156692d013d	410cdcf7-b84a-4e98-a500-f391b93c8746	Leucocytes	\N	Negative	2026-03-23 20:06:14.932983	1	6	2026-03-23 20:06:14.932983
f831af4d-d45f-4e8d-bc89-11341129ced6	410cdcf7-b84a-4e98-a500-f391b93c8746	Worms	\N	Not Seen	2026-03-23 20:06:14.933967	1	7	2026-03-23 20:06:14.933967
2a151d0b-cd69-4d6b-848c-d5808831c4d9	410cdcf7-b84a-4e98-a500-f391b93c8746	Specific Gravity	\N	1.005-1.030	2026-03-23 20:06:14.936557	1	8	2026-03-23 20:06:14.936557
e6496349-e1fc-4eb5-b5b0-f6902c52df58	410cdcf7-b84a-4e98-a500-f391b93c8746	pH	\N	4.5-8.0	2026-03-23 20:06:14.938194	1	9	2026-03-23 20:06:14.938194
e9ab8902-e37b-4260-8de7-186621744b13	410cdcf7-b84a-4e98-a500-f391b93c8746	Blood	\N	Negative	2026-03-23 20:06:14.942073	1	10	2026-03-23 20:06:14.942073
d404ed52-22d6-42f0-a1ce-ced377901e76	410cdcf7-b84a-4e98-a500-f391b93c8746	Pus Cells	cells/HPF	0-5	2026-03-23 20:06:14.944113	1	11	2026-03-23 20:06:14.944113
422b5a10-21fb-405c-addc-fa04d8ce892c	410cdcf7-b84a-4e98-a500-f391b93c8746	RBCs	cells/HPF	0-2	2026-03-23 20:06:14.945651	1	12	2026-03-23 20:06:14.945651
b1119b80-1b38-44da-ad7e-344f4f4a265f	410cdcf7-b84a-4e98-a500-f391b93c8746	Epithelial Cells	cells/HPF	Occasional	2026-03-23 20:06:14.948473	1	13	2026-03-23 20:06:14.948473
6a9df76b-b25b-4c43-8e0f-044fa827da07	410cdcf7-b84a-4e98-a500-f391b93c8746	Bacteria	\N	Not Seen	2026-03-23 20:06:14.950098	1	14	2026-03-23 20:06:14.950098
4ffccf8d-8411-4393-ac9a-0ad1d9a5c26e	410cdcf7-b84a-4e98-a500-f391b93c8746	Casts	\N	Not Seen	2026-03-23 20:06:14.951433	1	15	2026-03-23 20:06:14.951433
bd7a45ae-39af-4edc-a59e-f33a33c1c25a	410cdcf7-b84a-4e98-a500-f391b93c8746	Ova	\N	Not Seen	2026-03-23 20:06:14.952477	1	16	2026-03-23 20:06:14.952477
516553d5-c021-486f-a692-46f9ddf836bb	410cdcf7-b84a-4e98-a500-f391b93c8746	Cysts	\N	Not Seen	2026-03-23 20:06:14.954331	1	17	2026-03-23 20:06:14.954331
eb734b5f-c7f1-4156-a5ef-fe103a6828d8	410cdcf7-b84a-4e98-a500-f391b93c8746	Others	\N	Not Seen	2026-03-23 20:06:14.956099	1	18	2026-03-23 20:06:14.956099
e28a521e-7656-4444-853c-4c6a8297492a	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Color	\N	Brown	2026-03-23 20:06:14.959616	1	1	2026-03-23 20:06:14.959616
9a376746-2eb6-4f33-9bc3-e6991b3ef7bc	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Consistency	\N	Formed	2026-03-23 20:06:14.960621	1	2	2026-03-23 20:06:14.960621
6ab9dadc-fb96-46f0-9605-f5e0260e9524	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Undigested Food	\N	Negative	2026-03-23 20:06:14.961361	1	3	2026-03-23 20:06:14.961361
a8eebfe4-867d-45c5-beb3-3a38aa2f33cc	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Mucus	\N	Negative	2026-03-23 20:06:14.962067	1	4	2026-03-23 20:06:14.962067
5e64098c-eec8-4705-b855-fdea633efcf0	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Blood	\N	Negative	2026-03-23 20:06:14.962848	1	5	2026-03-23 20:06:14.962848
62dc8d53-1347-4839-b1b9-5a811a66ac54	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Pus Cells	cells/HPF	0-5	2026-03-23 20:06:14.963644	1	6	2026-03-23 20:06:14.963644
2196ea05-1ae2-434c-b0e2-d3b23f5577a4	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	RBCs	cells/HPF	Not Seen	2026-03-23 20:06:14.964394	1	7	2026-03-23 20:06:14.964394
4af586b8-0975-4044-8c5a-405bd78dbd8a	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Parasites	\N	Not Seen	2026-03-23 20:06:14.965151	1	8	2026-03-23 20:06:14.965151
a6eafdc0-7b5a-43fc-a69e-47920cbc3c92	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Ova	\N	Not Seen	2026-03-23 20:06:14.966325	1	9	2026-03-23 20:06:14.966325
646d3940-304f-4605-922e-bfc3bd211aa7	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Cysts	\N	Not Seen	2026-03-23 20:06:14.967725	1	10	2026-03-23 20:06:14.967725
09a5e0eb-fd06-4ab0-bc4c-3b8cefdd7cd8	1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Others	\N	Not Seen	2026-03-23 20:06:14.969085	1	11	2026-03-23 20:06:14.969085
486002fb-978a-44f4-844e-86ef23ab9922	05063f5f-a60a-43e4-b064-077ab0bbc368	Direct Coombs Test		Negative	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
25883f36-7fb9-4296-b02b-7d9eae429848	13250760-7361-4aee-a21a-38212229ed84	ALT (SGPT)	U/L	M:7-56 | F:7-45	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
2807c821-bb75-451b-b5d2-4f33593beeeb	6fd9cbd8-43a2-4e8f-bd45-45a0652bc546	AST (SGOT)	U/L	M:10-40 | F:9-32	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
3a90bcf0-af45-48cb-9c5d-c98f2daabc09	042b45e0-4434-4fcc-b8ec-d2f8450863f2	Albumin	g/dL	3.5 - 5.0	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
0b5032e1-5b4e-4003-9ada-0c1cbde1ce4c	9ed4fa87-a6d0-4e3b-881e-0c69e204c8aa	Blood Urea	mg/dL	15 - 45	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
a8c20084-0a24-4f9e-b240-59e84cb10a89	9ed4fa87-a6d0-4e3b-881e-0c69e204c8aa	BUN	mg/dL	7 - 20	2026-03-30 16:10:01.919314	1	2	2026-03-30 16:10:01.919314
c61d0e69-4776-4dc7-8a92-d2883bbc691c	27be099b-a2f2-4951-8b5f-e3ea66e2d814	Random Blood Sugar	mg/dL	Normal: < 200	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
f7b6f71d-6976-4a0d-8076-0875be6c9c3f	0c426381-4566-42c2-86a0-d44fdcac94ec	Fasting Blood Sugar	mg/dL	Normal:70-99 | Pre-DM:100-125 | DM:>=126	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
9c9c4a63-9d16-4652-9e94-b7e5fc4efd29	6ee9d161-ce2a-4beb-94c3-5fedae55014d	Fasting (0 hr)	mg/dL	70 - 99	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
d161b15d-0d13-4265-a30e-848a2596b632	6ee9d161-ce2a-4beb-94c3-5fedae55014d	1 Hour	mg/dL	< 180	2026-03-30 16:10:01.919314	1	2	2026-03-30 16:10:01.919314
4350ce6f-e0ec-4139-8b27-c61a216538e1	6ee9d161-ce2a-4beb-94c3-5fedae55014d	2 Hours	mg/dL	Normal:<140 | Pre-DM:140-199 | DM:>=200	2026-03-30 16:10:01.919314	1	3	2026-03-30 16:10:01.919314
6e17b243-8dbf-4aeb-a5fc-e25896343e6d	6291a8bc-7fcb-40c5-a822-a4f50b5d1d13	HbA1c	%	Normal:<5.7 | Pre-DM:5.7-6.4 | DM:>=6.5	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
b4117815-e13e-4c58-8b4c-479895a8fd3d	6291a8bc-7fcb-40c5-a822-a4f50b5d1d13	Estimated Average Glucose (eAG)	mg/dL	< 114	2026-03-30 16:10:01.919314	1	2	2026-03-30 16:10:01.919314
6e3d858e-a878-4b0c-a2e1-f3640cad5868	82de9e4b-df55-401e-9c91-f08baf26ee57	Total Cholesterol	mg/dL	Desirable:<200 | Borderline:200-239 | High:>=240	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
f976ad48-49c3-4bd1-a5b9-1680793a86b2	0ebb35d5-2712-4caf-a216-2122e4113c86	HDL Cholesterol	mg/dL	M:>40 | F:>50 (Higher is better)	2026-03-30 16:10:01.919314	1	1	2026-03-30 16:10:01.919314
ffa71347-4321-415f-91a2-30ad24a4a754	0ebb35d5-2712-4caf-a216-2122e4113c86	LDL Cholesterol	mg/dL	Optimal:<100 | Near Optimal:100-129	2026-03-30 16:10:01.919314	1	2	2026-03-30 16:10:01.919314
b56ae065-66a8-4209-a27e-85b6a0d2d6b8	0ebb35d5-2712-4caf-a216-2122e4113c86	VLDL	mg/dL	5 - 40	2026-03-30 16:10:01.919314	1	3	2026-03-30 16:10:01.919314
4e9a36fd-a750-4df0-9bad-05339c791a44	0ebb35d5-2712-4caf-a216-2122e4113c86	TC/HDL Ratio		< 5.0	2026-03-30 16:10:01.919314	1	4	2026-03-30 16:10:01.919314
e23d2fb1-1c7e-48ee-acc3-0af6c63293e9	05c67555-b921-4eed-a32f-1ee948cffc57	Procalcitonin	ng/mL	Normal:<0.5 | Possible Sepsis:0.5-2.0 | High Sepsis:>2.0	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
01b3ab44-0211-470f-bd51-5809179d7b79	52f22e09-136a-4b70-9b01-7c876a76eb4e	Dengue NS1 Antigen		Non-Reactive	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
bca5d013-9f89-4589-ba53-f6b217f3b521	52f22e09-136a-4b70-9b01-7c876a76eb4e	Dengue IgM Antibody		Non-Reactive	2026-03-30 16:11:30.377307	1	2	2026-03-30 16:11:30.377307
d281679f-c576-40a0-b606-a0ca35b46cfd	52f22e09-136a-4b70-9b01-7c876a76eb4e	Dengue IgG Antibody		Non-Reactive	2026-03-30 16:11:30.377307	1	3	2026-03-30 16:11:30.377307
e9e2dad6-243e-438e-bae1-45a50387864f	06feef98-5027-46e2-810f-2db3aebb6120	SARS-CoV-2 Antigen		Negative	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
c2733ff0-4b3d-4090-8bcc-807bc2f0cf40	76d2e583-c790-4b94-bbcb-153c2ea30678	Group A Streptococcus Antigen		Negative	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
f732e0b9-c560-4f5d-81c8-36160ed04ee8	20debdaf-98e1-4849-8e9c-56f26a40063d	HCG (Urine)		Negative (Non-Pregnant)	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
255662e7-3305-4c2e-bb64-1bab87bcf0f6	3feac996-77ce-4f70-9022-206896df458c	MTB Detection		Not Detected	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
7d10901d-9e59-44f6-8b87-aacd787adebc	3feac996-77ce-4f70-9022-206896df458c	Rifampicin Resistance		Not Detected	2026-03-30 16:11:30.377307	1	2	2026-03-30 16:11:30.377307
c9608b4d-61d2-449d-b623-66a2c8624119	055ead28-1c26-4ca0-a0ed-cda0d2adfd91	LH	mIU/mL	M:1.7-8.6 | F-Fol:2.4-12.6 | F-Mid:14.0-95.6 | F-Lut:1.0-11.4 | PM:7.7-58.5	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
00910d70-100a-4785-a1b7-46b77ddd1127	275a1470-0bcf-424b-b69c-89018a640b44	Prolactin	ng/mL	M:2.0-18.0 | F:2.8-29.2 | Pregnant:10-209	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
1d5a388c-915e-4497-8a99-732bf7dc00a1	125b0f72-1fec-4d32-beb7-5c28bbc865c3	CEA	ng/mL	Non-smoker: < 3.0 | Smoker: < 5.0	2026-03-30 16:11:30.377307	1	1	2026-03-30 16:11:30.377307
af6bca63-4789-4a15-a97b-42f26499f79e	4656782e-5e44-4843-971a-677217d49f77	RBC Morphology		Normal	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
ba0a0a25-2217-43d2-913b-c7ad08ddd879	4656782e-5e44-4843-971a-677217d49f77	WBC Morphology		Normal	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
d2bb0b7b-16e9-48d1-bd80-13689b63b404	4656782e-5e44-4843-971a-677217d49f77	Platelet Estimate		Adequate	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
2bfaeaf6-ed66-4ac2-aae3-ff63189cc391	4656782e-5e44-4843-971a-677217d49f77	Parasites		None Seen	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
e344d058-2e8a-4094-a514-789577ad11c1	1faf37f0-3508-4204-a34c-cf3ffa87b6a5	PT (Prothrombin Time)	seconds	11.0 - 13.5	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
63e6c6d5-5adc-4fd9-8064-d0e84b9c6409	1faf37f0-3508-4204-a34c-cf3ffa87b6a5	APTT	seconds	25 - 35	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
0e45a74a-b9cb-4f0a-b004-29df824ffddc	1faf37f0-3508-4204-a34c-cf3ffa87b6a5	INR		0.8 - 1.2	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
2b061770-bba7-423c-8b0a-32d93af9bada	1faf37f0-3508-4204-a34c-cf3ffa87b6a5	Fibrinogen	mg/dL	200 - 400	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
9eee7178-aecc-4086-aa5a-65f8ba9ca676	1faf37f0-3508-4204-a34c-cf3ffa87b6a5	Bleeding Time (BT)	minutes	2 - 7	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
d477d3f6-590b-484a-af5b-ef1d6bf20d54	1faf37f0-3508-4204-a34c-cf3ffa87b6a5	Clotting Time (CT)	minutes	5 - 11	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
c84b6ade-f1ff-4b64-83df-44a1bd4326cb	0ff73ea7-5747-4c0b-be3a-1e83eaa1880d	Major Cross Match		Compatible	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
7dcc38c5-df9d-4283-bba8-83c42465897d	0ff73ea7-5747-4c0b-be3a-1e83eaa1880d	Minor Cross Match		Compatible	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
f33894ba-faa2-477d-a279-252f903ec33f	2477576c-ab87-4119-ade0-04119abcc19b	ALP	U/L	44 - 147	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
49547c35-1920-4946-95c9-ddb03073c2be	911a3b45-3ccf-482a-abc1-5dab8c101b1b	Total Bilirubin	mg/dL	0.2 - 1.2	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
9b793e0d-8414-47e7-aae1-7d62907e660c	911a3b45-3ccf-482a-abc1-5dab8c101b1b	Direct Bilirubin	mg/dL	0.0 - 0.3	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
c975e39f-e4a6-437e-8a1b-604325726568	911a3b45-3ccf-482a-abc1-5dab8c101b1b	Indirect Bilirubin	mg/dL	0.1 - 1.0	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
9544e5ff-f652-4f68-b54d-943ef65b1434	0180885f-7066-41c9-b129-12154bd62d9e	Serum Creatinine	mg/dL	M:0.7-1.3 | F:0.6-1.1	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
4e746a80-94c7-4c6a-9d82-76cc0d229d03	0180885f-7066-41c9-b129-12154bd62d9e	eGFR	mL/min/1.73m²	> 60	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
372a0c06-cdb1-4b32-a18b-3395a98e49ff	093a3e58-7654-4707-bb5b-af5bf7c8c8b4	Triglycerides	mg/dL	Normal:<150 | Borderline:150-199 | High:200-499	2026-03-30 16:16:42.242199	1	0	2026-03-30 16:16:42.242199
435f97af-00fa-4209-8123-09d9d2d0b0cb	06748c24-2cc8-4b92-b291-b6fcba1f3105	Serum Lipase	U/L	10 - 140	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
033d9fe3-f46d-4501-a31b-fce83b321fba	1b9029a7-f93e-4fc4-9163-306c92279da5	HBsAg		Non-Reactive	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
fe7cd1ee-326d-44b1-8c5c-da9a90d32f7a	15d5eb96-e076-4fd8-ac77-d343d7e8e409	Anti-HCV Antibodies		Non-Reactive	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
9b6b5822-8a4b-4124-a68f-c83da7262149	71d18108-f25e-4d21-91ed-8a81b12f939f	Plasmodium falciparum		Negative	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
12dc058f-904f-45e9-a83c-b5877b5e195c	71d18108-f25e-4d21-91ed-8a81b12f939f	Plasmodium vivax		Negative	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
85bcd251-1801-4544-a84b-126a1407bd79	71d18108-f25e-4d21-91ed-8a81b12f939f	Pan-Plasmodium		Negative	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
66b94c65-647b-4e4c-85d4-6ff5829c3f2e	120e04f9-e869-48c9-8d17-349417f3220e	TSH	mIU/L	0.4 - 4.0	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
fbc38d1d-5b8d-4552-a0dc-69842e9b42fe	2f692bd3-ee41-4f7b-8778-d85219fc1f80	Total Testosterone	ng/dL	M:300-1000 | F:15-70	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
c24cef08-b96d-40e8-af1a-43d0c44f09f4	241cabcf-6e8e-4d6d-8df7-cb5bd678b01a	FSH	mIU/mL	M:1.5-12.4 | F-Fol:3.5-12.5 | F-Mid:4.7-21.5 | F-Lut:1.7-7.7 | PM:25.8-134.8	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
e64449bc-98bc-464d-958f-6a43e2b99cb6	376352b8-0ea5-4f05-a8e5-94786c018120	Beta-HCG	mIU/mL	Non-Pregnant: < 5 | Varies by gestational week	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
892c80f3-6b92-4023-a0af-ccc78687f2e8	5e1b69ab-bfe8-427e-905a-8d790bc94075	Progesterone	ng/mL	M:0.2-1.4 | F-Fol:0.1-0.9 | F-Lut:1.8-24.0 | PM:0.1-0.8	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
272a8c31-940a-4345-a822-6fb54ef45592	8711e962-fbc4-4d86-b43c-a8d9563ea592	CA-125	U/mL	< 35	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
89f90587-a95c-4aa9-8721-9f8b983e4bb4	951a1fe9-6aab-4a9b-b2bd-e6a5d9fbe1ce	AFP	ng/mL	< 7.0	2026-03-30 16:16:42.401771	1	0	2026-03-30 16:16:42.401771
773e4b4c-9977-4efa-9b51-5feac6a55c94	0417ac1c-ab05-4a55-961e-3a9b62876312	ESR	mm/hr	M:0-15 | F:0-20	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
1aa5ebe7-4738-4981-bd6c-6bb25d44dfaf	2b762e7e-f578-4133-9c98-46c2595bbe13	ABO Blood Group		A / B / AB / O	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
951dfaa5-5070-49be-9f79-cfba2765edd1	2b762e7e-f578-4133-9c98-46c2595bbe13	Rh Factor		Positive / Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
aba33d02-3f28-4f90-b405-0dc5c757c297	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Colour		Pale Yellow - Amber	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
7798837e-a612-45a8-a61c-c9e31954c461	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Clarity		Clear	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
dceeec70-ad6c-4b24-b58a-0c67f43748ba	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	pH		4.5 - 8.0	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
4024e973-af52-44b6-b56d-d66466ec21a4	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Specific Gravity		1.005 - 1.030	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
e56245e0-e3a5-4caf-bec3-eefb171cf9b9	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Protein		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
4c6bc320-ca32-4406-aab6-e3bfc8a20b31	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Glucose		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
a451db1d-21e8-4836-9ce6-6d74d4e5634a	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Ketones		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
cb93ee2c-c069-469c-8e86-878dd849bc85	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Blood		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
62afcc03-ad51-4d53-9680-2d26804e80c3	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Bilirubin		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
457f50a6-0131-4964-993f-5a4418cb602c	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Urobilinogen	EU/dL	0.1 - 1.0	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
a9dccba0-3424-4b43-bd32-975cebd46dcc	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Nitrite		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
e8df61c6-e011-4365-92e9-7e5ba353a055	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Leukocyte Esterase		Negative	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
710d873f-acdb-4c76-a87d-29c0eea0876e	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	WBC (Microscopy)	/HPF	0 - 5	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
85537535-61ec-4912-b0d8-9040a80b0ca4	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	RBC (Microscopy)	/HPF	0 - 2	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
35568a84-97b1-46e3-8d68-6dcb6f91198d	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Epithelial Cells	/HPF	0 - 5	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
e0064398-449a-4dfe-a777-9f26246c1f26	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Casts		None	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
5f4b5dfe-9481-4f29-ac52-27da392d2671	3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Bacteria		None/Rare	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
c27b7281-029f-488a-a2df-35d7f79dc807	4fa6d377-42da-415c-96fa-5d6a6d4f78cc	Total Protein	g/dL	6.4 - 8.3	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
9a4be372-6af9-4666-a1cb-1e6f9acfe5f5	4fa6d377-42da-415c-96fa-5d6a6d4f78cc	Albumin	g/dL	3.5 - 5.0	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
a85db944-6f39-4a0f-a231-39b886faab6d	4fa6d377-42da-415c-96fa-5d6a6d4f78cc	Globulin	g/dL	2.3 - 3.5	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
ece9c367-9509-4a68-8b78-10b95002df5b	4fa6d377-42da-415c-96fa-5d6a6d4f78cc	A/G Ratio		1.1 - 2.5	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
c60f3981-72c5-427b-ac95-a2d5708c6303	2ab14491-e9ea-4bd4-be82-ccd4e251b8fe	GGT	U/L	M:9-48 | F:5-29	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
4217f26c-f6c0-49b1-a9a7-cbf5f7796c9c	75ca2ddc-ebda-45f5-8b40-f33b086b9153	Uric Acid	mg/dL	M:3.4-7.0 | F:2.4-6.0	2026-03-30 16:34:27.864953	1	0	2026-03-30 16:34:27.864953
433ffd61-5c4d-431a-b2d1-7acaf2a14585	5ccb36fe-7b71-4acf-8200-87c626728549	Troponin I (cTnI)	ng/mL	Normal:<0.04 | Elevated:>=0.04	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
955afcfc-da41-483c-963b-a6a881045a9c	792f7056-fbfd-4003-8175-e2aed809b5f8	CK-MB	U/L	< 25	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
ba65e26c-6158-48ea-b016-bb708a40b95f	792f7056-fbfd-4003-8175-e2aed809b5f8	CK Total	U/L	M:52-336 | F:38-176	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
4d0e9b12-09db-4e59-bcdb-9daafa7e5fe8	792f7056-fbfd-4003-8175-e2aed809b5f8	CK-MB Index	%	< 3.5	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
37757229-38e1-4fd8-b6da-b316873c2c73	5d1f0d3a-1b71-4b30-9234-ee12b23a0a7b	Serum Amylase	U/L	28 - 100	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
55e256fd-0f15-4acb-bc42-00f1391a82a6	390b4ffb-3162-40f2-b2fb-b465bb040f19	HIV 1/2 Antibodies		Non-Reactive	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
d5276c34-6388-43a5-a69e-b11332620f8e	3336ee96-13f7-427c-baa6-aafbf5adc3e6	S. typhi O	Titre	< 1:80 (Negative)	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
505427b3-0fce-419b-aac2-a93517c4cfe6	3336ee96-13f7-427c-baa6-aafbf5adc3e6	S. typhi H	Titre	< 1:80 (Negative)	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
e19d73fc-53d8-425a-82fc-24cee2c513ce	3336ee96-13f7-427c-baa6-aafbf5adc3e6	S. paratyphi AO	Titre	< 1:80 (Negative)	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
c33998bc-8afb-49f0-9121-a9419a7414a4	3336ee96-13f7-427c-baa6-aafbf5adc3e6	S. paratyphi BH	Titre	< 1:80 (Negative)	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
9d629446-b021-4bcb-b2ba-aa20a6340607	0a94241c-9a82-439e-8229-96c899bd222d	CRP Qualitative		Negative	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
d1ba161b-e14f-494f-80ed-ab3644b2d95f	0a94241c-9a82-439e-8229-96c899bd222d	CRP Quantitative	mg/L	< 6.0	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
711cdbdf-5d1a-4bb7-908b-64d616edf2ec	09015d3f-d985-4ddb-ae4c-acd51d01b528	Rheumatoid Factor	IU/mL	Negative: < 14	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
6ada10ba-af76-48f9-b7da-fea15d9790ba	0f92cda5-ccb1-4ace-88de-a04ad1760b06	Anti-CCP	U/mL	Negative: < 20	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
ce29a6a9-1a98-47d6-b63e-ffbe100ed5e7	44890a68-c1b2-4227-b612-472f6e6569ca	H. Pylori IgG Antibody	U/mL	Negative: < 12	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
944d312a-b5d3-460b-80ed-050d324a720e	44890a68-c1b2-4227-b612-472f6e6569ca	H. Pylori Stool Antigen		Negative	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
c5547f96-f506-4d9f-8f31-55b9f33531b2	0773420a-4320-4a97-972f-3552190fbd45	Colony Count	CFU/mL	< 10,000 (No Significant Growth)	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
87f8c40d-57f1-4e0e-a8ab-6851e10f3449	0773420a-4320-4a97-972f-3552190fbd45	Organism Identified		No Growth	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
c6b36ad0-a75e-4c40-94b0-1417b64e6281	0773420a-4320-4a97-972f-3552190fbd45	Antibiotic Sensitivity		N/A	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
9e89ef3a-7cb2-4156-b27a-c059f3f6cd4d	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Consistency		Formed	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
ca54bc41-1036-4d6b-8993-9132f278b072	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Colour		Brown	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
92434eda-5881-411e-8cc4-0323692f0528	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Blood		Negative	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
a224c758-4bdc-493f-857b-ce2f33b5affb	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Mucus		Negative	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
6aa06c7c-c60b-49ee-ba01-28faa543d200	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Ova / Cysts		None Seen	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
25dfa7e6-b58e-4441-ba30-ce641ac006d1	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Parasites		None Seen	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
81f90905-f0bb-4064-8d38-5e940d8f45d6	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Occult Blood		Negative	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
596035c0-da94-495b-bdb9-5e00bb266bd6	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	WBC	/HPF	0 - 2	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
aac07dc8-3f7e-4e03-9d09-64a98af8622f	8ff34c60-0d8f-4685-9a1e-6b2feec953c2	RBC	/HPF	0 - 2	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
34dfbfb0-0313-4fc2-a85f-01c6e91155d2	1da9266b-4a4e-4275-905e-9b9ade7655e6	AFB Smear (ZN Stain)		Negative (No AFB Seen)	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
70aa9ec2-d30c-4e95-a59f-7ede6ef3d635	1da9266b-4a4e-4275-905e-9b9ade7655e6	Sputum Quality		Adequate/Mucoid	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
2753db79-823b-4f0a-8f2b-645fd54b7fef	53165506-0d9c-4b71-a6a0-462593597c0c	Gram Stain		Normal Flora	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
17160bca-b963-4edc-b034-ff385b79722e	53165506-0d9c-4b71-a6a0-462593597c0c	Culture Result		No Significant Growth	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
f2e786e1-063e-40ab-8116-5cbe0e3f7557	53165506-0d9c-4b71-a6a0-462593597c0c	Organism Identified		None	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
ac7de71a-ef3c-4c1a-a377-e9e0abc945b7	53165506-0d9c-4b71-a6a0-462593597c0c	Antibiotic Sensitivity		N/A	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
4cc010ad-72e8-4b50-9a4a-410e7bba5603	53165506-0d9c-4b71-a6a0-462593597c0c	Clue Cells		Absent	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
58e50a06-54ed-47a4-a9bc-fbb2005dc905	53165506-0d9c-4b71-a6a0-462593597c0c	Yeast/Hyphae		Not Seen	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
14cf03c8-081b-4fe4-af3d-5f54d1e49ece	137b8fce-14a2-42b6-beb3-c56ce6500a5d	Free T4	pmol/L	9.0 - 24.0	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
9a93e586-8919-4cbd-a7ca-2a2c40eb0fa0	137b8fce-14a2-42b6-beb3-c56ce6500a5d	Free T3	pmol/L	3.5 - 7.8	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
16686235-7223-494e-87d5-1b036ea5662c	12dac119-a0b0-4f97-bc16-882a551ad4bb	Estradiol (E2)	pg/mL	M:20-55 | F-Fol:20-350 | F-Mid:135-860 | F-Lut:35-570 | PM:<20	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
37c3f7fc-5ff8-40f3-9d71-d8e348d7805c	4e2f0ef0-20ea-4d94-8f34-05bc9faf0953	Total PSA	ng/mL	< 4.0	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
ce2b9cb1-3b4c-4eda-b98f-3dff5f82dbc0	4e2f0ef0-20ea-4d94-8f34-05bc9faf0953	Free PSA	ng/mL	> 25% of Total PSA	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
5cd8a6cb-ab2d-496b-9b29-3fdeb3a32226	4e2f0ef0-20ea-4d94-8f34-05bc9faf0953	Free/Total PSA Ratio	%	> 25%	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
a18231b3-3cc1-43d4-9236-0961970df2be	1dee14f2-8e42-4d0c-9be2-01c3c0817756	CA 19-9	U/mL	< 37	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
269c1371-9f5c-4275-ac84-8f537d7e581d	2b02ce0c-6dc6-473b-a6c3-a21b21716f70	CA 15-3	U/mL	< 31.3	2026-03-30 16:34:28.11526	1	0	2026-03-30 16:34:28.11526
36538148-1331-413a-ac6e-99c856e1d1d5	f171c102-7227-45f7-a9f4-0326e774a4f9	WBC (White Blood Cells)	x10³/µL	4.5 - 11.0	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
1fba4e21-d440-4838-a671-92a76c4ed847	f171c102-7227-45f7-a9f4-0326e774a4f9	RBC (Red Blood Cells)	x10⁶/µL	M: 4.5-5.5 | F: 3.8-5.2	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
48cea7bd-f33e-4202-b186-9177dc0beb81	f171c102-7227-45f7-a9f4-0326e774a4f9	Haemoglobin (HGB)	g/dL	M: 13.5-17.5 | F: 12.0-16.0	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
c7686c94-a3e8-4499-9995-4155b629234a	f171c102-7227-45f7-a9f4-0326e774a4f9	Haematocrit (HCT)	%	M: 41-53 | F: 36-46	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
0c1dd496-2413-4374-aaee-ff08a79423ed	f171c102-7227-45f7-a9f4-0326e774a4f9	MCV	fL	80 - 100	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
68c720c5-dae8-4937-a549-771d3ce1f0f2	f171c102-7227-45f7-a9f4-0326e774a4f9	MCH	pg	27 - 33	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
acb19076-6a58-40ce-8213-5de4da732d36	f171c102-7227-45f7-a9f4-0326e774a4f9	MCHC	g/dL	32 - 36	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
ed76361e-8e9f-4677-b3da-eaf3c81aa7c9	f171c102-7227-45f7-a9f4-0326e774a4f9	RDW	%	11.5 - 14.5	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
72cd4a38-682f-4f39-bed5-ea22a7c22ec2	f171c102-7227-45f7-a9f4-0326e774a4f9	Platelets (PLT)	x10³/µL	150 - 400	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
66efb06f-88ca-4482-a5d9-a91dca579718	f171c102-7227-45f7-a9f4-0326e774a4f9	MPV (Mean Platelet Volume)	fL	7.5 - 12.5	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
efe70a0f-4c8c-4bae-bf82-dc0a921f6f5e	f171c102-7227-45f7-a9f4-0326e774a4f9	Neutrophils	%	50 - 70	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
362dd03c-b10e-481e-9913-104154e03e33	f171c102-7227-45f7-a9f4-0326e774a4f9	Neutrophils (Abs)	x10³/µL	1.8 - 7.7	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
02754da8-8151-4f36-8f7a-5cdf5ff1c76d	f171c102-7227-45f7-a9f4-0326e774a4f9	Lymphocytes	%	20 - 40	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
1a2ed2d1-44b6-404b-ac2c-ba12f781655b	f171c102-7227-45f7-a9f4-0326e774a4f9	Lymphocytes (Abs)	x10³/µL	1.0 - 4.8	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
ef15977b-4707-4dfe-8200-e8087d859580	f171c102-7227-45f7-a9f4-0326e774a4f9	Monocytes	%	2 - 8	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
8f789033-9e30-491d-a056-9c9f77f6ee60	f171c102-7227-45f7-a9f4-0326e774a4f9	Monocytes (Abs)	x10³/µL	0.0 - 0.8	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
1aab3f23-a0f6-4c00-b717-976d05e884f2	f171c102-7227-45f7-a9f4-0326e774a4f9	Eosinophils	%	1 - 4	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
017211e9-48cf-40a4-a83e-86f14ccf2c46	f171c102-7227-45f7-a9f4-0326e774a4f9	Eosinophils (Abs)	x10³/µL	0.0 - 0.45	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
ff252911-6a76-41fe-82bc-9c3049d0816e	f171c102-7227-45f7-a9f4-0326e774a4f9	Basophils	%	0 - 1	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
30c49f5b-cbca-4f0a-802e-c9aa31bd2ed6	f171c102-7227-45f7-a9f4-0326e774a4f9	Basophils (Abs)	x10³/µL	0.0 - 0.2	2026-03-30 16:40:49.347574	1	0	2026-03-30 16:40:49.347574
\.


--
-- Data for Name: lab_tests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lab_tests (id, test_name, test_code, category, price, service_id, clinic_id, is_active, created_at, created_by, updated_at) FROM stdin;
73d3ac7b-e95f-4a1d-b5dc-37612d6f8817	Widal Test for Brucellosis	BRUCELLA	Serology	0.00	\N	1	t	2026-03-23 20:06:14.887139	\N	2026-03-23 20:06:14.887139
beecaa29-eb1f-4fe4-bf3f-e6b4cac11826	Complete Blood Count	CBC	Hematology	0.00	6e22fc77-7ced-4e12-88f0-96e6c60af14e	1	t	2026-03-23 20:06:14.440607	\N	2026-03-23 20:23:07.267208
4e74b0d0-0f63-4cea-a35e-b115b39ed7f1	Total White Blood Cell Count	TWBC	Hematology	0.00	7f57b83b-bbd4-41fc-92cb-b2e1239db515	1	t	2026-03-23 20:06:14.629465	\N	2026-03-23 20:23:07.277598
33eb4979-f09a-46e8-967e-2665c917faed	Haemoglobin	HB	Hematology	0.00	c5b3f9e1-35ea-4104-b3ec-3a0d8171de88	1	t	2026-03-23 20:06:14.678429	\N	2026-03-23 20:23:07.280623
75fc4815-0722-4e86-881e-1d46932d3304	Blood Film for Malaria Parasites	BFFM	Hematology	0.00	45ce185e-9a90-4fb9-a334-a053a305ac21	1	t	2026-03-23 20:06:14.710302	\N	2026-03-23 20:23:07.297631
059f4b88-7df0-4391-919d-efa81957aefe	Blood Group & Rh Factor	BLOODGRP	Hematology	0.00	9e948355-b87d-4536-a80b-518a03e5ff35	1	t	2026-03-23 20:06:14.745239	\N	2026-03-23 20:23:07.312052
5b8cd13a-bc3b-4858-aad6-13d08d167c60	Renal Function Test	RFT	Chemistry	0.00	f23f6b72-ed04-4ef2-b9f4-a996d6a6cdb9	1	t	2026-03-23 20:06:14.766852	\N	2026-03-23 20:23:07.3266
2cd51693-1f0a-4e90-bd9c-0b6ed69abf7d	Random Blood Glucose	RBG	Chemistry	0.00	f3282ea2-8efe-4046-8a0f-01e40eee2b97	1	t	2026-03-23 20:06:14.80008	\N	2026-03-23 20:23:07.332628
7e139b91-3913-479d-95a2-4598d8bf7a55	Uric Acid	URICACID	Chemistry	0.00	72f0e7e6-2483-4831-8207-a5a2f2ecf2ca	1	t	2026-03-23 20:06:14.808474	\N	2026-03-23 20:23:07.337523
db70fe20-7061-4f44-a1f7-c719385780e0	VDRL (Syphilis Screening)	VDRL	Serology	0.00	a9ca2020-b0ee-4e81-b1d2-69af482a0ee4	1	t	2026-03-23 20:06:14.818388	\N	2026-03-23 20:23:07.340438
92dcfd59-4364-472d-889b-f093e05f408a	Hepatitis B Surface Antigen	HBsAG	Serology	0.00	8769bcdd-2645-4c17-96b1-b4d86596aa3c	1	t	2026-03-23 20:06:14.826225	\N	2026-03-23 20:23:07.34635
c269f087-2d6d-41ab-b187-4473f63f01d9	HCG Pregnancy Test	HCG	Serology	0.00	40516435-4df6-4fc0-8282-db84a0f3b89e	1	t	2026-03-23 20:06:14.844949	\N	2026-03-23 20:23:07.35439
8a0d9b69-6f20-422b-ac41-689c4bc38668	HIV P24 Antigen Test	P24	Serology	0.00	4ccf3d43-eb31-4072-9c6a-8b75c83ef607	1	t	2026-03-23 20:06:14.854747	\N	2026-03-23 20:23:07.364192
0c1521fe-3dd9-4da7-a2e0-2ec5a6204950	TB Test (Mantoux)	TB	Microbiology	0.00	6b23c782-3db9-45bc-99af-9b912b078a31	1	t	2026-03-23 20:06:14.898114	\N	2026-03-23 20:23:07.377864
410cdcf7-b84a-4e98-a500-f391b93c8746	Urine Analysis	URINE	Urinalysis	0.00	7df1856e-69fb-4097-8523-fa2d7073414b	1	t	2026-03-23 20:06:14.912858	\N	2026-03-23 20:23:07.390144
1c38fd38-78fd-42c1-a3d5-f9ae7fc203d9	Stool Analysis	STOOL	Microbiology	0.00	6ef073e3-c604-4254-9872-ef52720d628f	1	t	2026-03-23 20:06:14.95855	\N	2026-03-23 20:23:07.396229
05063f5f-a60a-43e4-b064-077ab0bbc368	Direct Coombs Test (DCT)	DCT	Blood Bank	20000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
13250760-7361-4aee-a21a-38212229ed84	ALT/SGPT (Alanine Aminotransferase)	ALT	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
6fd9cbd8-43a2-4e8f-bd45-45a0652bc546	AST/SGOT (Aspartate Aminotransferase)	AST	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
042b45e0-4434-4fcc-b8ec-d2f8450863f2	Serum Albumin	ALB	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
9ed4fa87-a6d0-4e3b-881e-0c69e204c8aa	Urea (Blood Urea Nitrogen)	UREA	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
27be099b-a2f2-4951-8b5f-e3ea66e2d814	Random Blood Sugar (RBS)	RBS	Glucose	20000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
0c426381-4566-42c2-86a0-d44fdcac94ec	Fasting Blood Sugar (FBS)	FBS	Glucose	20000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
6ee9d161-ce2a-4beb-94c3-5fedae55014d	Glucose Tolerance Test (OGTT)	OGTT	Glucose	30000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
6291a8bc-7fcb-40c5-a822-a4f50b5d1d13	HbA1c (Glycated Haemoglobin)	HBA1C	Glucose	45000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
82de9e4b-df55-401e-9c91-f08baf26ee57	Total Cholesterol	TCHOL	Lipid	35000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
0ebb35d5-2712-4caf-a216-2122e4113c86	HDL Cholesterol	HDL	Lipid	35000.00	\N	1	t	2026-03-30 16:10:01.919314	\N	2026-03-30 16:10:01.919314
05c67555-b921-4eed-a32f-1ee948cffc57	Procalcitonin (PCT)	PCT	Serology & Immunology	65000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
52f22e09-136a-4b70-9b01-7c876a76eb4e	Dengue NS1 Antigen & Antibody	DENGUE	Serology & Immunology	45000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
06feef98-5027-46e2-810f-2db3aebb6120	COVID-19 Antigen Test	COVID19	RIDT	45000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
76d2e583-c790-4b94-bbcb-153c2ea30678	Strep A (Group A Streptococcus)	STREP-A	RIDT	30000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
20debdaf-98e1-4849-8e9c-56f26a40063d	HCG Pregnancy Test (Rapid)	HCG-RAPID	RIDT	20000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
3feac996-77ce-4f70-9022-206896df458c	TB Gene Xpert (MTB/RIF)	GENEXPERT	Microbiology & Parasitology	45000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
055ead28-1c26-4ca0-a0ed-cda0d2adfd91	LH (Luteinizing Hormone)	LH	Reproductive Hormones	45000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
275a1470-0bcf-424b-b69c-89018a640b44	Prolactin	PROL	Reproductive Hormones	45000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
125b0f72-1fec-4d32-beb7-5c28bbc865c3	CEA (Carcinoembryonic Antigen)	CEA	General Tumour Markers	65000.00	\N	1	t	2026-03-30 16:11:30.377307	\N	2026-03-30 16:11:30.377307
4656782e-5e44-4843-971a-677217d49f77	Peripheral Blood Film	PBF	Haematology	15000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
1faf37f0-3508-4204-a34c-cf3ffa87b6a5	Coagulation Profile	COAG	Haematology	30000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
0ff73ea7-5747-4c0b-be3a-1e83eaa1880d	Cross Matching	XM	Blood Bank	30000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
2477576c-ab87-4119-ade0-04119abcc19b	ALP (Alkaline Phosphatase)	ALP	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
911a3b45-3ccf-482a-abc1-5dab8c101b1b	Total Bilirubin	TBIL	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
0180885f-7066-41c9-b129-12154bd62d9e	Serum Creatinine	CREAT	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
093a3e58-7654-4707-bb5b-af5bf7c8c8b4	Triglycerides	TG	Lipid	35000.00	\N	1	t	2026-03-30 16:16:42.242199	\N	2026-03-30 16:16:42.242199
06748c24-2cc8-4b92-b291-b6fcba1f3105	Lipase	LIP	Pancreatic Profile	45000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
1b9029a7-f93e-4fc4-9163-306c92279da5	Hepatitis B Surface Antigen (HBsAg)	HBSAG	Serology & Immunology	15000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
15d5eb96-e076-4fd8-ac77-d343d7e8e409	Hepatitis C Antibody (Anti-HCV)	HCV	Serology & Immunology	15000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
71d18108-f25e-4d21-91ed-8a81b12f939f	Malaria Antigen Test (RDT)	MALARIA	RIDT	20000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
120e04f9-e869-48c9-8d17-349417f3220e	TSH (Thyroid Stimulating Hormone)	TSH	Thyroid Function Test	45000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
2f692bd3-ee41-4f7b-8778-d85219fc1f80	Testosterone (Total)	TESTO	Reproductive Hormones	45000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
241cabcf-6e8e-4d6d-8df7-cb5bd678b01a	FSH (Follicle Stimulating Hormone)	FSH	Reproductive Hormones	45000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
376352b8-0ea5-4f05-a8e5-94786c018120	Serum Beta-HCG (Pregnancy)	BHCG	Reproductive Hormones	30000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
5e1b69ab-bfe8-427e-905a-8d790bc94075	Progesterone	PROG	Reproductive Hormones	45000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
8711e962-fbc4-4d86-b43c-a8d9563ea592	CA-125 (Ovarian Tumour Marker)	CA-125	Female Specific Tumour Markers	65000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
951a1fe9-6aab-4a9b-b2bd-e6a5d9fbe1ce	AFP (Alpha-Fetoprotein)	AFP	General Tumour Markers	65000.00	\N	1	t	2026-03-30 16:16:42.401771	\N	2026-03-30 16:16:42.401771
0417ac1c-ab05-4a55-961e-3a9b62876312	ESR (Erythrocyte Sedimentation Rate)	ESR	Haematology	15000.00	\N	1	t	2026-03-30 16:34:27.864953	\N	2026-03-30 16:34:27.864953
2b762e7e-f578-4133-9c98-46c2595bbe13	Blood Group & Rh Factor	BG-RH	Blood Bank	15000.00	\N	1	t	2026-03-30 16:34:27.864953	\N	2026-03-30 16:34:27.864953
3e7fb754-ea43-4fee-aa59-f733a3f7bb01	Urine Analysis (Urinalysis)	UA	Clinical Chemistry	15000.00	\N	1	t	2026-03-30 16:34:27.864953	\N	2026-03-30 16:34:27.864953
4fa6d377-42da-415c-96fa-5d6a6d4f78cc	Total Protein	TP	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:34:27.864953	\N	2026-03-30 16:34:27.864953
2ab14491-e9ea-4bd4-be82-ccd4e251b8fe	GGT (Gamma-Glutamyl Transferase)	GGT	Clinical Chemistry	35000.00	\N	1	t	2026-03-30 16:34:27.864953	\N	2026-03-30 16:34:27.864953
75ca2ddc-ebda-45f5-8b40-f33b086b9153	Uric Acid	URIC	Clinical Chemistry	25000.00	\N	1	t	2026-03-30 16:34:27.864953	\N	2026-03-30 16:34:27.864953
5ccb36fe-7b71-4acf-8200-87c626728549	Troponin I (cTnI)	TROP-I	Cardiac Marker	65000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
792f7056-fbfd-4003-8175-e2aed809b5f8	CK-MB (Creatine Kinase-MB)	CKMB	Cardiac Marker	65000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
5d1f0d3a-1b71-4b30-9234-ee12b23a0a7b	Amylase	AMY	Pancreatic Profile	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
390b4ffb-3162-40f2-b2fb-b465bb040f19	HIV Test (HIV 1 & 2)	HIV	Serology & Immunology	15000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
3336ee96-13f7-427c-baa6-aafbf5adc3e6	Widal Test (Typhoid)	WIDAL	Serology & Immunology	30000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
0a94241c-9a82-439e-8229-96c899bd222d	CRP (C-Reactive Protein)	CRP	Serology & Immunology	30000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
09015d3f-d985-4ddb-ae4c-acd51d01b528	Rheumatoid Factor (RF)	RF	Serology & Immunology	30000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
0f92cda5-ccb1-4ace-88de-a04ad1760b06	Anti-CCP (Anti-Cyclic Citrullinated Peptide)	ANTI-CCP	Serology & Immunology	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
44890a68-c1b2-4227-b612-472f6e6569ca	H. Pylori (Helicobacter Pylori)	H-PYLORI	Serology & Immunology	30000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
0773420a-4320-4a97-972f-3552190fbd45	Urine Culture & Sensitivity	UCS	Microbiology & Parasitology	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
8ff34c60-0d8f-4685-9a1e-6b2feec953c2	Stool Microscopy & Examination (M/E)	STOOL-ME	Microbiology & Parasitology	20000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
1da9266b-4a4e-4275-905e-9b9ade7655e6	Sputum AFB (Acid-Fast Bacilli)	AFB	Microbiology & Parasitology	25000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
53165506-0d9c-4b71-a6a0-462593597c0c	Vaginal Culture & Sensitivity	VAG-CS	Microbiology & Parasitology	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
137b8fce-14a2-42b6-beb3-c56ce6500a5d	Free T4 (Free Thyroxine)	FT4	Thyroid Function Test	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
12dac119-a0b0-4f97-bc16-882a551ad4bb	Estradiol (E2)	E2	Reproductive Hormones	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
4e2f0ef0-20ea-4d94-8f34-05bc9faf0953	PSA (Prostate Specific Antigen)	PSA	Fertility & Pregnancy Hormones	45000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
1dee14f2-8e42-4d0c-9be2-01c3c0817756	CA 19-9 (Pancreatic/GI Tumour Marker)	CA19-9	Female Specific Tumour Markers	65000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
2b02ce0c-6dc6-473b-a6c3-a21b21716f70	CA 15-3 (Breast Tumour Marker)	CA15-3	General Tumour Markers	65000.00	\N	1	t	2026-03-30 16:34:28.11526	\N	2026-03-30 16:34:28.11526
f171c102-7227-45f7-a9f4-0326e774a4f9	Full Blood Count (FBC)	FBC	Haematology	20000.00	\N	1	t	2026-03-30 16:40:49.347574	\N	2026-03-30 16:40:49.347574
\.


--
-- Data for Name: ledger_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ledger_accounts (id, account_name, account_code, account_type, parent_account_id, description, balance, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: multicurrency_report_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.multicurrency_report_settings (id, clinic_id, base_currency_code, secondary_currencies, show_individual_currencies, show_base_currency_conversion, show_exchange_gains_losses, date_for_rates, created_at, updated_at) FROM stdin;
1	1	SSP	["USD"]	t	t	t	\N	2026-03-23 14:29:00.120078	2026-03-23 14:29:00.120078
\.


--
-- Data for Name: nursing_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.nursing_notes (id, clinic_id, admission_id, patient_id, nurse_id, note_date, shift, care_activities, patient_condition, vital_signs, fluid_intake, fluid_output, wound_care, pain_level, mobility_status, notes, created_at) FROM stdin;
\.


--
-- Data for Name: patient_bills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patient_bills (id, patient_id, visit_id, service_id, service_name, quantity, unit_price, total_amount, status, billed_at, billed_by, invoice_id, billing_type, branch_id, created_at, updated_at, bill_id, bill_number, bill_date, services, patient_name, clinic_id, scheme_id, scheme_name, scheme_pricing_applied, bill_currency, exchange_rate, base_currency_total, clinical_total, lab_total, pharmacy_total, supply_total, procedure_total, accommodation_total, other_total, discount_amount, discount_type, discount_reason, discount_approved_by, discount_approval_date, adjustment_amount, adjustment_reason, insurance_type, insurance_member_id, insurance_copay, insurance_coverage_amount, insurance_claim_submitted, insurance_claim_date, insurance_approval_code, payment_terms, original_due_date, extended_due_date, days_overdue, is_overdue, is_credit_bill, credit_approved_by, credit_approval_date, credit_limit_used, main_gl_entry_id, aging_category, last_payment_date, requires_follow_up, follow_up_date, follow_up_notes, paid_amount, balance_amount, due_date, notes, created_by, updated_by) FROM stdin;
69125236-c7b5-4aa8-a221-891e07ec2067	d847f88c-e89d-444e-bf03-c15aed4b1d10	\N	\N	\N	1	\N	75000.00	active	2026-03-30 16:58:28.075579	\N	6983217e-84a5-470f-8874-0f5cb700d522	credit	1	2026-03-30 16:58:28.056	2026-03-30 17:01:54.185	\N	BILL-2026-907966	2026-03-30	"[\\"[\\",\\"{\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"9\\",\\"4\\",\\"2\\",\\"3\\",\\"2\\",\\"a\\",\\"7\\",\\"7\\",\\"-\\",\\"4\\",\\"2\\",\\"d\\",\\"1\\",\\"-\\",\\"4\\",\\"9\\",\\"8\\",\\"e\\",\\"-\\",\\"b\\",\\"a\\",\\"a\\",\\"2\\",\\"-\\",\\"5\\",\\"a\\",\\"1\\",\\"1\\",\\"3\\",\\"b\\",\\"b\\",\\"c\\",\\"d\\",\\"5\\",\\"b\\",\\"f\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"9\\",\\"4\\",\\"2\\",\\"3\\",\\"2\\",\\"a\\",\\"7\\",\\"7\\",\\"-\\",\\"4\\",\\"2\\",\\"d\\",\\"1\\",\\"-\\",\\"4\\",\\"9\\",\\"8\\",\\"e\\",\\"-\\",\\"b\\",\\"a\\",\\"a\\",\\"2\\",\\"-\\",\\"5\\",\\"a\\",\\"1\\",\\"1\\",\\"3\\",\\"b\\",\\"b\\",\\"c\\",\\"d\\",\\"5\\",\\"b\\",\\"f\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"e\\",\\"p\\",\\"a\\",\\"r\\",\\"t\\",\\"m\\",\\"e\\",\\"n\\",\\"t\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"G\\",\\"e\\",\\"n\\",\\"e\\",\\"r\\",\\"a\\",\\"l\\",\\" \\",\\"M\\",\\"e\\",\\"d\\",\\"i\\",\\"c\\",\\"i\\",\\"n\\",\\"e\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"o\\",\\"c\\",\\"t\\",\\"o\\",\\"r\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"D\\",\\"r\\",\\" \\",\\"R\\",\\"i\\",\\"t\\",\\"a\\",\\" \\",\\"D\\",\\"a\\",\\"n\\",\\"i\\",\\"e\\",\\"l\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"3\\",\\"0\\",\\"T\\",\\"1\\",\\"6\\",\\":\\",\\"5\\",\\"8\\",\\":\\",\\"2\\",\\"7\\",\\".\\",\\"7\\",\\"4\\",\\"4\\",\\"Z\\",\\"\\\\\\"\\",\\"}\\",\\"]\\",{\\"serviceName\\":\\"Serum Creatinine\\",\\"name\\":\\"Serum Creatinine\\",\\"quantity\\":1,\\"unitPrice\\":0,\\"totalPrice\\":0,\\"department\\":\\"Laboratory\\",\\"type\\":\\"Lab Test\\",\\"date\\":\\"2026-03-30T17:01:53.534Z\\"},{\\"serviceName\\":\\"Coagulation Profile\\",\\"name\\":\\"Coagulation Profile\\",\\"quantity\\":1,\\"unitPrice\\":0,\\"totalPrice\\":0,\\"department\\":\\"Laboratory\\",\\"type\\":\\"Lab Test\\",\\"date\\":\\"2026-03-30T17:01:53.537Z\\"},{\\"serviceName\\":\\"Serum Creatinine\\",\\"quantity\\":1,\\"unitPrice\\":25000,\\"totalPrice\\":25000,\\"invoiced\\":false},{\\"serviceName\\":\\"Coagulation Profile\\",\\"quantity\\":1,\\"unitPrice\\":30000,\\"totalPrice\\":30000,\\"invoiced\\":false}]"	Martin Ssebuga	1	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	UNIVERSAL HOSPITAL STAFF	t	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	0.00	75000.00	2026-04-29	General physician services with Dr. Dr Rita Daniel	Admin Kembe	\N
5efd31a9-5c99-4933-acec-c97f70d974aa	f13d0c29-3fef-494a-9642-2f390835d83f	\N	\N	\N	1	\N	20000.00	paid	2026-03-24 10:18:51.511766	\N	\N	cash	1	2026-03-24 10:18:51.508	2026-03-26 08:56:34.066	\N	BILL-2026-531501	2026-03-24	"[\\"[\\",\\"{\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"9\\",\\"4\\",\\"2\\",\\"3\\",\\"2\\",\\"a\\",\\"7\\",\\"7\\",\\"-\\",\\"4\\",\\"2\\",\\"d\\",\\"1\\",\\"-\\",\\"4\\",\\"9\\",\\"8\\",\\"e\\",\\"-\\",\\"b\\",\\"a\\",\\"a\\",\\"2\\",\\"-\\",\\"5\\",\\"a\\",\\"1\\",\\"1\\",\\"3\\",\\"b\\",\\"b\\",\\"c\\",\\"d\\",\\"5\\",\\"b\\",\\"f\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"9\\",\\"4\\",\\"2\\",\\"3\\",\\"2\\",\\"a\\",\\"7\\",\\"7\\",\\"-\\",\\"4\\",\\"2\\",\\"d\\",\\"1\\",\\"-\\",\\"4\\",\\"9\\",\\"8\\",\\"e\\",\\"-\\",\\"b\\",\\"a\\",\\"a\\",\\"2\\",\\"-\\",\\"5\\",\\"a\\",\\"1\\",\\"1\\",\\"3\\",\\"b\\",\\"b\\",\\"c\\",\\"d\\",\\"5\\",\\"b\\",\\"f\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"e\\",\\"p\\",\\"a\\",\\"r\\",\\"t\\",\\"m\\",\\"e\\",\\"n\\",\\"t\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"G\\",\\"e\\",\\"n\\",\\"e\\",\\"r\\",\\"a\\",\\"l\\",\\" \\",\\"M\\",\\"e\\",\\"d\\",\\"i\\",\\"c\\",\\"i\\",\\"n\\",\\"e\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"o\\",\\"c\\",\\"t\\",\\"o\\",\\"r\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"A\\",\\"d\\",\\"m\\",\\"i\\",\\"n\\",\\" \\",\\"K\\",\\"e\\",\\"m\\",\\"b\\",\\"e\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"1\\",\\"0\\",\\":\\",\\"1\\",\\"8\\",\\":\\",\\"5\\",\\"1\\",\\".\\",\\"4\\",\\"5\\",\\"8\\",\\"Z\\",\\"\\\\\\"\\",\\"}\\",\\"]\\",{\\"serviceName\\":\\"Blood Group & Rh Factor\\",\\"quantity\\":1,\\"unitPrice\\":0,\\"totalPrice\\":0},{\\"serviceName\\":\\"Hepatitis C Virus Antibody\\",\\"quantity\\":1,\\"unitPrice\\":0,\\"totalPrice\\":0}]"	Narting Abui Joseph	1	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	UNIVERSAL HOSPITAL STAFF	t	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	20000.00	0.00	2026-04-23	General physician services with Dr. Admin Kembe	Admin Kembe	\N
c2f7de2e-fadf-43bc-90f7-a7c664f08964	f13d0c29-3fef-494a-9642-2f390835d83f	\N	\N	\N	1	\N	70000.00	paid	2026-03-24 09:28:10.324483	\N	fb35bd38-6236-4594-a210-158da7071c78	credit	1	2026-03-24 09:28:10.313	2026-03-24 10:11:30.397	\N	BILL-2026-490294	2026-03-24	"\\"[{\\\\\\"name\\\\\\":\\\\\\"Consultaion GP\\\\\\",\\\\\\"serviceName\\\\\\":\\\\\\"Consultaion GP\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"Consultaion GP\\\\\\",\\\\\\"serviceId\\\\\\":\\\\\\"94232a77-42d1-498e-baa2-5a113bbcd5bf\\\\\\",\\\\\\"service_id\\\\\\":\\\\\\"94232a77-42d1-498e-baa2-5a113bbcd5bf\\\\\\",\\\\\\"department\\\\\\":\\\\\\"General Medicine\\\\\\",\\\\\\"doctor\\\\\\":\\\\\\"Poles Jago\\\\\\",\\\\\\"price\\\\\\":20000,\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":20000,\\\\\\"unit_price\\\\\\":20000,\\\\\\"totalPrice\\\\\\":20000,\\\\\\"total_price\\\\\\":20000,\\\\\\"date\\\\\\":\\\\\\"2026-03-24T09:28:10.149Z\\\\\\"},{\\\\\\"serviceId\\\\\\":\\\\\\"0b9d5901-aff4-48cf-8f16-74a0d158ef0e\\\\\\",\\\\\\"service_id\\\\\\":\\\\\\"0b9d5901-aff4-48cf-8f16-74a0d158ef0e\\\\\\",\\\\\\"serviceName\\\\\\":\\\\\\"X-Ray Chest\\\\\\",\\\\\\"name\\\\\\":\\\\\\"X-Ray Chest\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"X-Ray Chest\\\\\\",\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":0,\\\\\\"unit_price\\\\\\":0,\\\\\\"totalPrice\\\\\\":0,\\\\\\"total_price\\\\\\":0,\\\\\\"price\\\\\\":0,\\\\\\"date\\\\\\":\\\\\\"2026-03-24T09:28:41.180Z\\\\\\"},{\\\\\\"serviceId\\\\\\":\\\\\\"2944adb8-9408-4402-9788-fc90c82a2ce9\\\\\\",\\\\\\"service_id\\\\\\":\\\\\\"2944adb8-9408-4402-9788-fc90c82a2ce9\\\\\\",\\\\\\"serviceName\\\\\\":\\\\\\"Pelvis X-Ray\\\\\\",\\\\\\"name\\\\\\":\\\\\\"Pelvis X-Ray\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"Pelvis X-Ray\\\\\\",\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":0,\\\\\\"unit_price\\\\\\":0,\\\\\\"totalPrice\\\\\\":0,\\\\\\"total_price\\\\\\":0,\\\\\\"price\\\\\\":0,\\\\\\"date\\\\\\":\\\\\\"2026-03-24T09:42:04.236Z\\\\\\"},{\\\\\\"serviceId\\\\\\":\\\\\\"ef8e7b72-286d-4882-9c5a-75109aaed40c\\\\\\",\\\\\\"service_id\\\\\\":\\\\\\"ef8e7b72-286d-4882-9c5a-75109aaed40c\\\\\\",\\\\\\"serviceName\\\\\\":\\\\\\"Consultaion - Pediatric\\\\\\",\\\\\\"name\\\\\\":\\\\\\"Consultaion - Pediatric\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"Consultaion - Pediatric\\\\\\",\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":50000,\\\\\\"unit_price\\\\\\":50000,\\\\\\"totalPrice\\\\\\":50000,\\\\\\"total_price\\\\\\":50000,\\\\\\"price\\\\\\":50000,\\\\\\"date\\\\\\":\\\\\\"2026-03-24T09:46:46.539Z\\\\\\",\\\\\\"invoiced\\\\\\":false}]\\""	Narting Abui Joseph	1	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	UNIVERSAL HOSPITAL STAFF	t	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	70000.00	0.00	2026-04-23	General physician services with Dr. Poles Jago	Admin Kembe	\N
0028c2e4-05b8-455c-bfa1-e0a31ef75afd	80980441-a1c1-483f-8d56-d6ac83732cae	\N	\N	\N	1	\N	50000.00	paid	2026-03-31 10:59:21.65483	\N	\N	cash	1	2026-03-31 10:59:21.652	2026-03-31 10:59:26.568	\N	BILL-2026-761640	2026-03-31	"\\"[{\\\\\\"serviceName\\\\\\":\\\\\\"Consultation-Dental\\\\\\",\\\\\\"name\\\\\\":\\\\\\"Consultation-Dental\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"Consultation-Dental\\\\\\",\\\\\\"serviceId\\\\\\":\\\\\\"10ef842c-34c1-4993-b83c-0ec79087653d\\\\\\",\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":50000,\\\\\\"unit_price\\\\\\":50000,\\\\\\"totalPrice\\\\\\":50000,\\\\\\"total_price\\\\\\":50000,\\\\\\"price\\\\\\":50000,\\\\\\"date\\\\\\":\\\\\\"2026-03-31T10:59:21.613Z\\\\\\"}]\\""	Lil Been	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	50000.00	0.00	2026-04-30	Bill created from billing page	Admin Kembe	\N
a1288878-7b04-484f-a460-b4ec6d67a7ca	bbb36bc2-4834-4bfe-9b37-2311f79a716c	\N	\N	\N	1	\N	20000.00	paid	2026-03-24 10:31:33.107758	\N	\N	cash	1	2026-03-24 10:31:33.105	2026-03-31 10:50:52.955	\N	BILL-2026-293101	2026-03-24	"[{\\"serviceName\\":\\"Consultaion GP\\",\\"name\\":\\"Consultaion GP\\",\\"service_name\\":\\"Consultaion GP\\",\\"serviceId\\":\\"94232a77-42d1-498e-baa2-5a113bbcd5bf\\",\\"quantity\\":1,\\"unitPrice\\":20000,\\"unit_price\\":20000,\\"totalPrice\\":20000,\\"total_price\\":20000,\\"price\\":20000,\\"date\\":\\"2026-03-24T10:31:33.000Z\\",\\"status\\":\\"paid\\",\\"paid\\":true,\\"paidAt\\":\\"2026-03-31T10:50:52.955Z\\"},{\\"serviceName\\":\\"X-Ray Chest\\",\\"name\\":\\"X-Ray Chest\\",\\"service_name\\":\\"X-Ray Chest\\",\\"serviceId\\":\\"0b9d5901-aff4-48cf-8f16-74a0d158ef0e\\",\\"quantity\\":1,\\"unitPrice\\":0,\\"unit_price\\":0,\\"totalPrice\\":0,\\"total_price\\":0,\\"price\\":0,\\"date\\":\\"2026-03-24T10:31:33.000Z\\",\\"status\\":\\"paid\\",\\"paid\\":true,\\"paidAt\\":\\"2026-03-31T10:50:52.955Z\\"}]"	John Ohisa	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	20000.00	0.00	2026-04-23	Bill created from billing page	Admin Kembe	\N
27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	80980441-a1c1-483f-8d56-d6ac83732cae	\N	\N	\N	1	\N	70000.00	active	2026-03-24 09:12:54.201117	\N	780c717d-0a5d-44e5-b68f-25e93f0d53e4	credit	1	2026-03-24 09:12:54.179	2026-03-31 11:47:12.137	\N	BILL-2026-574166	2026-03-24	"[\\"[\\",\\"{\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"C\\",\\"o\\",\\"n\\",\\"s\\",\\"u\\",\\"l\\",\\"t\\",\\"a\\",\\"i\\",\\"o\\",\\"n\\",\\" \\",\\"G\\",\\"P\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"9\\",\\"4\\",\\"2\\",\\"3\\",\\"2\\",\\"a\\",\\"7\\",\\"7\\",\\"-\\",\\"4\\",\\"2\\",\\"d\\",\\"1\\",\\"-\\",\\"4\\",\\"9\\",\\"8\\",\\"e\\",\\"-\\",\\"b\\",\\"a\\",\\"a\\",\\"2\\",\\"-\\",\\"5\\",\\"a\\",\\"1\\",\\"1\\",\\"3\\",\\"b\\",\\"b\\",\\"c\\",\\"d\\",\\"5\\",\\"b\\",\\"f\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"2\\",\\"0\\",\\"0\\",\\"0\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"0\\",\\"9\\",\\":\\",\\"1\\",\\"2\\",\\":\\",\\"5\\",\\"4\\",\\".\\",\\"0\\",\\"9\\",\\"1\\",\\"Z\\",\\"\\\\\\"\\",\\"}\\",\\",\\",\\"{\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"0\\",\\"b\\",\\"9\\",\\"d\\",\\"5\\",\\"9\\",\\"0\\",\\"1\\",\\"-\\",\\"a\\",\\"f\\",\\"f\\",\\"4\\",\\"-\\",\\"4\\",\\"8\\",\\"c\\",\\"f\\",\\"-\\",\\"8\\",\\"f\\",\\"1\\",\\"6\\",\\"-\\",\\"7\\",\\"4\\",\\"a\\",\\"0\\",\\"d\\",\\"1\\",\\"5\\",\\"8\\",\\"e\\",\\"f\\",\\"0\\",\\"e\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"0\\",\\"b\\",\\"9\\",\\"d\\",\\"5\\",\\"9\\",\\"0\\",\\"1\\",\\"-\\",\\"a\\",\\"f\\",\\"f\\",\\"4\\",\\"-\\",\\"4\\",\\"8\\",\\"c\\",\\"f\\",\\"-\\",\\"8\\",\\"f\\",\\"1\\",\\"6\\",\\"-\\",\\"7\\",\\"4\\",\\"a\\",\\"0\\",\\"d\\",\\"1\\",\\"5\\",\\"8\\",\\"e\\",\\"f\\",\\"0\\",\\"e\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\" \\",\\"C\\",\\"h\\",\\"e\\",\\"s\\",\\"t\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\" \\",\\"C\\",\\"h\\",\\"e\\",\\"s\\",\\"t\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\" \\",\\"C\\",\\"h\\",\\"e\\",\\"s\\",\\"t\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"0\\",\\"9\\",\\":\\",\\"1\\",\\"3\\",\\":\\",\\"0\\",\\"5\\",\\".\\",\\"0\\",\\"7\\",\\"7\\",\\"Z\\",\\"\\\\\\"\\",\\"}\\",\\",\\",\\"{\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"e\\",\\"2\\",\\"5\\",\\"8\\",\\"9\\",\\"1\\",\\"b\\",\\"7\\",\\"-\\",\\"5\\",\\"e\\",\\"8\\",\\"3\\",\\"-\\",\\"4\\",\\"e\\",\\"b\\",\\"c\\",\\"-\\",\\"9\\",\\"d\\",\\"8\\",\\"c\\",\\"-\\",\\"2\\",\\"9\\",\\"9\\",\\"9\\",\\"3\\",\\"0\\",\\"d\\",\\"f\\",\\"2\\",\\"d\\",\\"a\\",\\"9\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"e\\",\\"2\\",\\"5\\",\\"8\\",\\"9\\",\\"1\\",\\"b\\",\\"7\\",\\"-\\",\\"5\\",\\"e\\",\\"8\\",\\"3\\",\\"-\\",\\"4\\",\\"e\\",\\"b\\",\\"c\\",\\"-\\",\\"9\\",\\"d\\",\\"8\\",\\"c\\",\\"-\\",\\"2\\",\\"9\\",\\"9\\",\\"9\\",\\"3\\",\\"0\\",\\"d\\",\\"f\\",\\"2\\",\\"d\\",\\"a\\",\\"9\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"K\\",\\"N\\",\\"E\\",\\"E\\",\\" \\",\\"J\\",\\"N\\",\\"T\\",\\" \\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"K\\",\\"N\\",\\"E\\",\\"E\\",\\" \\",\\"J\\",\\"N\\",\\"T\\",\\" \\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"K\\",\\"N\\",\\"E\\",\\"E\\",\\" \\",\\"J\\",\\"N\\",\\"T\\",\\" \\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"0\\",\\"9\\",\\":\\",\\"1\\",\\"3\\",\\":\\",\\"1\\",\\"4\\",\\".\\",\\"6\\",\\"4\\",\\"8\\",\\"Z\\",\\"\\\\\\"\\",\\"}\\",\\",\\",\\"{\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"0\\",\\"8\\",\\"d\\",\\"b\\",\\"e\\",\\"7\\",\\"3\\",\\"4\\",\\"-\\",\\"5\\",\\"9\\",\\"a\\",\\"a\\",\\"-\\",\\"4\\",\\"e\\",\\"3\\",\\"4\\",\\"-\\",\\"a\\",\\"3\\",\\"2\\",\\"9\\",\\"-\\",\\"2\\",\\"4\\",\\"1\\",\\"9\\",\\"6\\",\\"5\\",\\"9\\",\\"9\\",\\"e\\",\\"3\\",\\"4\\",\\"6\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"0\\",\\"8\\",\\"d\\",\\"b\\",\\"e\\",\\"7\\",\\"3\\",\\"4\\",\\"-\\",\\"5\\",\\"9\\",\\"a\\",\\"a\\",\\"-\\",\\"4\\",\\"e\\",\\"3\\",\\"4\\",\\"-\\",\\"a\\",\\"3\\",\\"2\\",\\"9\\",\\"-\\",\\"2\\",\\"4\\",\\"1\\",\\"9\\",\\"6\\",\\"5\\",\\"9\\",\\"9\\",\\"e\\",\\"3\\",\\"4\\",\\"6\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"L\\",\\"E\\",\\"G\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"L\\",\\"E\\",\\"G\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"L\\",\\"E\\",\\"G\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"0\\",\\"9\\",\\":\\",\\"1\\",\\"3\\",\\":\\",\\"1\\",\\"4\\",\\".\\",\\"6\\",\\"4\\",\\"8\\",\\"Z\\",\\"\\\\\\"\\",\\"}\\",\\",\\",\\"{\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"b\\",\\"7\\",\\"b\\",\\"a\\",\\"2\\",\\"f\\",\\"a\\",\\"7\\",\\"-\\",\\"8\\",\\"d\\",\\"9\\",\\"1\\",\\"-\\",\\"4\\",\\"8\\",\\"1\\",\\"5\\",\\"-\\",\\"9\\",\\"5\\",\\"5\\",\\"5\\",\\"-\\",\\"8\\",\\"5\\",\\"1\\",\\"8\\",\\"c\\",\\"f\\",\\"4\\",\\"2\\",\\"a\\",\\"9\\",\\"d\\",\\"2\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"b\\",\\"7\\",\\"b\\",\\"a\\",\\"2\\",\\"f\\",\\"a\\",\\"7\\",\\"-\\",\\"8\\",\\"d\\",\\"9\\",\\"1\\",\\"-\\",\\"4\\",\\"8\\",\\"1\\",\\"5\\",\\"-\\",\\"9\\",\\"5\\",\\"5\\",\\"5\\",\\"-\\",\\"8\\",\\"5\\",\\"1\\",\\"8\\",\\"c\\",\\"f\\",\\"4\\",\\"2\\",\\"a\\",\\"9\\",\\"d\\",\\"2\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"N\\",\\"e\\",\\"c\\",\\"k\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"N\\",\\"e\\",\\"c\\",\\"k\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"N\\",\\"e\\",\\"c\\",\\"k\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"0\\",\\"9\\",\\":\\",\\"5\\",\\"3\\",\\":\\",\\"4\\",\\"9\\",\\".\\",\\"3\\",\\"9\\",\\"2\\",\\"Z\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"i\\",\\"n\\",\\"v\\",\\"o\\",\\"i\\",\\"c\\",\\"e\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"f\\",\\"a\\",\\"l\\",\\"s\\",\\"e\\",\\"}\\",\\",\\",\\"{\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"I\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"9\\",\\"4\\",\\"4\\",\\"a\\",\\"d\\",\\"b\\",\\"8\\",\\"-\\",\\"9\\",\\"4\\",\\"0\\",\\"8\\",\\"-\\",\\"4\\",\\"4\\",\\"0\\",\\"2\\",\\"-\\",\\"9\\",\\"7\\",\\"8\\",\\"8\\",\\"-\\",\\"f\\",\\"c\\",\\"9\\",\\"0\\",\\"c\\",\\"8\\",\\"2\\",\\"a\\",\\"2\\",\\"c\\",\\"e\\",\\"9\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"i\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"9\\",\\"4\\",\\"4\\",\\"a\\",\\"d\\",\\"b\\",\\"8\\",\\"-\\",\\"9\\",\\"4\\",\\"0\\",\\"8\\",\\"-\\",\\"4\\",\\"4\\",\\"0\\",\\"2\\",\\"-\\",\\"9\\",\\"7\\",\\"8\\",\\"8\\",\\"-\\",\\"f\\",\\"c\\",\\"9\\",\\"0\\",\\"c\\",\\"8\\",\\"2\\",\\"a\\",\\"2\\",\\"c\\",\\"e\\",\\"9\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"N\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"P\\",\\"e\\",\\"l\\",\\"v\\",\\"i\\",\\"s\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"P\\",\\"e\\",\\"l\\",\\"v\\",\\"i\\",\\"s\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"s\\",\\"e\\",\\"r\\",\\"v\\",\\"i\\",\\"c\\",\\"e\\",\\"_\\",\\"n\\",\\"a\\",\\"m\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"P\\",\\"e\\",\\"l\\",\\"v\\",\\"i\\",\\"s\\",\\" \\",\\"X\\",\\"-\\",\\"R\\",\\"a\\",\\"y\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"q\\",\\"u\\",\\"a\\",\\"n\\",\\"t\\",\\"i\\",\\"t\\",\\"y\\",\\"\\\\\\"\\",\\":\\",\\"1\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"u\\",\\"n\\",\\"i\\",\\"t\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"P\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"t\\",\\"o\\",\\"t\\",\\"a\\",\\"l\\",\\"_\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"p\\",\\"r\\",\\"i\\",\\"c\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"0\\",\\",\\",\\"\\\\\\"\\",\\"d\\",\\"a\\",\\"t\\",\\"e\\",\\"\\\\\\"\\",\\":\\",\\"\\\\\\"\\",\\"2\\",\\"0\\",\\"2\\",\\"6\\",\\"-\\",\\"0\\",\\"3\\",\\"-\\",\\"2\\",\\"4\\",\\"T\\",\\"0\\",\\"9\\",\\":\\",\\"5\\",\\"3\\",\\":\\",\\"4\\",\\"9\\",\\".\\",\\"3\\",\\"9\\",\\"2\\",\\"Z\\",\\"\\\\\\"\\",\\",\\",\\"\\\\\\"\\",\\"i\\",\\"n\\",\\"v\\",\\"o\\",\\"i\\",\\"c\\",\\"e\\",\\"d\\",\\"\\\\\\"\\",\\":\\",\\"f\\",\\"a\\",\\"l\\",\\"s\\",\\"e\\",\\"}\\",\\"]\\",{\\"serviceId\\":\\"10ef842c-34c1-4993-b83c-0ec79087653d\\",\\"service_id\\":\\"10ef842c-34c1-4993-b83c-0ec79087653d\\",\\"serviceName\\":\\"Consultation-Dental\\",\\"name\\":\\"Consultation-Dental\\",\\"service_name\\":\\"Consultation-Dental\\",\\"quantity\\":1,\\"unitPrice\\":50000,\\"unit_price\\":50000,\\"totalPrice\\":50000,\\"total_price\\":50000,\\"price\\":50000,\\"date\\":\\"2026-03-31T11:47:12.056Z\\",\\"invoiced\\":false}]"	Lil Been	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	0.00	70000.00	2026-04-23	Bill created from billing page	Admin Kembe	\N
95cf980c-2ecb-4da1-9c36-81d821b63e5d	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	\N	\N	\N	1	\N	50000.00	paid	2026-03-31 11:47:54.420781	\N	\N	cash	1	2026-03-31 11:47:54.406	2026-03-31 11:48:05.809	\N	BILL-2026-674396	2026-03-31	"\\"[{\\\\\\"serviceName\\\\\\":\\\\\\"Consultation-Dermatology & Venereology\\\\\\",\\\\\\"name\\\\\\":\\\\\\"Consultation-Dermatology & Venereology\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"Consultation-Dermatology & Venereology\\\\\\",\\\\\\"serviceId\\\\\\":\\\\\\"3a565bfe-26d1-4b7d-8687-4d5e81d66f0e\\\\\\",\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":50000,\\\\\\"unit_price\\\\\\":50000,\\\\\\"totalPrice\\\\\\":50000,\\\\\\"total_price\\\\\\":50000,\\\\\\"price\\\\\\":50000,\\\\\\"date\\\\\\":\\\\\\"2026-03-31T11:47:54.362Z\\\\\\"}]\\""	Maria Anthony	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	50000.00	0.00	2026-04-30	Bill created from billing page	Admin Kembe	\N
3b00ee38-4269-4db6-9e7d-66deb311d3ea	bbb36bc2-4834-4bfe-9b37-2311f79a716c	\N	\N	\N	1	\N	28000.00	pending	2026-04-06 16:04:37.509467	\N	\N	cash	\N	2026-04-06 16:04:37.509467	2026-04-06 16:04:37.509467	\N	BILL-2026-477491	2026-04-06	[{"service":"absorbent gauze sponge","quantity":2,"price":4000,"total":8000},{"service":"abnal","quantity":2,"price":10000,"total":20000}]	John Ohisa	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	0.00	28000.00	2026-05-06	\N	system	\N
81bc2d45-ee9a-4245-846a-515ddf4e6d83	f13d0c29-3fef-494a-9642-2f390835d83f	\N	\N	\N	1	\N	19000.00	pending	2026-04-06 16:09:32.573259	\N	\N	cash	\N	2026-04-06 16:09:32.573259	2026-04-06 16:09:32.573259	\N	BILL-2026-772569	2026-04-06	[{"service":"abnal","quantity":1,"price":10000,"total":10000},{"service":"Aciclovir","quantity":1,"price":5000,"total":5000},{"service":"absorbent gauze sponge","quantity":1,"price":4000,"total":4000}]	Narting Abui Joseph	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	0.00	19000.00	2026-05-06	\N	system	\N
b945c6d0-e80f-4d44-b96e-85f2cb456107	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	\N	\N	\N	1	\N	20000.00	paid	2026-04-03 01:42:28.946491	\N	\N	cash	1	2026-04-03 01:42:28.936	2026-04-06 18:47:16.099	\N	BILL-2026-548843	2026-04-03	"\\"[{\\\\\\"name\\\\\\":\\\\\\"Consultation-GP\\\\\\",\\\\\\"serviceName\\\\\\":\\\\\\"Consultation-GP\\\\\\",\\\\\\"service_name\\\\\\":\\\\\\"Consultation-GP\\\\\\",\\\\\\"serviceId\\\\\\":\\\\\\"0d0d3797-6cc5-4635-a290-0547b8a10054\\\\\\",\\\\\\"service_id\\\\\\":\\\\\\"0d0d3797-6cc5-4635-a290-0547b8a10054\\\\\\",\\\\\\"department\\\\\\":\\\\\\"General Medicine\\\\\\",\\\\\\"doctor\\\\\\":\\\\\\"Peter Vuni\\\\\\",\\\\\\"price\\\\\\":20000,\\\\\\"quantity\\\\\\":1,\\\\\\"unitPrice\\\\\\":20000,\\\\\\"unit_price\\\\\\":20000,\\\\\\"totalPrice\\\\\\":20000,\\\\\\"total_price\\\\\\":20000,\\\\\\"date\\\\\\":\\\\\\"2026-04-03T01:42:28.384Z\\\\\\"}]\\""	Maria Anthony	1	\N	\N	f	SSP	1.000000	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	0.00	\N	\N	\N	\N	0.00	\N	\N	\N	0.00	0.00	f	\N	\N	immediate	\N	\N	0	f	f	\N	\N	0.00	\N	current	\N	f	\N	\N	20000.00	0.00	2026-05-03	General physician services with Dr. Peter Vuni	Admin Kembe	\N
\.


--
-- Data for Name: patient_insurance; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patient_insurance (id, clinic_id, patient_id, insurance_type, insurance_provider, member_id, member_name, nhif_member_number, nhif_status, nhif_card_number, effective_from, effective_to, is_active, copay_percentage, copay_max_per_visit, created_at, updated_at, scheme_id) FROM stdin;
\.


--
-- Data for Name: patient_queue; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patient_queue (id, patient_id, visit_id, queue_type, status, priority, assigned_to, notes, branch_id, created_at, updated_at, clinic_id) FROM stdin;
1d1b153f-f452-4dba-ac94-e47d48f08c5d	351c434f-778f-4162-8285-3edbf1e81039	\N	consultation	completed	2	\N		1	2026-03-23 21:26:22.971	2026-03-24 10:18:00.338	1
ffd13075-9a78-45a3-a927-27fc631cc835	bbb36bc2-4834-4bfe-9b37-2311f79a716c	\N	consultation	completed	1	\N		1	2026-03-24 07:47:44.728	2026-03-24 10:18:04.603	1
63258d95-d363-497c-a795-b9e40f48ceb4	351c434f-778f-4162-8285-3edbf1e81039	\N	consultation	completed	2	\N		1	2026-03-23 21:28:49.846	2026-03-24 10:18:08.05	1
0359edf0-67a1-46d5-a7b1-1a78b92d3e6c	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	\N	consultation	completed	3	\N	please attent	1	2026-03-23 21:25:21.515	2026-03-24 10:18:10.8	1
3184925b-114a-4b73-828f-a2b3ae603219	80980441-a1c1-483f-8d56-d6ac83732cae	\N	consultation	completed	2	\N		1	2026-03-23 21:33:07.206	2026-03-24 10:18:13.749	1
77bd96b0-1bc2-4998-87ab-5d230b1d953b	fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	\N	consultation	completed	2	\N		1	2026-03-23 21:45:24.42	2026-03-24 10:18:16.685	1
5ed2a5fd-7e5f-4e61-9fcf-3f4eb4c43a2c	80980441-a1c1-483f-8d56-d6ac83732cae	\N	consultation	completed	2	\N		1	2026-03-23 21:30:20.367	2026-03-24 10:18:19.467	1
917d3ea2-1fba-422e-a11c-a347ce45d9cd	80980441-a1c1-483f-8d56-d6ac83732cae	\N	consultation	completed	2	\N		1	2026-03-23 21:37:17.726	2026-03-24 10:18:22.939	1
b79afce9-0e7e-4b69-bd1a-fc69a381ab3c	fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	\N	consultation	completed	2	\N		1	2026-03-23 21:38:25.12	2026-03-24 10:18:27.569	1
a7ded5fe-c7a7-40fd-9593-51b2c3d3f65a	f13d0c29-3fef-494a-9642-2f390835d83f	\N	consultation	completed	1	\N		1	2026-03-24 09:28:10.189	2026-03-24 10:18:31.37	1
0d326f18-1696-45f5-82b2-c61cb56d0eb7	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	\N	consultation	waiting	1	\N		1	2026-04-03 01:42:28.496	2026-04-03 01:42:28.496	1
3541f258-2ce4-436a-a1ba-a4093e144d84	d847f88c-e89d-444e-bf03-c15aed4b1d10	\N	consultation	completed	1	\N		1	2026-03-30 16:58:27.844	2026-04-06 10:28:19.927	1
f0654b32-9d89-4217-b2a2-f68f602a94fc	f13d0c29-3fef-494a-9642-2f390835d83f	\N	consultation	completed	1	\N		1	2026-03-24 10:18:51.477	2026-04-06 10:28:25.23	1
\.


--
-- Data for Name: patient_receivables; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patient_receivables (id, clinic_id, patient_id, bill_id, bill_number, service_date, bill_date, due_date, service_description, service_amount, amount_due, amount_paid, amount_adjusted, status, days_overdue, last_payment_date, gl_entry_id, created_at, updated_at) FROM stdin;
c76ebc8e-5f05-4f7a-99e4-68f2bcaf6e52	1	fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	413451c3-c20b-4558-b711-92d398c8a664	BILL-2026-324812	2026-03-23	2026-03-23	2026-04-22	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	79e3eabe-df95-40ae-9eb7-f9ecc998777b	2026-03-23 21:45:25.683	2026-03-23 21:45:25.683
62c551b4-9128-4a8f-9dc0-d1b524f1fa72	1	bbb36bc2-4834-4bfe-9b37-2311f79a716c	5e631277-4e10-4cf0-8329-a989ca959d7f	BILL-2026-464836	2026-03-24	2026-03-24	2026-04-23	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	953de3f2-11b9-412e-b2d9-2cb37893014f	2026-03-24 07:47:45.001	2026-03-24 07:47:45.001
cebfe10d-37a1-4602-a779-b2abdcace621	1	bbb36bc2-4834-4bfe-9b37-2311f79a716c	2628dd55-5807-4e83-90ef-3543ed332f92	BILL-2026-350265	2026-03-24	2026-03-24	2026-04-23	Patient services	50000.00	50000.00	0.00	0.00	pending	0	\N	126ff051-4ea5-4ec4-bc57-0fc48576aa15	2026-03-24 08:52:30.473	2026-03-24 08:52:30.473
8b13b1df-ec52-4beb-84b4-20df9c956ebe	1	80980441-a1c1-483f-8d56-d6ac83732cae	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	BILL-2026-574166	2026-03-24	2026-03-24	2026-04-23	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	a549c852-a2b1-441a-9fb1-e4c97a000e35	2026-03-24 09:12:54.342	2026-03-24 09:12:54.342
7536bdb8-b42a-44c5-8d17-ec326d058288	1	f13d0c29-3fef-494a-9642-2f390835d83f	c2f7de2e-fadf-43bc-90f7-a7c664f08964	BILL-2026-490294	2026-03-24	2026-03-24	2026-04-23	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	46a97acd-3966-4fbf-8787-4cfce70c881a	2026-03-24 09:28:10.402	2026-03-24 09:28:10.402
1d0d090e-3ef4-422d-96c6-c601cc1e5701	1	f13d0c29-3fef-494a-9642-2f390835d83f	5efd31a9-5c99-4933-acec-c97f70d974aa	BILL-2026-531501	2026-03-24	2026-03-24	2026-04-23	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	bcafef8e-8a72-4b16-9057-4253546b3f21	2026-03-24 10:18:51.625	2026-03-24 10:18:51.625
2b7c8db7-fafa-4705-81e2-6b189a43cca0	1	bbb36bc2-4834-4bfe-9b37-2311f79a716c	a1288878-7b04-484f-a460-b4ec6d67a7ca	BILL-2026-293101	2026-03-24	2026-03-24	2026-04-23	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	883cb645-96d2-481c-a47c-ce83ed8cc51e	2026-03-24 10:31:33.2	2026-03-24 10:31:33.2
7b47a4d9-b8a2-46bf-9cf3-2d2383649d24	1	d847f88c-e89d-444e-bf03-c15aed4b1d10	69125236-c7b5-4aa8-a221-891e07ec2067	BILL-2026-907966	2026-03-30	2026-03-30	2026-04-29	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	c9fe63a2-077f-4954-aa91-e428ebef702b	2026-03-30 16:58:28.397	2026-03-30 16:58:28.397
3ffe9b90-91ea-4585-aaea-1620d18a161c	1	80980441-a1c1-483f-8d56-d6ac83732cae	0028c2e4-05b8-455c-bfa1-e0a31ef75afd	BILL-2026-761640	2026-03-31	2026-03-31	2026-04-30	Patient services	50000.00	50000.00	0.00	0.00	pending	0	\N	ef27ae78-8dd3-469d-b497-057cfb234f8a	2026-03-31 10:59:21.721	2026-03-31 10:59:21.721
b0e0de19-21b7-4dd2-b489-039264bee98e	1	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	95cf980c-2ecb-4da1-9c36-81d821b63e5d	BILL-2026-674396	2026-03-31	2026-03-31	2026-04-30	Patient services	50000.00	50000.00	0.00	0.00	pending	0	\N	5f8d3e77-bbe5-436b-810f-a6eeaee19317	2026-03-31 11:47:54.579	2026-03-31 11:47:54.579
c90361cf-2b42-42e4-bbef-865f3ceb3fe2	1	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	b945c6d0-e80f-4d44-b96e-85f2cb456107	BILL-2026-548843	2026-04-03	2026-04-03	2026-05-03	Patient services	20000.00	20000.00	0.00	0.00	pending	0	\N	e693d4b0-a161-49ec-9716-674f5270835f	2026-04-03 01:42:29.183	2026-04-03 01:42:29.183
\.


--
-- Data for Name: patient_schemes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patient_schemes (id, clinic_id, scheme_code, scheme_name, scheme_description, scheme_type, is_default, is_active, requires_verification, requires_approval, pricing_strategy, base_markup_percentage, base_discount_percentage, is_insurance, insurance_provider_name, insurance_provider_code, requires_authorization, has_copay, default_copay_percentage, copay_cap_per_visit, payment_terms, is_credit_allowed, credit_limit, requires_deposit, deposit_amount, revenue_account_id, discount_account_id, approval_required_above, allows_negotiation, contact_person, contact_phone, contact_email, website, notes, created_by, created_at, updated_at, currency) FROM stdin;
22ff16e0-ff80-4d87-b1b4-9dca41c7f870	1	UHS	UNIVERSAL HOSPITAL STAFF	This isfor the UNIVERSAL HOSPITAL STAFF	corporate	f	t	f	f	fixed	0.00	0.00	f	\N	\N	f	t	10.00	\N	immediate	t	0.00	f	\N	\N	\N	\N	f	\N	\N	\N	\N	\N	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-24 09:26:59.220431	2026-03-24 09:26:59.220431	SSP
\.


--
-- Data for Name: patients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patients (id, patient_id, first_name, last_name, date_of_birth, gender, phone, address, clinic, registered_at, registered_by, branch_id, created_at, updated_at, email, emergency_contact, blood_group, allergies, medical_history, default_scheme_id, clinic_id, phone_number, next_of_kin_name, next_of_kin_phone, insurance_type, insurance_number, registration_date) FROM stdin;
1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	UH-473105	Maria	Anthony	1992-01-01	female	\N		IntelliCare	2026-03-23 15:16:54.782608	\N	1	2026-03-23 15:16:54.775	2026-03-23 15:16:54.775	\N	\N	\N	\N	\N	\N	6	0922328046	\N	\N	\N	\N	2026-03-23 15:16:54.731
351c434f-778f-4162-8285-3edbf1e81039	UH-436374	Mami	thomas	1977-01-01	female	\N		IntelliCare	2026-03-23 21:26:14.506389	\N	1	2026-03-23 21:26:14.435	2026-03-23 21:26:14.435	\N	\N	\N	\N	\N	\N	6	0922382902	\N	\N	\N	\N	2026-03-23 21:26:14.363
80980441-a1c1-483f-8d56-d6ac83732cae	UH-314647	Lil	Been	1977-01-01	male	\N		IntelliCare	2026-03-23 21:30:13.175379	\N	1	2026-03-23 21:30:13.16	2026-03-23 21:30:13.16	\N	\N	\N	\N	\N	\N	6	0922883922	\N	\N	\N	\N	2026-03-23 21:30:13.146
fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	UH-230039	Single	Dee	1996-01-01	male	\N		IntelliCare	2026-03-23 21:38:12.374205	\N	1	2026-03-23 21:38:12.348	2026-03-23 21:38:12.348	\N	\N	\N	\N	\N	\N	6		\N	\N	\N	\N	2026-03-23 21:38:12.3
bbb36bc2-4834-4bfe-9b37-2311f79a716c	UH-606220	John	Ohisa	1966-01-01	male	\N		IntelliCare	2026-03-24 07:47:36.122251	\N	1	2026-03-24 07:47:36.105	2026-03-24 07:47:36.105	\N	\N	\N	\N	\N	\N	6		\N	\N	\N	\N	2026-03-24 07:47:36.062
f13d0c29-3fef-494a-9642-2f390835d83f	UH-069947	Narting	Abui Joseph	1989-01-01	male	\N		IntelliCare	2026-03-24 09:28:00.75514	\N	1	2026-03-24 09:28:00.733	2026-03-24 09:28:00.733	\N	\N	\N	\N	\N	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	6		\N	\N	\N	\N	2026-03-24 09:28:00.699
d847f88c-e89d-444e-bf03-c15aed4b1d10	UH-347743	Martin	Ssebuga	2002-01-01	male	\N		IntelliCare	2026-03-30 16:57:13.797279	\N	1	2026-03-30 16:57:13.61	2026-03-30 16:57:13.61	\N	\N	\N	\N	\N	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	6	09	\N	\N	\N	\N	2026-03-30 16:57:13.479
\.


--
-- Data for Name: pharmacy_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pharmacy_audit_log (id, clinic_id, action_type, reference_id, action_by, action_date, action_details, reason_for_action, created_at) FROM stdin;
bbc1b4de-2fc6-4c2a-ae21-a78654fbb2de	1	dispensed	DISP-202603-0001	\N	2026-03-30 10:41:50.67825	{"drug":"P-Alaxine","qty":20,"price":0,"batch":"OPEN-gd-2026-03-26"}	\N	2026-03-30 10:41:50.67825
d6ef9d1e-bcca-417a-927a-0816638cc9db	1	dispensed	DISP-202604-0001	\N	2026-04-06 16:04:37.308926	{"drug":"absorbent gauze sponge","qty":2,"price":8000}	\N	2026-04-06 16:04:37.308926
3c1da3a0-a80d-4776-9e1a-4fe711a32b22	1	dispensed	DISP-202604-0011	\N	2026-04-06 16:04:37.702465	{"drug":"abnal","qty":2,"price":20000}	\N	2026-04-06 16:04:37.702465
abe081c3-0740-42d8-bb47-0562e50eb043	1	dispensed	DISP-202604-0021	\N	2026-04-06 16:09:32.473106	{"drug":"abnal","qty":1,"price":10000}	\N	2026-04-06 16:09:32.473106
a77ac682-8f3f-4658-9558-a77d8db55891	1	dispensed	DISP-202604-0031	\N	2026-04-06 16:09:32.699336	{"drug":"Aciclovir","qty":1,"price":5000}	\N	2026-04-06 16:09:32.699336
f245c63e-2b3a-4efd-b771-dcb491294f17	1	dispensed	DISP-202604-0041	\N	2026-04-06 16:11:20.245475	{"drug":"absorbent gauze sponge","qty":1,"price":4000}	\N	2026-04-06 16:11:20.245475
\.


--
-- Data for Name: pharmacy_charges; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pharmacy_charges (id, clinic_id, charge_number, patient_id, dispensing_record_id, bill_id, bill_item_id, charge_date, drug_name, quantity_dispensed, unit_price, charge_amount, currency_code, insurance_type, patient_copay, insurance_portion, applied_price_type, is_billed, billing_date, payment_status, revenue_gl_entry_id, cogs_gl_entry_id, receivables_gl_entry_id, notes, created_at, branch_id) FROM stdin;
2e0bddbd-5f5a-4a1e-9131-8c4faccaec9b	1	CHG-DISP-202604-0001	bbb36bc2-4834-4bfe-9b37-2311f79a716c	380b181c-b1f2-4218-a9ce-5debbf147fcc	\N	\N	2026-04-06	absorbent gauze sponge	2	4000.00	8000.00	SSP	\N	0.00	0.00	cash	f	\N	pending	\N	\N	\N	\N	2026-04-06 16:04:37.308926	\N
7aab5e9f-0718-452d-a9f4-ffe1ac57a1e6	1	CHG-DISP-202604-0011	bbb36bc2-4834-4bfe-9b37-2311f79a716c	eaa17c42-cefe-4029-a8aa-5848e56bfb2e	\N	\N	2026-04-06	abnal	2	10000.00	20000.00	SSP	\N	0.00	0.00	cash	t	2026-04-06	invoiced	\N	\N	\N	\N	2026-04-06 16:04:37.702465	\N
30400e2f-cb8b-480e-a635-748c7abd76e3	1	CHG-DISP-202604-0021	f13d0c29-3fef-494a-9642-2f390835d83f	672bf401-1652-42dd-9f04-00c85973ee37	\N	\N	2026-04-06	abnal	1	10000.00	10000.00	SSP	\N	0.00	0.00	cash	f	\N	pending	\N	\N	\N	\N	2026-04-06 16:09:32.473106	\N
d6989843-bd7b-4ad5-97a7-28df38f6603b	1	CHG-DISP-202604-0031	f13d0c29-3fef-494a-9642-2f390835d83f	ee90500a-d854-4eeb-b461-a1240f0b043d	\N	\N	2026-04-06	Aciclovir	1	5000.00	5000.00	SSP	\N	0.00	0.00	cash	t	2026-04-06	paid	\N	\N	\N	\N	2026-04-06 16:09:32.699336	\N
d6743dc0-4e2a-4830-8918-0763e70cc79c	1	CHG-DISP-202604-0041	f13d0c29-3fef-494a-9642-2f390835d83f	0d1ca60b-edee-49af-aa8b-669fd53b1746	\N	\N	2026-04-06	absorbent gauze sponge	1	4000.00	4000.00	SSP	\N	0.00	0.00	cash	f	\N	pending	\N	\N	\N	\N	2026-04-06 16:11:20.245475	\N
\.


--
-- Data for Name: pharmacy_dispensing; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pharmacy_dispensing (id, drug_id, drug_name, patient_id, patient_name, visit_id, quantity, prescribed_by, dispensed_by, dispensed_at, clinic, branch_id, created_at, updated_at, clinic_id) FROM stdin;
\.


--
-- Data for Name: pharmacy_insurance_pricing; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pharmacy_insurance_pricing (id, clinic_id, drug_id, insurance_type, unit_price, currency_code, patient_copay, insurance_covers, effective_from, effective_to, created_at) FROM stdin;
\.


--
-- Data for Name: pharmacy_prescriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pharmacy_prescriptions (id, clinic_id, prescription_number, visit_id, patient_id, doctor_id, prescription_date, prescribed_by_name, prescription_notes, special_instructions, status, cancelled_date, cancellation_reason, expires_date, valid_for_days, number_of_refills_allowed, allergy_check_done, allergy_check_date, allergy_check_by_id, allergy_warnings, interaction_check_done, interaction_check_date, interaction_warnings, created_at, updated_at, branch_id) FROM stdin;
\.


--
-- Data for Name: pharmacy_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pharmacy_settings (id, clinic_id, allow_partial_dispensing, require_allergy_check, require_interaction_check, require_patient_counselling, auto_check_stock_before_dispensing, warn_if_stock_below_days, auto_reserve_stock_on_prescription, default_pharmacy_location_id, default_markup_percentage, round_to_nearest, include_tax_in_price, default_tax_rate, default_dispensing_currency, accept_usd_payments, accept_ssp_payments, auto_create_bill_on_dispensing, auto_charge_amount, bill_immediately, require_bill_approval_above, allow_returns, return_window_days, auto_reverse_inventory_on_return, pharmacy_revenue_account_id, pharmacy_cogs_account_id, pharmacy_discount_account_id, pharmacy_receivables_account_id, updated_at) FROM stdin;
\.


--
-- Data for Name: physical_count_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.physical_count_lines (id, count_id, item_id, location_id, batch_id, system_quantity, counted_quantity, variance, counted_by, count_time, notes, created_at) FROM stdin;
\.


--
-- Data for Name: physical_inventory_counts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.physical_inventory_counts (id, clinic_id, count_number, count_date, count_type, location_id, total_items_counted, total_items_system, variance_count, variance_percentage, status, completed_by, completed_date, created_by, created_at, branch_id) FROM stdin;
\.


--
-- Data for Name: pr_line_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pr_line_items (id, pr_id, line_number, item_code, item_description, item_specification, quantity_required, unit_of_measure, estimated_unit_price, estimated_line_total, notes, created_at, updated_at) FROM stdin;
7bb16e9b-1b12-4dbb-be46-741ccf069e91	7d725b0f-4966-4dcf-9d58-16014f9e37ce	1	m10	Paracetamol	\N	10	pcs	8000.00	80000.00	\N	2026-03-27 12:05:53.880611	2026-03-27 12:05:53.880611
\.


--
-- Data for Name: prescription_lines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.prescription_lines (id, prescription_id, line_number, drug_id, quantity_prescribed, unit_of_measure, dose_strength, frequency, duration_days, allow_generic_substitution, allow_brand_substitution, preferred_generic, preferred_brand, status, total_quantity_dispensed, notes, created_at) FROM stdin;
\.


--
-- Data for Name: prescriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.prescriptions (id, patient_id, visit_id, drug_name, dosage, frequency, duration, quantity, instructions, prescribed_by, prescribed_at, status, branch_id, created_at, updated_at, clinic_id) FROM stdin;
4a3bfa26-1f09-41b1-9b17-fe7e1cb2cc97	f13d0c29-3fef-494a-9642-2f390835d83f	c5e724d8-5eaf-432c-aedb-2e53574dee8d	P-Alaxine	2	2	5	20	\N	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-26 09:07:18.708	completed	1	2026-03-26 09:07:18.912	2026-03-26 09:07:18.912	1
\.


--
-- Data for Name: procurement_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.procurement_settings (id, clinic_id, pr_approval_threshold, po_approval_threshold_level1, po_approval_threshold_level2, po_approval_threshold_level3, require_grn_before_invoice, require_3way_matching, allow_over_receipt_percentage, allow_price_variance_percentage, require_quotes_for_amount_above, min_suppliers_for_quotes, enforce_budget_before_po, default_lead_days, default_payment_terms, updated_at) FROM stdin;
\.


--
-- Data for Name: purchase_order_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.purchase_order_items (id, purchase_order_id, item_name, description, quantity, unit_price, total_price, unit_of_measure, created_at, updated_at, line_number, quantity_received, quantity_invoiced, tax_amount, cost_center_id, gl_account_id, status, inventory_item_id, inventory_location_id) FROM stdin;
1	1	Paracetamol	\N	10	8000.00	80000.00	pcs	2026-03-27 14:06:57.830383+02	2026-03-27 14:36:02.18122+02	1	10	0	0.00	\N	\N	complete	\N	\N
\.


--
-- Data for Name: purchase_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.purchase_orders (id, po_number, supplier_id, order_date, total_amount, status, notes, check_signature, check_signed_by, check_signed_at, approved_signature, approved_signed_by, approved_signed_at, authorized_signature, authorized_signed_by, authorized_signed_at, created_at, updated_at, clinic_id, pr_id, po_type, delivery_address, requested_delivery_date, expected_delivery_date, delivery_date_actual, subtotal, tax_amount, tax_rate, shipping_cost, po_currency, exchange_rate, base_currency_total, payment_terms, terms_conditions, created_by, paid_amount, payment_status) FROM stdin;
1	PO-2026-0001	1	2026-03-27 02:00:00+02	80000.00	received	Created from PR-2026-0001	data:image/png;base64,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	Admin Kembe	2026-03-27 14:22:29.489+02	data:image/png;base64,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	Admin Kembe	2026-03-27 14:22:50.95+02	data:image/png;base64,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	Admin Kembe	2026-03-27 14:22:54.639+02	2026-03-27 14:06:57.800343+02	2026-04-03 03:25:44.524425+02	1	7d725b0f-4966-4dcf-9d58-16014f9e37ce	standard	main store	2026-03-31	\N	\N	80000.00	0.00	0.00	0.00	SSP	1.000000	80000.00	Net30	\N	a63c3829-1709-49da-ae07-699d0e52082c	80000.00	paid
\.


--
-- Data for Name: purchase_requisitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.purchase_requisitions (id, clinic_id, pr_number, requisition_date, requested_by, department, cost_center_id, requisition_type, delivery_date_required, total_amount, currency, status, approved_by, approval_date, rejection_reason, notes, created_by, created_at, updated_at) FROM stdin;
7d725b0f-4966-4dcf-9d58-16014f9e37ce	1	PR-2026-0001	2026-03-27	a63c3829-1709-49da-ae07-699d0e52082c	Pharmacy	\N	routine	\N	80000.00	SSP	approved	a63c3829-1709-49da-ae07-699d0e52082c	2026-03-27	\N		a63c3829-1709-49da-ae07-699d0e52082c	2026-03-27 11:58:00.019388	2026-03-27 12:06:04.210379
\.


--
-- Data for Name: receipts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.receipts (id, receipt_number, patient_id, patient_name, total_amount, amount_paid, payment_method, cashier_id, cashier_name, clinic, issued_at, branch_id, created_at, updated_at, bill_id, payment_amount, payment_date, paid_services, service_details, notes, from_lease, lease_details, status, clinic_id, receipt_currency, exchange_rate, base_currency_amount, payment_description, reference_number, insurance_payment, insurance_claim_ref, cash_gl_entry_id, receivables_gl_entry_id, is_voided, is_refunded, refund_amount, refund_date, refund_reason, reversal_gl_entry_id, bank_transaction_id, is_reconciled, reconciliation_date) FROM stdin;
c9f7d27d-aa5d-4a6c-b196-fd6c0907b242	PHARM-67312525	f13d0c29-3fef-494a-9642-2f390835d83f	Narting Abui Joseph	0.00	0.00	cash	a63c3829-1709-49da-ae07-699d0e52082c	Admin Kembe	\N	2026-03-30 10:41:52.557963	1	2026-03-30 10:41:52.557963	2026-03-30 10:41:52.557963	\N	0.00	2026-03-30 12:41:52.503	[]	[{"index":0,"serviceName":"P-Alaxine","quantity":20,"unitPrice":0,"totalPrice":0,"department":"Pharmacy"}]	Pharmacy Dispensing — DISP-202603-0001	f	\N	active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
3e8cf529-b61a-4534-a197-22163622e6f4	RCP-54252963	bbb36bc2-4834-4bfe-9b37-2311f79a716c	John Ohisa	20000.00	20000.00	cash	\N	Admin Kembe	\N	2026-03-31 10:50:52.972224	1	2026-03-31 10:50:52.964	2026-03-31 10:50:52.964	a1288878-7b04-484f-a460-b4ec6d67a7ca	20000.00	2026-03-31 00:00:00	["0","1"]	[{"index":0,"serviceName":"Consultaion GP","quantity":1,"unitPrice":20000,"totalPrice":20000,"department":"General"},{"index":1,"serviceName":"X-Ray Chest","quantity":1,"unitPrice":0,"totalPrice":0,"department":"General"}]	Payment for 2 selected services	f		active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
1e62e7ce-fdf9-4ff6-a69f-10fb8d2f9e1e	RCP-54725860	80980441-a1c1-483f-8d56-d6ac83732cae	Lil Been	0.00	0.00	cash	\N	Admin Kembe	\N	2026-03-31 10:58:45.894318	1	2026-03-31 10:58:45.865	2026-03-31 10:58:45.865	27b8bfc1-ca9b-4b4d-bffd-edeae0c35c0a	0.00	2026-03-31 00:00:00	["5","4"]	[{"index":5,"serviceName":"Unknown Service","quantity":1,"unitPrice":0,"totalPrice":0,"department":"General"},{"index":4,"serviceName":"Unknown Service","quantity":1,"unitPrice":0,"totalPrice":0,"department":"General"}]	Payment for 2 selected services	f		active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
6e9fb679-e030-40bf-8fa9-ea883a39484c	RCP-54766571	80980441-a1c1-483f-8d56-d6ac83732cae	Lil Been	50000.00	50000.00	cash	\N	Admin Kembe	\N	2026-03-31 10:59:26.574603	1	2026-03-31 10:59:26.572	2026-03-31 10:59:26.572	0028c2e4-05b8-455c-bfa1-e0a31ef75afd	50000.00	2026-03-31 00:00:00	["0"]	[{"index":0,"serviceName":"Unknown Service","quantity":1,"unitPrice":0,"totalPrice":0,"department":"General"}]	Payment for 1 selected services	f		active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
71caffd4-6304-4828-90e2-f378a099ef0a	RCP-57685816	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	Maria Anthony	50000.00	50000.00	cash	\N	Admin Kembe	\N	2026-03-31 11:48:05.819015	1	2026-03-31 11:48:05.816	2026-03-31 11:48:05.816	95cf980c-2ecb-4da1-9c36-81d821b63e5d	50000.00	2026-03-31 00:00:00	["0"]	[{"index":0,"serviceName":"Unknown Service","quantity":1,"unitPrice":0,"totalPrice":0,"department":"General"}]	Payment for 1 selected services	f		active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
102841d0-d217-4005-9716-e4e8dc71e2c1	PHARM-91805467	f13d0c29-3fef-494a-9642-2f390835d83f	Narting Abui Joseph	15000.00	15000.00	cash	a63c3829-1709-49da-ae07-699d0e52082c	Admin Kembe	\N	2026-04-06 16:10:05.489294	1	2026-04-06 16:10:05.489294	2026-04-06 16:10:05.489294	\N	15000.00	2026-04-06 18:10:05.455	[]	[{"index":0,"serviceName":"abnal","quantity":1,"unitPrice":10000,"totalPrice":10000,"department":"Pharmacy"},{"index":1,"serviceName":"Aciclovir","quantity":1,"unitPrice":5000,"totalPrice":5000,"department":"Pharmacy"}]	Pharmacy Dispensing — DISP-202604-0031	f	\N	active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
582f8b87-8807-4651-b63e-995ea2d2753c	RCP-01236119	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	Maria Anthony	20000.00	20000.00	cash	\N	Admin Kembe	\N	2026-04-06 18:47:16.123708	1	2026-04-06 18:47:16.119	2026-04-06 18:47:16.119	b945c6d0-e80f-4d44-b96e-85f2cb456107	20000.00	2026-04-06 00:00:00	["0"]	[{"index":0,"serviceName":"Unknown Service","quantity":1,"unitPrice":0,"totalPrice":0,"department":"General"}]	Payment for 1 selected services	f		active	1	SSP	1.000000	0.00	\N	\N	f	\N	\N	\N	f	f	0.00	\N	\N	\N	\N	f	\N
\.


--
-- Data for Name: rooms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rooms (id, ward_id, clinic_id, room_number, room_type, description, capacity, current_occupancy, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: scheme_changes_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_changes_history (id, clinic_id, scheme_id, change_type, field_changed, old_value, new_value, change_date, changed_by, reason) FROM stdin;
5bc87c88-67d5-4080-9350-4f325dd71d20	1	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	created	all	\N	UNIVERSAL HOSPITAL STAFF	2026-03-24 09:26:59.220431	a63c3829-1709-49da-ae07-699d0e52082c	Scheme created
\.


--
-- Data for Name: scheme_discounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_discounts (id, clinic_id, scheme_id, discount_code, discount_type, discount_name, discount_value, applies_to, service_ids, product_ids, min_bill_amount, min_items_qty, effective_from, effective_to, is_active, requires_approval, approval_by_roles, notes, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: scheme_membership; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_membership (id, clinic_id, scheme_id, patient_id, member_number, effective_from, effective_to, is_active, verified, verified_by, verified_date, verification_document_path, relationship_to_member, notes, created_at, updated_at) FROM stdin;
466e0f01-c5a4-4262-907f-99fa8944ba48	1	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	f13d0c29-3fef-494a-9642-2f390835d83f	090	2026-03-24	\N	t	f	\N	\N	\N	self	\N	2026-03-24 09:28:00.788165	2026-03-24 09:28:00.788165
ff5ef7fb-d909-46f5-a206-cb2db7d002c1	1	22ff16e0-ff80-4d87-b1b4-9dca41c7f870	d847f88c-e89d-444e-bf03-c15aed4b1d10	\N	2026-03-30	\N	t	f	\N	\N	\N	self	\N	2026-03-30 16:57:13.921271	2026-03-30 16:57:13.921271
\.


--
-- Data for Name: scheme_negotiated_prices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_negotiated_prices (id, clinic_id, scheme_id, negotiation_number, negotiation_date, negotiated_by_user_id, applies_to, reference_id, negotiation_type, negotiated_price, original_price, discount_amount, discount_percentage, valid_from, valid_to, quantity_limit, quantity_used, approved_by, approval_date, approval_notes, status, notes, created_at) FROM stdin;
\.


--
-- Data for Name: scheme_price_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_price_rules (id, clinic_id, scheme_id, rule_name, rule_description, condition_type, condition_value, action_type, action_value, formula, priority, is_active, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: scheme_product_pricing; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_product_pricing (id, clinic_id, scheme_id, product_id, product_type, scheme_price, scheme_currency, markup_percentage, discount_percentage, insurance_copay, insurance_copay_percentage, insurance_coverage_amount, min_quantity, max_quantity, effective_from, effective_to, is_active, notes, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: scheme_product_pricing_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_product_pricing_history (id, scheme_id, product_id, product_type, old_price, new_price, old_copay, new_copay, price_change_reason, effective_date, changed_by, change_date) FROM stdin;
\.


--
-- Data for Name: scheme_service_pricing; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_service_pricing (id, clinic_id, scheme_id, service_id, scheme_price, scheme_currency, markup_percentage, discount_percentage, insurance_copay, insurance_copay_percentage, insurance_coverage_amount, effective_from, effective_to, is_active, notes, revenue_account_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: scheme_service_pricing_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_service_pricing_history (id, scheme_id, service_id, old_price, new_price, old_copay, new_copay, price_change_reason, effective_date, changed_by, change_date) FROM stdin;
\.


--
-- Data for Name: scheme_tiered_pricing; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scheme_tiered_pricing (id, clinic_id, scheme_id, service_id, product_id, product_type, tier_level, tier_name, min_quantity, max_quantity, tier_price, tier_currency, tier_discount_percentage, tier_copay, effective_from, effective_to, is_active, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.services (id, service_name, category, price, description, department_id, is_active, created_by, updated_by, created_at, updated_at, service_category, service_code, price_kes, price_usd, price_ssp, revenue_account_id, nhif_approved, nhif_rate, patient_copay_amount, is_consumable, inventory_item_id, requires_quantity, unit_of_measure) FROM stdin;
3e81b639-5cd5-4bd9-998d-1c67028617a4	Minor Operation 200 Consumables USD 50	Surgery	1140000.00	General Surgery	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.28	2026-03-30 11:24:34.28	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
6ef073e3-c604-4254-9872-ef52720d628f	Stool Analysis	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.011	2026-03-23 18:46:21.011	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
7df1856e-69fb-4097-8523-fa2d7073414b	Urine Analysis	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.201	2026-03-23 18:46:21.201	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
9e948355-b87d-4536-a80b-518a03e5ff35	Blood Group	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.404	2026-03-23 18:46:21.404	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
5fedfb64-3809-4a23-9e0e-9ca080cd6001	UPPER RIB X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.617	2026-03-23 18:46:23.617	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
40516435-4df6-4fc0-8282-db84a0f3b89e	HCG	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.857	2026-03-23 18:46:21.857	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
146b0586-7d32-422a-aa80-ae30327463ce	CK-MB (Creatinine Kinase-MB)	Emergency	45000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:37.189	2026-03-30 11:24:37.189	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
0249ed6e-850a-471b-80d8-9a5f08b88a12	Troponin I (cTnI)	Emergency	45000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:37.239	2026-03-30 11:24:37.239	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
4079b1ff-7c93-4c8e-9e24-f62932136d8a	Transrectal Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.819	2026-03-30 11:24:35.819	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
9e349975-619a-49c3-8f6e-b734da893467	Thyroid Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.866	2026-03-30 11:24:35.866	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
ba7d0ebb-0676-4373-8ed8-ee25b619655b	Superficial Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.909	2026-03-30 11:24:35.909	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
5b618bb9-eb3c-40b0-b510-a56046697f93	Composite Filling	Other	150000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.932	2026-03-30 11:24:35.932	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
795da79a-196a-44b2-9046-9990ba01e7c6	Doppler Upper Limb Ultrasound	Other	150000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.957	2026-03-30 11:24:35.957	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
55aa59d5-9f8b-4054-b018-baca0be3a523	Scrtotum Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.009	2026-03-30 11:24:36.009	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
822318f8-c00d-477d-a2fc-4c117b16b82d	Musculo-Skeletal Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.045	2026-03-30 11:24:36.045	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
c2d5d53f-2065-47f2-afbc-636137574ffc	Doppler Lower Limb Ultrasound	Other	150000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.146	2026-03-30 11:24:36.146	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
ecc63c4e-e372-4f08-bccd-21bd6af544b5	Amalgam Filling	Other	200000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.174	2026-03-30 11:24:36.174	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
702b5e29-d7f5-464c-9e98-9e65afbc275e	Breast Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.199	2026-03-30 11:24:36.199	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
29c8826e-0268-4b02-b49e-3067d8330d2c	ECHO Cardiography Ultrasound	Other	150000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.223	2026-03-30 11:24:36.223	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
45ce185e-9a90-4fb9-a334-a053a305ac21	BFFM	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.801	2026-03-23 18:46:22.801	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c5a72a22-7910-42c9-b62c-c6fa69b9499d	Hepatitis C (HC-Ab)	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.412	2026-03-30 11:24:37.412	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
b4555f96-96eb-4dc4-850a-a699f199acd9	Total Protein	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.955	2026-03-30 11:24:37.955	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c9eb9c8f-2866-4fba-8e15-0778f4ccb539	HIV Test	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.273	2026-03-30 11:24:37.273	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
b27c2159-3ad8-43c7-94d5-2d80afde2f51	Uveoleotctomy	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.417	2026-03-30 11:24:34.417	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
8e954b4b-3c07-4e36-b9a0-402bfb0435f7	Surgerical Removal of Giant Cell Granuloma	Procedure	500000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.442	2026-03-30 11:24:34.442	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
ebd696b4-afba-4540-8058-a01f21c1c51a	Dressing -Big	Procedure	50000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.54	2026-03-30 11:24:38.54	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fbc8b8e2-4a05-4335-90a9-a2343dc05571	Root Amputation	Procedure	750000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.749	2026-03-30 11:24:35.749	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4ebe5085-91c5-4cac-b3f4-d14154a70a01	Normal Delievery	Procedure	550000.00	Maternity	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.49	2026-03-30 11:24:34.49	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
71311e53-7ba3-4725-afd1-e2545ebe4416	LOWER RIB X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.433	2026-03-23 18:46:23.433	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c5b3f9e1-35ea-4104-b3ec-3a0d8171de88	HB (Haemoglobin)	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.652	2026-03-23 18:46:22.652	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
e25891b7-5e83-4ebc-9d8c-299930df2da9	KNEE JNT  X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:26.502	2026-03-23 18:46:26.502	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
a9ca2020-b0ee-4e81-b1d2-69af482a0ee4	VDRL	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.37	2026-03-23 18:46:22.37	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
5b60ca27-d9de-4555-8816-02508add025d	Widal Test for Enteric	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.515	2026-03-23 18:46:21.515	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
6e22fc77-7ced-4e12-88f0-96e6c60af14e	CBC (Complete Blood Count)	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.552	2026-03-23 18:46:22.552	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
bd31ae8c-8d22-41e2-9d3b-e95f788a8cf3	WHOLE SPINE X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:24.331	2026-03-23 18:46:24.331	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c5315212-e520-4c6b-af57-59812f2b0980	Widal Test (Typhoid)	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.297	2026-03-30 11:24:37.297	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
d103080c-ad71-4ae3-87a8-0ba9771aeddb	ASO	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.324	2026-03-30 11:24:37.324	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
819c4be8-4c7a-409f-bdbe-1082fa79c7af	ESR	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.322	2026-03-30 11:24:38.322	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
ad3cac3f-ba7b-4d01-ac84-27684c2fffc6	BF For Malaria	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.295	2026-03-30 11:24:38.295	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
e425a4ff-cd95-4a4b-8f73-06f530b1b5b7	GGT	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.927	2026-03-30 11:24:37.927	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
0b174b17-6307-4df1-aa11-a4d1d8558374	TSH (thyroid-Stimulating Hormone	Diagnostic	50000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:36.733	2026-03-30 11:24:36.733	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
902796fb-5c61-40ed-b6ba-459f7c6ef4a9	Electrolyte (Na+, K+, Ca+, Mg)	Diagnostic	150000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.028	2026-03-30 11:24:38.028	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
2039e34a-5042-44ba-a329-d14ebec5fe26	Triglycerides	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.054	2026-03-30 11:24:38.054	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
188cb449-0670-4261-a4d7-8a9a19ad82f5	Blood Urea	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.789	2026-03-30 11:24:37.789	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
5e8531c1-cc22-4273-9666-62146fc7f1d7	ALP	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.897	2026-03-30 11:24:37.897	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
bd4bb8c8-29e7-4d5f-b372-272e6ca668bc	Generalized Scalling for one Jaws	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.518	2026-03-30 11:24:34.518	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f3371185-0a65-481a-83ab-5e3ed4ead270	Cantiliffer Bridge 1x1	Procedure	800000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.579	2026-03-30 11:24:34.579	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4f179d54-2551-4391-a94d-752f31b19da6	Zirconium Bridge (Per Unit) 2x3 USD 250	Procedure	1525000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.61	2026-03-30 11:24:34.61	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
9d2a5405-6093-4534-9bfc-ba19b38249f4	Surgical Extraction	Surgery	300000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.543	2026-03-30 11:24:35.543	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
2105f7d4-8e9d-452c-9d2e-72f5fb8ff926	TORCH	Diagnostic	85000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:36.543	2026-03-30 11:24:36.543	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
991f6c8e-1b97-47a6-8832-8220de367c08	T4 (thyroxine)	Diagnostic	45000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:36.597	2026-03-30 11:24:36.597	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
f86582e7-7f8d-44a1-a0e8-e2b5c17c3156	Urinalysis	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.509	2026-03-30 11:24:38.509	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c5cb8844-5c3f-4b67-913f-cb6d8e1c445f	Coagulation Profile	Diagnostic	150000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.445	2026-03-30 11:24:38.445	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
00881bfd-0070-4f6b-b94d-901d133c53a3	ALT/SGOT	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.648	2026-03-30 11:24:37.648	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
d1e0742a-dcf6-4687-b2cd-d571f0cc8063	LDL & HDL Cholestrol	Diagnostic	50000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.088	2026-03-30 11:24:37.088	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
fc3db99a-e23b-41cb-9879-706cf1197959	CRP Quantitative	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.352	2026-03-30 11:24:37.352	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
87c37997-9276-4b55-bca1-bb45cc567d41	Total & Direct Bilirubin	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.842	2026-03-30 11:24:37.842	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
01d5ad58-6af1-475a-82a2-8a859f79e3ec	Albumin	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.871	2026-03-30 11:24:37.871	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
0c264070-d0a4-4122-9528-f75d87b8a40a	Ranal Function Test (RFTs)	Diagnostic	75000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.707	2026-03-30 11:24:37.707	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
e45e052a-782f-4cd3-a173-563faa3fb62a	Malaria ICT	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:36.52	2026-03-30 11:24:36.52	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
7fa3ab99-cd7d-46f5-853e-42bd5e2bfc03	Typhoid IgM, IgG	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.031	2026-03-30 11:24:37.031	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
925da68b-7fea-4efd-b037-2beee0813e91	Operceulectomy	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:33.985	2026-03-30 11:24:33.985	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
bd2a14e6-80fe-41a8-bca8-7f4d80d6f655	Procelin Bridge (Per Unit) 2x2 USD 800	Procedure	4880000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.706	2026-03-30 11:24:34.706	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
3a68b52a-681a-4f42-bd46-da9a84f82104	FOOT X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.718	2026-03-23 18:46:25.718	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
f1c55d73-01f7-4901-b61a-d4cbd30e1d93	Complete Denture (Dentsply) Ivoclar Vivadent	Procedure	1830000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.852	2026-03-30 11:24:34.852	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
d96c832b-d4ea-44eb-9ba8-b7f214dcf154	RCT For Upper Canine	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.979	2026-03-30 11:24:35.979	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
5fa6304d-4a63-4ff4-a751-7168f6ba5f76	RCT For Lower Lateral Incisor	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.653	2026-03-30 11:24:35.653	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
d3f39f24-0c34-49e8-9052-94fba0cfb41f	Stool Analysis	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.415	2026-03-30 11:24:38.415	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
5496f87a-657c-4ddf-9d3c-98ab87855c3a	D-Dimer	Diagnostic	45000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.244	2026-03-30 11:24:38.244	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
b4bd82e6-3dcb-4e25-afce-de70a0c97f23	Hs-CRP (High Sensitivity	Diagnostic	50000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.462	2026-03-30 11:24:37.462	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
b1c1ee81-4e3e-4c77-b132-09fafabe201a	T3 (triiodothronine)	Diagnostic	45000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:36.989	2026-03-30 11:24:36.989	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c08f03b4-d0e1-47b3-8a2c-40fe64bca1b6	Widal Test (Brucilla)	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.489	2026-03-30 11:24:37.489	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
ecba144a-20ce-43af-b899-3ce5eeaf46a1	Leffort (1) Fracture USD 6000	Surgery	36600000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.796	2026-03-30 11:24:34.796	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
3e2c6398-7920-4f76-82f4-f8c71b1a0f07	Splinting for traumatic teeth (3 Units)	Surgery	500000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.827	2026-03-30 11:24:34.827	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fa3bf78a-a77a-4654-9875-d7a67d168827	Splinting for traumatic teeth (2 Units)	Surgery	450000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.879	2026-03-30 11:24:34.879	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
e0dfe7bd-3cdd-4fba-b171-d348449bfed0	Parasymphyseal Fracture USD 3000	Surgery	18300000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.906	2026-03-30 11:24:34.906	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4d35cbaf-dc62-4b0a-b668-102d206995a6	LUMBAR X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.109	2026-03-23 18:46:25.109	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
66d5d546-36fc-40c0-a65e-a05d90de61be	TOE X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.528	2026-03-23 18:46:25.528	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
3be96872-334a-426b-bea1-d7cf449d4871	Complete Denture (Dentsply) USD 500	Procedure	3050000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.189	2026-03-30 11:24:35.189	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
04f2ad3e-0e22-40ab-a34b-dea5690826de	Operceulectomy	Procedure	400000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:20:20.337	2026-03-30 11:20:20.337	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
df6fc435-20a7-4dff-a2cc-c0a05f4c1853	Generalized Scalling for two Jaws	Procedure	500000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:20:20.397	2026-03-30 11:20:20.397	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fc6e9f3f-7fb5-40e9-8ca5-e794f497582b	Refixation of failure bridge	Procedure	150000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.044	2026-03-30 11:24:35.044	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
80803b6a-a9d4-42c9-8ded-ec41b74451f0	RCT For Lower Canine	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.499	2026-03-30 11:24:35.499	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
90f131c4-5d97-44c7-9904-b7fdd557f463	RCT For Upper Lateral Incisor	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.098	2026-03-30 11:24:36.098	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
38151bd0-e280-4efc-8128-20bb40ff9437	Generalized Scalling for two Jaws	Procedure	500000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.017	2026-03-30 11:24:34.017	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
d7f1f7ed-5824-4816-af12-71a061ec0789	Management of Dry Socket	Surgery	450000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.701	2026-03-30 11:24:35.701	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
a9c6ab6a-bc1a-4a29-8fb8-745b4f4f0bb3	Unilateral Fabrable Mandibular Fracture USD 2000	Surgery	12200000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.94	2026-03-30 11:24:34.94	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
782d8785-e423-4f07-8152-d80eb75ad3b9	Composite Splinting for Traumatic one tooth	Surgery	400000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.009	2026-03-30 11:24:35.009	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
07b5a680-8083-461c-9ff2-d2b7ba340ce9	Marcubilization of the large jaw cyst USD 500	Surgery	3050000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.088	2026-03-30 11:24:35.088	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
21ba5f65-1a3b-4816-ac2a-979b84dc3e90	CK	Emergency	45000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:37.575	2026-03-30 11:24:37.575	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
4c448e63-f846-42aa-8a36-6cb0b25f39b8	Serum a Amylase	Other	45000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:37.437	2026-03-30 11:24:37.437	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
b6ff3e2a-157f-4a08-977d-f35f884a8356	Lipase	Other	45000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:37.512	2026-03-30 11:24:37.512	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
1ba86fcc-6a1d-4923-b162-416062ea4cf6	Complete Blood Count (CBC)	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.172	2026-03-30 11:24:38.172	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
bc93fb8d-dba6-4cda-a00a-8feb614e5bb4	Blood Group & Rh	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.221	2026-03-30 11:24:38.221	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
cf20bc4b-a91d-443c-8a65-ec2a83118e5f	Transvaginal Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.275	2026-03-30 11:24:36.275	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
672f1403-345a-4f79-96c4-42973341a881	Back Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.3	2026-03-30 11:24:36.3	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
82311bf0-835f-4d0c-8c07-1a67c02cc959	ESR (Erythrocyte Sedimentation Rate) mm/hr	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.001	2026-03-23 18:46:22.001	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
fafe2ff9-246a-40dd-973d-634b76dc05e0	Rh Factor	Diagnostic	0.00	Laboratory	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:21.783	2026-03-23 18:46:21.783	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
94f4c12a-4239-48d9-9367-63a1e3be0ef9	RCT For Lower Central Incisor	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.676	2026-03-30 11:24:35.676	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4187b711-53c9-42a8-bc12-b1fe02218c59	RCT For Lower First Pre-Molar	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.726	2026-03-30 11:24:35.726	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
71c6bdec-5515-4827-a9da-1730536bffc1	RCT For Upper First Pre-Molar	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.247	2026-03-30 11:24:36.247	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
33555a62-7e3a-43d0-a190-9bc0675ae26c	Porcelin Crown USD 300	Procedure	1830000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.101	2026-03-30 11:24:34.101	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
321154b5-1673-44b7-badd-1faafbe0a606	Composite temporal crown	Procedure	200000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.272	2026-03-30 11:24:35.272	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fd467707-d02e-4b09-a40d-71cf21f78d18	RCT For Second Pre-Molar	Procedure	450000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.391	2026-03-30 11:24:35.391	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f1922683-4f52-4960-a23b-af788072c6ec	Abdominal X-ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.032	2026-03-23 18:46:23.032	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
2944adb8-9408-4402-9788-fc90c82a2ce9	Pelvis X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	Admin Kembe	2026-03-23 18:46:26.868	2026-03-23 18:47:15.329	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
d63cac8e-ef8e-441e-9a65-b0be5c6e19cb	Bilateral Fabrable Mandibular Fracture USD 4000	Surgery	24400000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.113	2026-03-30 11:24:35.113	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
eb4f4dde-9d8f-4a5f-9082-c2d3ae656455	STERNUM X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.84	2026-03-23 18:46:23.84	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
21a2c5b7-7fdf-466e-bd2b-612e8f0e13eb	CLAVICLE X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.951	2026-03-23 18:46:23.951	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
7f57b83b-bbd4-41fc-92cb-b2e1239db515	TWBC (Total White Blood Cell Count)	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.47	2026-03-23 18:46:22.47	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
058c8059-4748-41df-bc65-14679ebb4b18	Thyroid - X-ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:22.927	2026-03-23 18:46:22.927	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
863c7c3e-1032-4565-9982-2c01d2a75daa	SACRUM X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:24.715	2026-03-23 18:46:24.715	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
f23f6b72-ed04-4ef2-b9f4-a996d6a6cdb9	RFT (Renal Function Test)	Diagnostic	0.00	Laboratory	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:21.331	2026-03-23 18:46:21.331	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
b5f50d2e-7eec-4ee8-a0a2-e1ab9106f343	H-Pylori Test/Stool	Diagnostic	30000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.158	2026-03-30 11:24:37.158	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
68fab833-8b97-4d0f-b457-5e75b09efbde	H-Pylori Test/SERUM	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.211	2026-03-30 11:24:37.211	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
050cef2a-63a9-47ef-bbfa-d4744f805d70	RCT For Third Pre-Molar	Procedure	500000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.426	2026-03-30 11:24:35.426	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
47b3fb61-c3fc-499d-86e5-713e2e72fc33	Gold Crown USD 500	Procedure	3050000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.137	2026-03-30 11:24:35.137	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
e28e4d91-de04-454a-aec4-7737c4e21cb8	Metal crown (Silver)	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.161	2026-03-30 11:24:35.161	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
6c24778b-6561-4bd9-88cc-40409301fb52	RCT For First Molar	Procedure	450000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.476	2026-03-30 11:24:35.476	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
585bb052-8620-4de9-a975-37a913c404e8	RCT For Upper Central Incisor	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.839	2026-03-30 11:24:35.839	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
b2fc3825-82e7-44a2-acec-870d1413c2c4	RCT For Upper Second Pre-Molar	Procedure	450000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.887	2026-03-30 11:24:35.887	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
55f513ec-0eb4-4c97-8e7b-0813c1fffa3c	Apexectomy	Procedure	600000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.626	2026-03-30 11:24:35.626	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
743951ae-963f-4f5f-a99e-9ba5a1bf30b9	Admission-Short Stay	Procedure	50000.00	Inpatient	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.478	2026-03-30 11:24:38.478	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
dade0513-d666-441f-a992-0900705be2c4	Management of Dentoalveolar Fracture USD 400	Surgery	2440000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.247	2026-03-30 11:24:35.247	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
d820987b-97d0-408e-b1ac-ac60dae2da8c	HEEL X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.649	2026-03-23 18:46:25.649	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
0adfa78d-19ce-4641-b6f2-255ecee01a5a	Dengue NSI, IgM, IgG	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.538	2026-03-30 11:24:37.538	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
ed6bfd5a-4ce3-45e3-bae7-18295dcfb73f	Rheumatoid Factor	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.388	2026-03-30 11:24:37.388	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
33713126-16ef-4e17-b313-c0c6c71fd28c	Uric Acid	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.979	2026-03-30 11:24:37.979	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
38cf9ea7-d2e9-4386-8d9d-6781fa3593a4	Hepatitis B (HBsAg)	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.134	2026-03-30 11:24:37.134	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
6a5e3f6a-f418-4790-b5bc-f6368cafdee4	Surgerical Removal of Gingival Epulis	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.391	2026-03-30 11:24:34.391	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
b7ba2fa7-8d91-4815-9555-8518cf42a9d2	Neck X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	Admin Kembe	2026-03-23 18:46:27.033	2026-03-23 18:47:05.086	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c9a28fe1-6fab-4164-9466-7946e2e1ff72	CERVICAL SPINE X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.351	2026-03-23 18:46:25.351	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
8769bcdd-2645-4c17-96b1-b4d86596aa3c	HBs Ag (Hepatitis B Surface Antigen)	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.085	2026-03-23 18:46:22.085	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
6b23c782-3db9-45bc-99af-9b912b078a31	TB Test	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.115	2026-03-23 18:46:22.115	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
d8d83cc9-1c06-4c9a-a480-4dab39b5e705	H. Pylori	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.617	2026-03-23 18:46:21.617	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
687aa41c-9010-4203-8bb8-52b446530d83	RCT For Upper First Molar	Procedure	450000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.346	2026-03-30 11:24:36.346	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
739e1421-4650-4b4d-b91c-89de19b99237	Stitching -Small Wood	Procedure	60000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.196	2026-03-30 11:24:38.196	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fe8206ce-fa3e-4427-9f87-0da014cb3a46	Admission-Long Stay VIP Room	Procedure	610000.00	Inpatient	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.273	2026-03-30 11:24:38.273	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f3356984-f01b-49d3-9ce5-1fc7cbba8c92	Stitching -Big	Procedure	150000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.345	2026-03-30 11:24:38.345	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
b1b9d4a2-80b3-4a40-9fe5-d00625ac0c05	Admission-Long Stay Private Room	Procedure	305000.00	Inpatient	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.369	2026-03-30 11:24:38.369	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
ba62ede8-eec6-40d3-b9d1-af9fde629dff	Acrylic Crown (Dentsply Type) Per Unit	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.067	2026-03-30 11:24:35.067	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4d2c48bc-dd53-462b-ba50-179fd3c54de8	Circumcision (Adult)	Surgery	200000.00	General Surgery	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.342	2026-03-30 11:24:34.342	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
5c884abc-8980-4fd7-a9c7-c1b3a97ec9b8	Major operation  inclding Consumables USD 650	Surgery	3965000.00	General Surgery	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.468	2026-03-30 11:24:34.468	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f02016b3-a5eb-44ef-8cb4-01d6f88c27ea	Complex  inclding Consumables USD 1050	Surgery	6405000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.55	2026-03-30 11:24:34.55	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f9ad0c91-0f8a-48e3-96f8-6c45b756b2ff	Unilateral Unfabrable Mandibular Fracture USD 3000	Surgery	18300000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.3	2026-03-30 11:24:35.3	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
e8f3a663-282d-40db-a7c1-01d1ee8dabdf	Symphyseal Fracture USD 250	Surgery	1525000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.984	2026-03-30 11:24:34.984	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
08dbe734-59aa-4e34-a329-24196599e346	LEG X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:26.22	2026-03-23 18:46:26.22	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
a0e1545b-2b25-4a55-ae8f-dbb9811e61dc	Chlamydia Ab(swab)	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.606	2026-03-30 11:24:37.606	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
a09a4f6a-ab47-4cfd-bb97-315a58834955	HCG Serum/Urine	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:36.796	2026-03-30 11:24:36.796	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
12c342dd-d1f6-4e20-9be9-7ec2b1d229ac	Partial Denture ( Dentsply Type) Per Unit	Procedure	300000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.224	2026-03-30 11:24:35.224	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
92385c0f-3822-4ee1-b7d4-cf75458a0d04	RCT For Upper Second Molar	Procedure	450000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.523	2026-03-30 11:24:35.523	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
5e61a317-5d45-4dcd-a035-510408b861f4	WHOLE LEG X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.444	2026-03-23 18:46:25.444	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
397065da-224e-41a2-9a51-8b1f1097f05d	COCCYX X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:24.485	2026-03-23 18:46:24.485	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
94232a77-42d1-498e-baa2-5a113bbcd5bf	Consultaion GP	Consultation	20000.00		7f99e814-4919-4249-9ada-dcae0223fcf9	t	Admin Kembe	\N	2026-03-23 21:15:00.203	2026-03-23 21:15:00.203	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
ef8e7b72-286d-4882-9c5a-75109aaed40c	Consultaion - Pediatric	Consultation	50000.00		7f99e814-4919-4249-9ada-dcae0223fcf9	t	Admin Kembe	\N	2026-03-23 21:15:42.175	2026-03-23 21:15:42.175	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
ef663ee9-d072-4a99-9909-25be9b836867	RCT For Lower Second Pre-Molar	Procedure	400000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.582	2026-03-30 11:24:35.582	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f9af5358-66af-4e3c-8f49-4c3499cb9409	RCT For Upper Third Molar	Procedure	500000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:35.604	2026-03-30 11:24:35.604	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
e640c349-98fc-405a-b784-9776eba8ed3d	Gonadotropin)-Pregnancy Test	Emergency	50000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:36.423	2026-03-30 11:24:36.423	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
2b6f0467-4388-41b4-a24c-a2f419fce836	CA19-9	Emergency	50000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:36.469	2026-03-30 11:24:36.469	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
12c4c314-532b-432e-bbb8-ca9ce2802fc9	AFP (Alpha-Fetoprotein)-Liver Cancer	Emergency	50000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:36.573	2026-03-30 11:24:36.573	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
3243f970-12ab-4fff-8bda-061fec8a7e2c	Management of Ludwig's  Angina USD 600	Surgery	3660000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.345	2026-03-30 11:24:35.345	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
7811f607-dfee-45d9-951f-862546e4becb	Treatment of Non-Supportive Osteomyelitis	Surgery	450000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.37	2026-03-30 11:24:35.37	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
c031b1f8-b475-4a85-ae83-f2a46b34cd3a	HCV (Hepatitis C Virus)	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.569	2026-03-23 18:46:21.569	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
72f0e7e6-2483-4831-8207-a5a2f2ecf2ca	Uric Acid	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:21.677	2026-03-23 18:46:21.677	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
4fca53b2-37d1-4b57-b1cd-d20737b9e63a	THORACIC SPINE X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.209	2026-03-23 18:46:25.209	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
0b9d5901-aff4-48cf-8f16-74a0d158ef0e	X-Ray Chest	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	Admin Kembe	2026-03-23 18:46:27.246	2026-03-23 18:46:53.685	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
540732ac-02b6-4a56-873f-f5acce83b944	ANKLE JNT X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:25.85	2026-03-23 18:46:25.85	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
f413b138-1737-4c4d-91b8-01815096a4ff	Total Cholesterol	Diagnostic	25000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:38.12	2026-03-30 11:24:38.12	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
344084b8-e71b-461a-bec3-cec174d06e93	Complete Scalling with Polishing	Procedure	600000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.155	2026-03-30 11:24:34.155	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
796814f5-eaa4-4804-96e3-3024a8274ea2	Localized Scalling and root Planning	Procedure	250000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.188	2026-03-30 11:24:34.188	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
e85d6ddd-c768-43f7-8071-70b2b07f06bc	Operation C-Section Including Consumable 700	Procedure	4270000.00	Maternity	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.315	2026-03-30 11:24:34.315	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fbf257ec-a34c-4747-b1c6-8e88df45057e	Denture Repair	Procedure	200000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:34.365	2026-03-30 11:24:34.365	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
2bafcc0b-9061-44e1-b8e2-b063e193d34f	Simple Extraction	Surgery	150000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.454	2026-03-30 11:24:35.454	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
f4e83eb3-c7f6-4262-83bf-e52e77bba64f	Leffort (2) Fracture USD 12,000	Surgery	73200000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.323	2026-03-30 11:24:35.323	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
0dfc95ef-35e8-4019-95b4-fa41e937e20e	CA-125 (Ovarian Cancer)	Emergency	50000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:36.669	2026-03-30 11:24:36.669	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
144d05fa-b7d8-427e-87e7-d6ca58af0f99	TH-LW (Thoracic�Lumbar Spine) X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:24.84	2026-03-23 18:46:24.84	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
9bd01346-8f28-4dc6-b49c-a70e84529b1b	ACROMIOCL JNT X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.75	2026-03-23 18:46:23.75	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
ab1c48be-d9d4-4075-a09f-7497cc43a284	Consultation-Maxilofacial Surgery	Consultation	50000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.391	2026-03-30 11:24:38.391	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
62d47ba9-1f8a-4de6-b23e-3d7fc1eb9527	Consultation-Maternity	Consultation	50000.00	Maternity	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.685	2026-03-30 11:24:38.685	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
0d0d3797-6cc5-4635-a290-0547b8a10054	Consultation-GP	Consultation	20000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.72	2026-03-30 11:24:38.72	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
1a253368-02b8-4a5a-a8f2-cdc141e79983	Consultation-General Surgery	Consultation	50000.00	General Surgery	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.747	2026-03-30 11:24:38.747	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
ed4e9bee-9994-417e-a51f-3020f72e4112	Consultation-ENT	Consultation	50000.00	ENT	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.769	2026-03-30 11:24:38.769	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
4eae1881-2ab7-4b67-be86-49131a6bede8	Consultation-Pediateric	Consultation	50000.00	Pediatrics	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.797	2026-03-30 11:24:38.797	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
6c403545-134f-4b10-be04-f8c047e016e1	Consultation-Vaccine	Consultation	50000.00	Pediatrics	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.823	2026-03-30 11:24:38.823	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
b58b669d-7440-4f56-8441-ccc7d41554c0	Consultation-Physician & Neprology (Kidney Care)	Consultation	50000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.86	2026-03-30 11:24:38.86	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
a09b959f-6004-4545-8b38-304d61d5988b	STERNOCL JNT X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:23.295	2026-03-23 18:46:23.295	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
3a565bfe-26d1-4b7d-8687-4d5e81d66f0e	Consultation-Dermatology & Venereology	Consultation	50000.00	Dermatology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.889	2026-03-30 11:24:38.889	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
10ef842c-34c1-4993-b83c-0ec79087653d	Consultation-Dental	Consultation	50000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.912	2026-03-30 11:24:38.912	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
27aa9f84-61f4-4d3b-be83-6131b8f8b132	Consultation-Orthopedics & Trauma Surgery	Consultation	50000.00	Orthopedics	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.94	2026-03-30 11:24:38.94	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
b144a700-dd54-43ba-8b20-6b4ef77fb99a	Consultation-Obs & Gyna	Consultation	50000.00	Obs & Gynecology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.966	2026-03-30 11:24:38.966	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
fa58b4d9-a8b9-437d-83d4-1c31487b422b	Syphilis (VDRL/RPR)	Diagnostic	15000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.109	2026-03-30 11:24:37.109	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
5464e05b-9ae8-4fae-a17a-fda89a160803	Cross-Matching	Diagnostic	20000.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-30 11:24:37.812	2026-03-30 11:24:37.812	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
244c2c21-0d87-40f1-a5fa-531b5f54d354	Admission-Long Stay	Procedure	150000.00	Inpatient	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.573	2026-03-30 11:24:38.573	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
9552b55d-2157-4e17-8fec-89865255fc8a	Dressing -Small Woon	Procedure	15000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.597	2026-03-30 11:24:38.597	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
9067c0a3-14c8-4596-9b56-e7fe96b77120	Dressing -Medium	Procedure	25000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.625	2026-03-30 11:24:38.625	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
7bac5dd3-2ae6-4c8e-8884-bbcbbb70d6f7	Stitching -Medium	Procedure	80000.00	General Medicine	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.655	2026-03-30 11:24:38.655	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
ba143eac-1aea-4706-9a63-b5a5d94108de	Mini Operation inclding Consumables USD 150	Surgery	915000.00	General Surgery	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.657	2026-03-30 11:24:34.657	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
03d87fce-43e0-49a6-b0c4-34f3973351e3	Bilateral Unfabrable Mandibular Fracture USD 6000	Surgery	36600000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.739	2026-03-30 11:24:34.739	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
c135131d-c72b-4f67-a3ce-d8f34d01f5db	Surgical Inculation of small jaw cyst	Surgery	1500000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.762	2026-03-30 11:24:34.762	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
582d2d29-ee47-489b-bfa4-5cf46088890b	Major Complex  inclding Consumables USD 1550	Surgery	9455000.00	Radiology	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:20:20.426	2026-03-30 11:20:20.426	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4eba1894-2554-4410-970d-a0d50ec752ec	Major Complex  inclding Consumables USD 1550	Surgery	9455000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.05	2026-03-30 11:24:34.05	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
fc628006-5eee-40c6-a6e9-c9c5a1c9fb38	Intermediate operation  inclding Consumables USD 350	Surgery	2135000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.217	2026-03-30 11:24:34.217	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
b524da71-f0dd-4110-bc9c-e2749ce237d1	Circumcision (Child)	Surgery	300000.00	General Surgery	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:34.252	2026-03-30 11:24:34.252	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
4ccf3d43-eb31-4072-9c6a-8b75c83ef607	P24	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.252	2026-03-23 18:46:22.252	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
f3282ea2-8efe-4046-8a0f-01e40eee2b97	RBG (Random Blood Glucose)	Diagnostic	0.00	Laboratory	d3e2902c-a0c1-495a-8f55-92ec99e587c1	t	\N	\N	2026-03-23 18:46:22.322	2026-03-23 18:46:22.322	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
2a519307-bc16-47be-bcc0-4b6006e4ded7	THIGH X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:26.685	2026-03-23 18:46:26.685	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
c9420e73-fac9-4f37-828e-9e8e9092644a	SCAPULA X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:24.083	2026-03-23 18:46:24.083	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
8d3ec939-8bb4-4e0d-9a37-a4f811c148ad	Management of Supportive Osteomyelitis	Surgery	500000.00	Dental	749c60df-8c3e-4692-8491-6021a5e22963	t	\N	\N	2026-03-30 11:24:35.773	2026-03-30 11:24:35.773	other	\N	\N	\N	\N	21c95271-65a5-4e1a-97b0-a06c40222e65	f	\N	0.00	f	\N	t	\N
9992975f-1863-4982-884d-4ce96affc55a	SHOULDER X-Ray	Diagnostic	0.00	Radiology	98a82570-4238-4715-b378-4767fc0acace	t	\N	\N	2026-03-23 18:46:24.18	2026-03-23 18:46:24.18	other	\N	\N	\N	\N	50d4d559-a9aa-44a2-b1fc-14dd9e230148	f	\N	0.00	f	\N	t	\N
71bb5b9f-4c84-401a-b26f-81f1471872c0	AMH (Anit-Mullerian Hormone)- Ovarian Cancer	Emergency	50000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:36.923	2026-03-30 11:24:36.923	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
e6fd9e2d-b69b-487d-b39c-66af55201bc6	PAS (Prostate-Specific Antigen)	Emergency	50000.00	Laboratory	34a2536f-5c2d-490e-bcee-d12215afd561	t	\N	\N	2026-03-30 11:24:37.059	2026-03-30 11:24:37.059	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
bafacd19-8600-4ceb-bb4a-371907c58ac9	Doppler Scrtotum Ultrasound	Other	100000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.324	2026-03-30 11:24:36.324	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
6a905bfc-39d6-4ac3-a5ac-aa680945d7a7	Temporal Filling	Other	100000.00	Dental	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.375	2026-03-30 11:24:36.375	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
8f5942ab-25a9-4c57-8921-01ae11cc9027	FSH (Follicle-Stimulating Hormone	Other	50000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.398	2026-03-30 11:24:36.398	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
357a61fa-4f06-4884-9d22-73580cf5538f	Testosterone	Other	45000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.444	2026-03-30 11:24:36.444	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
3f33c90d-8226-468b-8e5b-64fc8e277bbc	BHCG (Human Chorionic	Other	50000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.493	2026-03-30 11:24:36.493	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
f502df82-d5a7-48e4-a67e-920d70739749	LH (Luteinizing Hormone	Other	50000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.623	2026-03-30 11:24:36.623	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
a016a0d1-429e-4dd0-8d30-6aceececaa9e	Estradiol	Other	45000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.843	2026-03-30 11:24:36.843	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
2501fb99-5c5d-4cc4-b68a-fba3b8ed9fa6	Prolactin	Other	45000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.903	2026-03-30 11:24:36.903	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
dd02198e-0c53-4e50-bff5-8289b3abc693	Pelvis Ultrasound	Other	80000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:36.961	2026-03-30 11:24:36.961	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
f222dc94-8f52-4f9a-80b8-9a28ef444ca8	Abdomen Ultrasound	Other	80000.00	Radiology	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:37.013	2026-03-30 11:24:37.013	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
a559beaa-4545-41c1-8cb0-0e2c1b0e40ba	Sickle Cell	Other	50000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:37.677	2026-03-30 11:24:37.677	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
47f47144-2299-45e1-8b7a-c301cb64845a	2hrs Post Prandial	Other	50000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:37.745	2026-03-30 11:24:37.745	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
629c045f-5221-4182-990c-64ae58ffcbf3	Random Blood Sugar (RBS)	Other	20000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:37.77	2026-03-30 11:24:37.77	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
fbfd7e76-f7c6-47e0-a5b5-b258a0b4416f	HbA/c	Other	45000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.002	2026-03-30 11:24:38.002	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
c10a2061-872b-4dbf-a6d2-a4705cf7ce97	Glucose Tolerance Test	Other	50000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.077	2026-03-30 11:24:38.077	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
22e73f1e-1222-47dd-9135-4c9581c1ca89	Urine For Sugar Acetone	Other	10000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.099	2026-03-30 11:24:38.099	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
37091e9e-f11f-48d5-a421-674f85ab260c	Fasting Blood Sugar (FBS)	Other	20000.00	Laboratory	7f99e814-4919-4249-9ada-dcae0223fcf9	t	\N	\N	2026-03-30 11:24:38.143	2026-03-30 11:24:38.143	other	\N	\N	\N	\N	fa91f080-6749-46ca-844b-8cbf43a9d406	f	\N	0.00	f	\N	t	\N
\.


--
-- Data for Name: stock_by_location; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand, reserved_quantity, last_counted, last_counted_by, recount_required, updated_at) FROM stdin;
55272365-286c-4c6a-b902-a00c4fffa3f1	1	42d42a1d-1011-4ad0-b61e-01e55f661457	c4e27e55-8004-4c8e-bfd7-f9fee6674a99	10	0	\N	\N	f	2026-03-27 12:36:31.901416
\.


--
-- Data for Name: stock_locations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock_locations (id, clinic_id, location_code, location_name, location_type, address, manager_user_id, is_active, capacity_description, created_at, updated_at, branch_id) FROM stdin;
c4e27e55-8004-4c8e-bfd7-f9fee6674a99	1	m	Main Store	storage	juba	\N	t	\N	2026-03-27 11:56:46.969719	2026-03-27 11:56:46.969719	\N
\.


--
-- Data for Name: supplier_bill_approvals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.supplier_bill_approvals (id, po_id, approval_level, approved_by, approved_by_title, notes, approved_at, user_id, signature) FROM stdin;
3b12e05e-bdf2-45ec-a2ef-5a46715ed2c5	1	1	Admin Kembe	CEO	\N	2026-04-03 00:32:19.199857	a63c3829-1709-49da-ae07-699d0e52082c	data:image/png;base64,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
97bd1dc4-1325-46b4-b55c-877ac487ecaf	1	2	Admin Kembe	\N	\N	2026-04-03 00:56:25.967599	a63c3829-1709-49da-ae07-699d0e52082c	data:image/png;base64,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
621b983e-1747-44c9-9638-1e5ab4efaad3	1	3	Admin Kembe	\N	\N	2026-04-03 00:56:47.072565	a63c3829-1709-49da-ae07-699d0e52082c	data:image/png;base64,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
\.


--
-- Data for Name: supplier_bill_payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.supplier_bill_payments (id, clinic_id, po_id, po_number, supplier_id, supplier_name, payment_date, amount_paid, payment_method, account_id, account_name, reference_number, notes, payment_voucher_number, paid_by, approved_by, created_by, created_at) FROM stdin;
d0d39407-94e5-456c-86d4-171c42effa70	1	1	PO-2026-0001	\N	Nile Hive Concept Co Ltd	2026-04-03	80000.00	Bank Transfer	9eba4107-889c-4c2f-ba38-395f747dafa4	Accounts Receivable - Patients	\N	\N	PV-79544469	k	\N	admin	2026-04-03 01:25:44.471309
\.


--
-- Data for Name: supplier_performance; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.supplier_performance (id, clinic_id, supplier_id, evaluation_date, delivery_timeliness, quality_of_goods, communication, pricing_competitiveness, overall_rating, comments, evaluator_id, created_at) FROM stdin;
\.


--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.suppliers (id, name, contact_person, phone, email, address, town, is_active, created_at, updated_at, clinic_id, supplier_code, supplier_type, tax_id, bank_account_name, bank_account_number, bank_name, payment_terms, credit_limit, currency, is_preferred, on_hold, hold_reason, performance_rating, total_purchases, total_paid, country) FROM stdin;
1	Nile Hive Concept Co Ltd	LEVI MARK	0922328046	levi@nilehc.tech	Munuki Block B	JUBA	t	2026-03-27 13:43:33.690765+02	2026-03-27 13:43:33.690765+02	1	SUP-0001	general	C0DBX28AI	\N	\N	\N	Net30	0.00	USD	f	f	\N	0.0	0.00	0.00	South Sudan
2	demo	i	0	j@h.com	\N	\N	t	2026-03-30 12:17:12.642133+02	2026-03-30 12:17:12.642133+02	1	SUP-0002	general	i	\N	\N	\N	Net30	0.00	SSP	f	f	\N	0.0	0.00	0.00	South Sudan
\.


--
-- Data for Name: user_branches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_branches (id, user_id, branch_id, is_primary, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, display_name, role, clinic, is_active, signature, branch_id, created_at, updated_at, clinic_id, status) FROM stdin;
a63c3829-1709-49da-ae07-699d0e52082c	kembe699@gmail.com	$2b$12$EJYaveS0O185kyGqpnyoquVhpYWKd1b8Wx20EvLiudmry9AuYkSd.	Admin Kembe	admin	IntelliCare	t	data:image/png;base64,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	1	2026-03-23 14:29:00.77806	2026-03-27 12:22:20.708	1	active
\.


--
-- Data for Name: visits; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.visits (id, patient_id, visit_date, chief_complaint, clinical_notes, vitals, lab_requests, diagnosis, diagnosis_code, patient_name, doctor_name, doctor_id, queue_id, status, clinic_id, branch_id, created_at, updated_at, prescription, follow_up_date, visit_type, closed_at, closed_by, completed_at) FROM stdin;
444ddcf3-c91b-49bf-8434-c1b7ebc31791	351c434f-778f-4162-8285-3edbf1e81039	2026-03-24 10:17:55.252	Body pain/aches	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Mami thomas	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	1d1b153f-f452-4dba-ac94-e47d48f08c5d	inactive	1	1	2026-03-24 10:17:55.268	2026-03-24 10:18:00.331	\N	\N	outpatient	2026-03-24 10:18:00.331	Admin Kembe	\N
175f032e-86f5-42a8-90e9-8dffe59fabc5	bbb36bc2-4834-4bfe-9b37-2311f79a716c	2026-03-24 10:17:48.538	Headache	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	John Ohisa	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	ffd13075-9a78-45a3-a927-27fc631cc835	inactive	1	1	2026-03-24 10:17:48.553	2026-03-24 10:18:04.596	\N	\N	outpatient	2026-03-24 10:18:04.595	Admin Kembe	\N
10d30651-b681-47f2-b5f0-4f80166e9c0d	351c434f-778f-4162-8285-3edbf1e81039	2026-03-24 10:17:43.749	Fever	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Mami thomas	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	63258d95-d363-497c-a795-b9e40f48ceb4	inactive	1	1	2026-03-24 10:17:43.778	2026-03-24 10:18:08.044	\N	\N	outpatient	2026-03-24 10:18:08.044	Admin Kembe	\N
5f94770a-59f2-4a08-91c0-0dc61e42b039	1b39c0a5-6107-4c62-9514-ea02c3fb5ed7	2026-03-24 10:17:38.465	Fever	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Maria Anthony	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	0359edf0-67a1-46d5-a7b1-1a78b92d3e6c	inactive	1	1	2026-03-24 10:17:38.488	2026-03-24 10:18:10.795	\N	\N	outpatient	2026-03-24 10:18:10.795	Admin Kembe	\N
149dd94d-a15c-40dc-8008-d9112cc9c23c	80980441-a1c1-483f-8d56-d6ac83732cae	2026-03-24 10:17:32.935	Headache	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Lil Been	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	3184925b-114a-4b73-828f-a2b3ae603219	inactive	1	1	2026-03-24 10:17:32.95	2026-03-24 10:18:13.741	\N	\N	outpatient	2026-03-24 10:18:13.741	Admin Kembe	\N
cd2d34d6-174d-4db7-b990-cd26b073f2ee	fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	2026-03-24 10:17:27.398	Fever	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Single Dee	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	77bd96b0-1bc2-4998-87ab-5d230b1d953b	inactive	1	1	2026-03-24 10:17:27.448	2026-03-24 10:18:16.679	\N	\N	outpatient	2026-03-24 10:18:16.679	Admin Kembe	\N
26a080d6-9594-4070-a4cc-e506a8503836	80980441-a1c1-483f-8d56-d6ac83732cae	2026-03-24 10:17:21.566	Headache	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Lil Been	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	5ed2a5fd-7e5f-4e61-9fcf-3f4eb4c43a2c	inactive	1	1	2026-03-24 10:17:21.588	2026-03-24 10:18:19.463	\N	\N	outpatient	2026-03-24 10:18:19.46	Admin Kembe	\N
52c47ef9-fdb0-4fbf-a277-5a9067419868	80980441-a1c1-483f-8d56-d6ac83732cae	2026-03-24 10:17:14.384	Fever	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Lil Been	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	917d3ea2-1fba-422e-a11c-a347ce45d9cd	inactive	1	1	2026-03-24 10:17:14.406	2026-03-24 10:18:22.936	\N	\N	outpatient	2026-03-24 10:18:22.934	Admin Kembe	\N
542436ca-7b98-4cd0-9d32-0105e26e6c92	fdea5b02-71e1-4a4d-9f45-65e237eb6fa1	2026-03-24 10:17:08.586	Headache	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Single Dee	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	b79afce9-0e7e-4b69-bd1a-fc69a381ab3c	inactive	1	1	2026-03-24 10:17:08.611	2026-03-24 10:18:27.565	\N	\N	outpatient	2026-03-24 10:18:27.565	Admin Kembe	\N
a550cdba-34a0-4034-a793-8633987ca074	f13d0c29-3fef-494a-9642-2f390835d83f	2026-03-24 10:17:01.269	Fever	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	null	\N	\N	Narting Abui Joseph	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	a7ded5fe-c7a7-40fd-9593-51b2c3d3f65a	inactive	1	1	2026-03-24 10:17:01.306	2026-03-24 10:18:31.363	\N	\N	outpatient	2026-03-24 10:18:31.361	Admin Kembe	\N
00bc3ea7-bb60-47fd-8ae9-1fedc59e2f92	d847f88c-e89d-444e-bf03-c15aed4b1d10	2026-03-30 17:01:53.123	Fever, Headache, Cough, Body pain/aches	\N	{"bloodPressure":"120/80","pulse":"75","temperature":"37","respiratoryRate":"18","oxygenSaturation":"98","weight":"90","height":"185","bmi":"26.3","notes":""}	["Serum Creatinine","Coagulation Profile"]	\N	\N	Martin Ssebuga	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	3541f258-2ce4-436a-a1ba-a4093e144d84	inactive	1	1	2026-03-30 17:01:53.167	2026-04-06 10:28:19.88	\N	\N	outpatient	2026-04-06 10:28:19.859	Admin Kembe	\N
c5e724d8-5eaf-432c-aedb-2e53574dee8d	f13d0c29-3fef-494a-9642-2f390835d83f	2026-03-26 08:56:33.577	Fever	\N	{"bloodPressure":"","pulse":"","temperature":"","respiratoryRate":"","oxygenSaturation":"","weight":"","height":"","bmi":"","notes":""}	["Blood Group & Rh Factor","Hepatitis C Virus Antibody"]	\N	\N	Narting Abui Joseph	Admin Kembe	a63c3829-1709-49da-ae07-699d0e52082c	f0654b32-9d89-4217-b2a2-f68f602a94fc	inactive	1	1	2026-03-26 08:56:33.6	2026-04-06 10:28:25.221	\N	\N	outpatient	2026-04-06 10:28:25.22	Admin Kembe	\N
\.


--
-- Data for Name: wards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wards (id, clinic_id, name, code, description, ward_type, capacity, current_occupancy, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Name: branches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.branches_id_seq', 1, false);


--
-- Name: cash_transfers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.cash_transfers_id_seq', 2, true);


--
-- Name: cashier_shifts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.cashier_shifts_id_seq', 4, true);


--
-- Name: clinic_names_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.clinic_names_id_seq', 1, false);


--
-- Name: currencies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.currencies_id_seq', 2, true);


--
-- Name: daily_expenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.daily_expenses_id_seq', 2, true);


--
-- Name: daily_financial_summary_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.daily_financial_summary_id_seq', 1, false);


--
-- Name: facilities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.facilities_id_seq', 1, false);


--
-- Name: ledger_accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ledger_accounts_id_seq', 1, false);


--
-- Name: multicurrency_report_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.multicurrency_report_settings_id_seq', 183, true);


--
-- Name: purchase_order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.purchase_order_items_id_seq', 1, true);


--
-- Name: purchase_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.purchase_orders_id_seq', 1, true);


--
-- Name: suppliers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.suppliers_id_seq', 2, true);


--
-- Name: user_branches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_branches_id_seq', 1, false);


--
-- Name: account_currency_balances account_currency_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_currency_balances
    ADD CONSTRAINT account_currency_balances_pkey PRIMARY KEY (id);


--
-- Name: account_ledger account_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_ledger
    ADD CONSTRAINT account_ledger_pkey PRIMARY KEY (id);


--
-- Name: accounting_suppliers accounting_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_suppliers
    ADD CONSTRAINT accounting_suppliers_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: batch_insurance_claims batch_insurance_claims_batch_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_insurance_claims
    ADD CONSTRAINT batch_insurance_claims_batch_number_key UNIQUE (batch_number);


--
-- Name: batch_insurance_claims batch_insurance_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_insurance_claims
    ADD CONSTRAINT batch_insurance_claims_pkey PRIMARY KEY (id);


--
-- Name: batch_usage_history batch_usage_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_usage_history
    ADD CONSTRAINT batch_usage_history_pkey PRIMARY KEY (id);


--
-- Name: beds beds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beds
    ADD CONSTRAINT beds_pkey PRIMARY KEY (id);


--
-- Name: bill_discounts bill_discounts_discount_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_discounts
    ADD CONSTRAINT bill_discounts_discount_number_key UNIQUE (discount_number);


--
-- Name: bill_discounts bill_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_discounts
    ADD CONSTRAINT bill_discounts_pkey PRIMARY KEY (id);


--
-- Name: bill_line_items bill_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_line_items
    ADD CONSTRAINT bill_line_items_pkey PRIMARY KEY (id);


--
-- Name: billing_follow_ups billing_follow_ups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_follow_ups
    ADD CONSTRAINT billing_follow_ups_pkey PRIMARY KEY (id);


--
-- Name: billing_settings billing_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_settings
    ADD CONSTRAINT billing_settings_pkey PRIMARY KEY (id);


--
-- Name: branch_access_audit_logs branch_access_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_access_audit_logs
    ADD CONSTRAINT branch_access_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: cash_transfers cash_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_transfers
    ADD CONSTRAINT cash_transfers_pkey PRIMARY KEY (id);


--
-- Name: cashier_shifts cashier_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashier_shifts
    ADD CONSTRAINT cashier_shifts_pkey PRIMARY KEY (id);


--
-- Name: chart_of_accounts chart_of_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT chart_of_accounts_pkey PRIMARY KEY (id);


--
-- Name: clinic_names clinic_names_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinic_names
    ADD CONSTRAINT clinic_names_pkey PRIMARY KEY (id);


--
-- Name: cogs_posting_log cogs_posting_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_posting_log
    ADD CONSTRAINT cogs_posting_log_pkey PRIMARY KEY (id);


--
-- Name: controlled_substance_log controlled_substance_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controlled_substance_log
    ADD CONSTRAINT controlled_substance_log_pkey PRIMARY KEY (id);


--
-- Name: cost_centers cost_centers_cost_center_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_centers
    ADD CONSTRAINT cost_centers_cost_center_code_key UNIQUE (cost_center_code);


--
-- Name: cost_centers cost_centers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_centers
    ADD CONSTRAINT cost_centers_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_credit_note_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_credit_note_number_key UNIQUE (credit_note_number);


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (id);


--
-- Name: currency_conversion_log currency_conversion_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_conversion_log
    ADD CONSTRAINT currency_conversion_log_pkey PRIMARY KEY (id);


--
-- Name: daily_expense_approvals daily_expense_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_expense_approvals
    ADD CONSTRAINT daily_expense_approvals_pkey PRIMARY KEY (id);


--
-- Name: daily_expenses daily_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_expenses
    ADD CONSTRAINT daily_expenses_pkey PRIMARY KEY (id);


--
-- Name: daily_financial_summary daily_financial_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_financial_summary
    ADD CONSTRAINT daily_financial_summary_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: dispensing_records dispensing_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispensing_records
    ADD CONSTRAINT dispensing_records_pkey PRIMARY KEY (id);


--
-- Name: dispensing_returns dispensing_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispensing_returns
    ADD CONSTRAINT dispensing_returns_pkey PRIMARY KEY (id);


--
-- Name: doctor_notes doctor_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_notes
    ADD CONSTRAINT doctor_notes_pkey PRIMARY KEY (id);


--
-- Name: dr_clinics dr_clinics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dr_clinics
    ADD CONSTRAINT dr_clinics_pkey PRIMARY KEY (id);


--
-- Name: drug_administrations drug_administrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_administrations
    ADD CONSTRAINT drug_administrations_pkey PRIMARY KEY (id);


--
-- Name: drug_allergies drug_allergies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_allergies
    ADD CONSTRAINT drug_allergies_pkey PRIMARY KEY (id);


--
-- Name: drug_interactions drug_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_interactions
    ADD CONSTRAINT drug_interactions_pkey PRIMARY KEY (id);


--
-- Name: drug_inventory drug_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_inventory
    ADD CONSTRAINT drug_inventory_pkey PRIMARY KEY (id);


--
-- Name: drug_pricing_history drug_pricing_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_pricing_history
    ADD CONSTRAINT drug_pricing_history_pkey PRIMARY KEY (id);


--
-- Name: drugs drugs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drugs
    ADD CONSTRAINT drugs_pkey PRIMARY KEY (id);


--
-- Name: exchange_adjustments exchange_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_adjustments
    ADD CONSTRAINT exchange_adjustments_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: expense_invoice_lines expense_invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_invoice_lines
    ADD CONSTRAINT expense_invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: expense_invoices expense_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_invoices
    ADD CONSTRAINT expense_invoices_pkey PRIMARY KEY (id);


--
-- Name: facilities facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);


--
-- Name: general_ledger general_ledger_gl_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_ledger
    ADD CONSTRAINT general_ledger_gl_number_key UNIQUE (gl_number);


--
-- Name: general_ledger general_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_ledger
    ADD CONSTRAINT general_ledger_pkey PRIMARY KEY (id);


--
-- Name: gl_line_items gl_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_line_items
    ADD CONSTRAINT gl_line_items_pkey PRIMARY KEY (id);


--
-- Name: goods_receipt_notes goods_receipt_notes_grn_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipt_notes
    ADD CONSTRAINT goods_receipt_notes_grn_number_key UNIQUE (grn_number);


--
-- Name: goods_receipt_notes goods_receipt_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipt_notes
    ADD CONSTRAINT goods_receipt_notes_pkey PRIMARY KEY (id);


--
-- Name: grn_line_items grn_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_line_items
    ADD CONSTRAINT grn_line_items_pkey PRIMARY KEY (id);


--
-- Name: inpatient_admissions inpatient_admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inpatient_admissions
    ADD CONSTRAINT inpatient_admissions_pkey PRIMARY KEY (id);


--
-- Name: inpatient_lab_requests inpatient_lab_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inpatient_lab_requests
    ADD CONSTRAINT inpatient_lab_requests_pkey PRIMARY KEY (id);


--
-- Name: inpatient_prescriptions inpatient_prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inpatient_prescriptions
    ADD CONSTRAINT inpatient_prescriptions_pkey PRIMARY KEY (id);


--
-- Name: inpatient_radiology_requests inpatient_radiology_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inpatient_radiology_requests
    ADD CONSTRAINT inpatient_radiology_requests_pkey PRIMARY KEY (id);


--
-- Name: insurance_batch_claim_items insurance_batch_claim_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_batch_claim_items
    ADD CONSTRAINT insurance_batch_claim_items_pkey PRIMARY KEY (id);


--
-- Name: insurance_batch_claim_status_history insurance_batch_claim_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_batch_claim_status_history
    ADD CONSTRAINT insurance_batch_claim_status_history_pkey PRIMARY KEY (id);


--
-- Name: insurance_batch_claims insurance_batch_claims_claim_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_batch_claims
    ADD CONSTRAINT insurance_batch_claims_claim_number_key UNIQUE (claim_number);


--
-- Name: insurance_batch_claims insurance_batch_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_batch_claims
    ADD CONSTRAINT insurance_batch_claims_pkey PRIMARY KEY (id);


--
-- Name: insurance_claims insurance_claims_claim_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_claims
    ADD CONSTRAINT insurance_claims_claim_number_key UNIQUE (claim_number);


--
-- Name: insurance_claims insurance_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_claims
    ADD CONSTRAINT insurance_claims_pkey PRIMARY KEY (id);


--
-- Name: inventory_adjustments inventory_adjustments_adjustment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_adjustment_number_key UNIQUE (adjustment_number);


--
-- Name: inventory_adjustments inventory_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_pkey PRIMARY KEY (id);


--
-- Name: inventory_batches inventory_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: inventory_settings inventory_settings_clinic_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_settings
    ADD CONSTRAINT inventory_settings_clinic_id_key UNIQUE (clinic_id);


--
-- Name: inventory_settings inventory_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_settings
    ADD CONSTRAINT inventory_settings_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_transaction_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_transaction_number_key UNIQUE (transaction_number);


--
-- Name: inventory_valuation inventory_valuation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_valuation
    ADD CONSTRAINT inventory_valuation_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: item_pricing_history item_pricing_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_pricing_history
    ADD CONSTRAINT item_pricing_history_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_je_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_je_number_key UNIQUE (je_number);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: lab_requests lab_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_requests
    ADD CONSTRAINT lab_requests_pkey PRIMARY KEY (id);


--
-- Name: lab_result_component_values lab_result_component_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_result_component_values
    ADD CONSTRAINT lab_result_component_values_pkey PRIMARY KEY (id);


--
-- Name: lab_results lab_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_results
    ADD CONSTRAINT lab_results_pkey PRIMARY KEY (id);


--
-- Name: lab_test_components lab_test_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_test_components
    ADD CONSTRAINT lab_test_components_pkey PRIMARY KEY (id);


--
-- Name: lab_tests lab_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_tests
    ADD CONSTRAINT lab_tests_pkey PRIMARY KEY (id);


--
-- Name: ledger_accounts ledger_accounts_account_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_accounts
    ADD CONSTRAINT ledger_accounts_account_code_key UNIQUE (account_code);


--
-- Name: ledger_accounts ledger_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_accounts
    ADD CONSTRAINT ledger_accounts_pkey PRIMARY KEY (id);


--
-- Name: multicurrency_report_settings multicurrency_report_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multicurrency_report_settings
    ADD CONSTRAINT multicurrency_report_settings_pkey PRIMARY KEY (id);


--
-- Name: nursing_notes nursing_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nursing_notes
    ADD CONSTRAINT nursing_notes_pkey PRIMARY KEY (id);


--
-- Name: patient_bills patient_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_bills
    ADD CONSTRAINT patient_bills_pkey PRIMARY KEY (id);


--
-- Name: patient_insurance patient_insurance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_insurance
    ADD CONSTRAINT patient_insurance_pkey PRIMARY KEY (id);


--
-- Name: patient_queue patient_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_queue
    ADD CONSTRAINT patient_queue_pkey PRIMARY KEY (id);


--
-- Name: patient_receivables patient_receivables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_receivables
    ADD CONSTRAINT patient_receivables_pkey PRIMARY KEY (id);


--
-- Name: patient_schemes patient_schemes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_schemes
    ADD CONSTRAINT patient_schemes_pkey PRIMARY KEY (id);


--
-- Name: patients patients_patient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_patient_id_key UNIQUE (patient_id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: pharmacy_audit_log pharmacy_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_audit_log
    ADD CONSTRAINT pharmacy_audit_log_pkey PRIMARY KEY (id);


--
-- Name: pharmacy_charges pharmacy_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_charges
    ADD CONSTRAINT pharmacy_charges_pkey PRIMARY KEY (id);


--
-- Name: pharmacy_dispensing pharmacy_dispensing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_dispensing
    ADD CONSTRAINT pharmacy_dispensing_pkey PRIMARY KEY (id);


--
-- Name: pharmacy_insurance_pricing pharmacy_insurance_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_insurance_pricing
    ADD CONSTRAINT pharmacy_insurance_pricing_pkey PRIMARY KEY (id);


--
-- Name: pharmacy_prescriptions pharmacy_prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_prescriptions
    ADD CONSTRAINT pharmacy_prescriptions_pkey PRIMARY KEY (id);


--
-- Name: pharmacy_settings pharmacy_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_settings
    ADD CONSTRAINT pharmacy_settings_pkey PRIMARY KEY (id);


--
-- Name: physical_count_lines physical_count_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_count_lines
    ADD CONSTRAINT physical_count_lines_pkey PRIMARY KEY (id);


--
-- Name: physical_inventory_counts physical_inventory_counts_count_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_inventory_counts
    ADD CONSTRAINT physical_inventory_counts_count_number_key UNIQUE (count_number);


--
-- Name: physical_inventory_counts physical_inventory_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_inventory_counts
    ADD CONSTRAINT physical_inventory_counts_pkey PRIMARY KEY (id);


--
-- Name: pr_line_items pr_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pr_line_items
    ADD CONSTRAINT pr_line_items_pkey PRIMARY KEY (id);


--
-- Name: prescription_lines prescription_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_lines
    ADD CONSTRAINT prescription_lines_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);


--
-- Name: procurement_settings procurement_settings_clinic_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_settings
    ADD CONSTRAINT procurement_settings_clinic_id_key UNIQUE (clinic_id);


--
-- Name: procurement_settings procurement_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procurement_settings
    ADD CONSTRAINT procurement_settings_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);


--
-- Name: purchase_requisitions purchase_requisitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_pkey PRIMARY KEY (id);


--
-- Name: purchase_requisitions purchase_requisitions_pr_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_pr_number_key UNIQUE (pr_number);


--
-- Name: receipts receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);


--
-- Name: receipts receipts_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_receipt_number_key UNIQUE (receipt_number);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: scheme_changes_history scheme_changes_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_changes_history
    ADD CONSTRAINT scheme_changes_history_pkey PRIMARY KEY (id);


--
-- Name: scheme_discounts scheme_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_discounts
    ADD CONSTRAINT scheme_discounts_pkey PRIMARY KEY (id);


--
-- Name: scheme_membership scheme_membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_membership
    ADD CONSTRAINT scheme_membership_pkey PRIMARY KEY (id);


--
-- Name: scheme_negotiated_prices scheme_negotiated_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_negotiated_prices
    ADD CONSTRAINT scheme_negotiated_prices_pkey PRIMARY KEY (id);


--
-- Name: scheme_price_rules scheme_price_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_price_rules
    ADD CONSTRAINT scheme_price_rules_pkey PRIMARY KEY (id);


--
-- Name: scheme_product_pricing_history scheme_product_pricing_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_product_pricing_history
    ADD CONSTRAINT scheme_product_pricing_history_pkey PRIMARY KEY (id);


--
-- Name: scheme_product_pricing scheme_product_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_product_pricing
    ADD CONSTRAINT scheme_product_pricing_pkey PRIMARY KEY (id);


--
-- Name: scheme_service_pricing_history scheme_service_pricing_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_service_pricing_history
    ADD CONSTRAINT scheme_service_pricing_history_pkey PRIMARY KEY (id);


--
-- Name: scheme_service_pricing scheme_service_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_service_pricing
    ADD CONSTRAINT scheme_service_pricing_pkey PRIMARY KEY (id);


--
-- Name: scheme_tiered_pricing scheme_tiered_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_tiered_pricing
    ADD CONSTRAINT scheme_tiered_pricing_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: stock_by_location stock_by_location_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_by_location
    ADD CONSTRAINT stock_by_location_pkey PRIMARY KEY (id);


--
-- Name: stock_locations stock_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_locations
    ADD CONSTRAINT stock_locations_pkey PRIMARY KEY (id);


--
-- Name: supplier_bill_approvals supplier_bill_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_approvals
    ADD CONSTRAINT supplier_bill_approvals_pkey PRIMARY KEY (id);


--
-- Name: supplier_bill_payments supplier_bill_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_payments
    ADD CONSTRAINT supplier_bill_payments_pkey PRIMARY KEY (id);


--
-- Name: supplier_performance supplier_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_performance
    ADD CONSTRAINT supplier_performance_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: billing_settings uk_billing_clinic; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_settings
    ADD CONSTRAINT uk_billing_clinic UNIQUE (clinic_id);


--
-- Name: patient_schemes uk_clinic_scheme_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_schemes
    ADD CONSTRAINT uk_clinic_scheme_code UNIQUE (clinic_id, scheme_code);


--
-- Name: scheme_discounts uk_discount_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_discounts
    ADD CONSTRAINT uk_discount_code UNIQUE (clinic_id, discount_code);


--
-- Name: scheme_negotiated_prices uk_neg_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_negotiated_prices
    ADD CONSTRAINT uk_neg_number UNIQUE (clinic_id, negotiation_number);


--
-- Name: scheme_membership uk_patient_scheme; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_membership
    ADD CONSTRAINT uk_patient_scheme UNIQUE (patient_id, scheme_id);


--
-- Name: pharmacy_settings uk_pharm_clinic; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_settings
    ADD CONSTRAINT uk_pharm_clinic UNIQUE (clinic_id);


--
-- Name: scheme_product_pricing uk_scheme_product_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_product_pricing
    ADD CONSTRAINT uk_scheme_product_date UNIQUE (scheme_id, product_id, product_type, effective_from);


--
-- Name: scheme_service_pricing uk_scheme_service_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheme_service_pricing
    ADD CONSTRAINT uk_scheme_service_date UNIQUE (scheme_id, service_id, effective_from);


--
-- Name: account_currency_balances unique_account_currency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_currency_balances
    ADD CONSTRAINT unique_account_currency UNIQUE (clinic_id, account_id, currency_code);


--
-- Name: multicurrency_report_settings unique_clinic; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multicurrency_report_settings
    ADD CONSTRAINT unique_clinic UNIQUE (clinic_id);


--
-- Name: chart_of_accounts unique_clinic_account_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT unique_clinic_account_code UNIQUE (clinic_id, account_code);


--
-- Name: stock_locations unique_clinic_location; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_locations
    ADD CONSTRAINT unique_clinic_location UNIQUE (clinic_id, location_code);


--
-- Name: accounting_suppliers unique_clinic_supplier_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_suppliers
    ADD CONSTRAINT unique_clinic_supplier_code UNIQUE (clinic_id, supplier_code);


--
-- Name: currencies unique_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT unique_code UNIQUE (code);


--
-- Name: departments unique_dept_code_clinic; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT unique_dept_code_clinic UNIQUE (department_code, clinic_id);


--
-- Name: drug_interactions unique_interaction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drug_interactions
    ADD CONSTRAINT unique_interaction UNIQUE (drug1_id, drug2_id);


--
-- Name: inventory_items unique_inv_clinic_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT unique_inv_clinic_code UNIQUE (clinic_id, item_code);


--
-- Name: inventory_valuation unique_item_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_valuation
    ADD CONSTRAINT unique_item_date UNIQUE (item_id, valuation_date);


--
-- Name: stock_by_location unique_item_location; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_by_location
    ADD CONSTRAINT unique_item_location UNIQUE (item_id, location_id);


--
-- Name: lab_test_components unique_test_component; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_test_components
    ADD CONSTRAINT unique_test_component UNIQUE (lab_test_id, component_name);


--
-- Name: beds uq_bed_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beds
    ADD CONSTRAINT uq_bed_number UNIQUE (clinic_id, bed_number);


--
-- Name: daily_financial_summary uq_daily_summary; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_financial_summary
    ADD CONSTRAINT uq_daily_summary UNIQUE (clinic_id, summary_date);


--
-- Name: rooms uq_room_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT uq_room_number UNIQUE (clinic_id, room_number);


--
-- Name: wards uq_ward_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wards
    ADD CONSTRAINT uq_ward_code UNIQUE (clinic_id, code);


--
-- Name: user_branches user_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_pkey PRIMARY KEY (id);


--
-- Name: user_branches user_branches_user_id_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_branch_id_key UNIQUE (user_id, branch_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visits visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);


--
-- Name: wards wards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wards
    ADD CONSTRAINT wards_pkey PRIMARY KEY (id);


--
-- Name: account_ledger_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_ledger_account_id ON public.account_ledger USING btree (account_id);


--
-- Name: account_ledger_clinic_id_account_id_transaction_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_ledger_clinic_id_account_id_transaction_date ON public.account_ledger USING btree (clinic_id, account_id, transaction_date);


--
-- Name: account_ledger_transaction_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_ledger_transaction_date ON public.account_ledger USING btree (transaction_date);


--
-- Name: account_ledger_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_ledger_transaction_id ON public.account_ledger USING btree (transaction_id);


--
-- Name: accounting_suppliers_clinic_id_supplier_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_suppliers_clinic_id_supplier_code ON public.accounting_suppliers USING btree (clinic_id, supplier_code);


--
-- Name: accounting_suppliers_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_suppliers_is_active ON public.accounting_suppliers USING btree (is_active);


--
-- Name: accounting_suppliers_supplier_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_suppliers_supplier_name ON public.accounting_suppliers USING btree (supplier_name);


--
-- Name: chart_of_accounts_account_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_of_accounts_account_type ON public.chart_of_accounts USING btree (account_type);


--
-- Name: chart_of_accounts_clinic_id_account_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chart_of_accounts_clinic_id_account_code ON public.chart_of_accounts USING btree (clinic_id, account_code);


--
-- Name: chart_of_accounts_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_of_accounts_is_active ON public.chart_of_accounts USING btree (is_active);


--
-- Name: cost_centers_clinic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cost_centers_clinic_id ON public.cost_centers USING btree (clinic_id);


--
-- Name: cost_centers_cost_center_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cost_centers_cost_center_code ON public.cost_centers USING btree (cost_center_code);


--
-- Name: cost_centers_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cost_centers_is_active ON public.cost_centers USING btree (is_active);


--
-- Name: dr_clinics_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dr_clinics_department ON public.dr_clinics USING btree (department);


--
-- Name: dr_clinics_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dr_clinics_is_active ON public.dr_clinics USING btree (is_active);


--
-- Name: dr_clinics_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dr_clinics_name ON public.dr_clinics USING btree (name);


--
-- Name: expense_invoice_lines_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_invoice_lines_account_id ON public.expense_invoice_lines USING btree (account_id);


--
-- Name: expense_invoice_lines_expense_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_invoice_lines_expense_invoice_id ON public.expense_invoice_lines USING btree (expense_invoice_id);


--
-- Name: expense_invoices_clinic_id_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_invoices_clinic_id_status ON public.expense_invoices USING btree (clinic_id, status);


--
-- Name: expense_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_invoices_due_date ON public.expense_invoices USING btree (due_date);


--
-- Name: expense_invoices_invoice_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_invoices_invoice_number ON public.expense_invoices USING btree (invoice_number);


--
-- Name: expense_invoices_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_invoices_supplier_id ON public.expense_invoices USING btree (supplier_id);


--
-- Name: general_ledger_clinic_id_transaction_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX general_ledger_clinic_id_transaction_date_status ON public.general_ledger USING btree (clinic_id, transaction_date, status);


--
-- Name: general_ledger_gl_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX general_ledger_gl_number ON public.general_ledger USING btree (gl_number);


--
-- Name: general_ledger_reference_module_reference_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX general_ledger_reference_module_reference_id ON public.general_ledger USING btree (reference_module, reference_id);


--
-- Name: general_ledger_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX general_ledger_status ON public.general_ledger USING btree (status);


--
-- Name: general_ledger_transaction_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX general_ledger_transaction_date ON public.general_ledger USING btree (transaction_date);


--
-- Name: gl_line_items_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gl_line_items_account_id ON public.gl_line_items USING btree (account_id);


--
-- Name: gl_line_items_gl_id_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gl_line_items_gl_id_account_id ON public.gl_line_items USING btree (gl_id, account_id);


--
-- Name: idx_acb_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acb_account ON public.account_currency_balances USING btree (account_id);


--
-- Name: idx_acb_currency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acb_currency ON public.account_currency_balances USING btree (currency_code);


--
-- Name: idx_al_clinic_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_al_clinic_account ON public.account_ledger USING btree (clinic_id, account_id, transaction_date);


--
-- Name: idx_as_supplier_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_as_supplier_name ON public.accounting_suppliers USING btree (supplier_name);


--
-- Name: idx_audit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_date ON public.audit_logs USING btree (created_at);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_module ON public.audit_logs USING btree (module);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_audit_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_module ON public.audit_logs USING btree (module, action);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_baal_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_baal_branch_id ON public.branch_access_audit_logs USING btree (branch_id);


--
-- Name: idx_baal_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_baal_user_id ON public.branch_access_audit_logs USING btree (user_id);


--
-- Name: idx_bd_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bd_bill ON public.bill_discounts USING btree (bill_id);


--
-- Name: idx_beds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_beds_status ON public.beds USING btree (ward_id, status);


--
-- Name: idx_bfu_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bfu_bill ON public.billing_follow_ups USING btree (bill_id);


--
-- Name: idx_bli_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bli_bill ON public.bill_line_items USING btree (bill_id);


--
-- Name: idx_bli_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bli_source ON public.bill_line_items USING btree (source_module, source_id);


--
-- Name: idx_buh_batch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buh_batch_date ON public.batch_usage_history USING btree (batch_id, usage_date);


--
-- Name: idx_cashier_shifts_cashier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cashier_shifts_cashier ON public.cashier_shifts USING btree (cashier_id, status);


--
-- Name: idx_cc_clinic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cc_clinic_id ON public.cost_centers USING btree (clinic_id);


--
-- Name: idx_ccl_conversion_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccl_conversion_date ON public.currency_conversion_log USING btree (conversion_date);


--
-- Name: idx_ccl_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccl_source ON public.currency_conversion_log USING btree (source_transaction_type, source_transaction_id);


--
-- Name: idx_clinic_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clinic_active ON public.patient_schemes USING btree (clinic_id, is_active);


--
-- Name: idx_cn_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_bill ON public.credit_notes USING btree (original_bill_id);


--
-- Name: idx_cn_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cn_patient ON public.credit_notes USING btree (patient_id);


--
-- Name: idx_coa_account_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coa_account_type ON public.chart_of_accounts USING btree (account_type);


--
-- Name: idx_cpl_clinic_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpl_clinic_period ON public.cogs_posting_log USING btree (clinic_id, posting_period);


--
-- Name: idx_csl_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_csl_clinic_date ON public.controlled_substance_log USING btree (clinic_id, dispensing_date);


--
-- Name: idx_da_drug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_drug ON public.drug_allergies USING btree (drug_id);


--
-- Name: idx_da_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_patient ON public.drug_allergies USING btree (patient_id);


--
-- Name: idx_dea_expense; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dea_expense ON public.daily_expense_approvals USING btree (expense_id);


--
-- Name: idx_dept_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_active ON public.departments USING btree (is_active);


--
-- Name: idx_dept_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_branch ON public.departments USING btree (branch_id);


--
-- Name: idx_dept_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_clinic ON public.departments USING btree (clinic_id);


--
-- Name: idx_dept_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dept_code ON public.departments USING btree (department_code);


--
-- Name: idx_di_drug1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_di_drug1 ON public.drug_interactions USING btree (drug1_id);


--
-- Name: idx_di_drug2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_di_drug2 ON public.drug_interactions USING btree (drug2_id);


--
-- Name: idx_dispensingrecords_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispensingrecords_branch ON public.dispensing_records USING btree (branch_id);


--
-- Name: idx_dispensingreturns_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispensingreturns_branch ON public.dispensing_returns USING btree (branch_id);


--
-- Name: idx_dph_drug_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dph_drug_date ON public.drug_pricing_history USING btree (drug_id, effective_from);


--
-- Name: idx_dr_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_clinic_date ON public.dispensing_records USING btree (clinic_id, dispensing_date);


--
-- Name: idx_dr_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_patient ON public.dispensing_records USING btree (patient_id);


--
-- Name: idx_dr_prescription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_prescription ON public.dispensing_records USING btree (prescription_id);


--
-- Name: idx_dr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dr_status ON public.dispensing_records USING btree (status);


--
-- Name: idx_dret_dispensing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dret_dispensing ON public.dispensing_returns USING btree (dispensing_record_id);


--
-- Name: idx_drugs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drugs_active ON public.drugs USING btree (is_active);


--
-- Name: idx_drugs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drugs_category ON public.drugs USING btree (therapeutic_category);


--
-- Name: idx_drugs_clinic_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drugs_clinic_code ON public.drugs USING btree (clinic_id, drug_code);


--
-- Name: idx_drugs_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drugs_inventory ON public.drugs USING btree (inventory_item_id);


--
-- Name: idx_ea_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ea_reference ON public.exchange_adjustments USING btree (reference_type, reference_id);


--
-- Name: idx_ea_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ea_status ON public.exchange_adjustments USING btree (adjustment_status);


--
-- Name: idx_ea_transaction_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ea_transaction_date ON public.exchange_adjustments USING btree (transaction_date);


--
-- Name: idx_ei_clinic_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ei_clinic_status ON public.expense_invoices USING btree (clinic_id, status);


--
-- Name: idx_ei_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ei_supplier ON public.expense_invoices USING btree (supplier_id);


--
-- Name: idx_eil_expense_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eil_expense_invoice ON public.expense_invoice_lines USING btree (expense_invoice_id);


--
-- Name: idx_er_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_active ON public.exchange_rates USING btree (is_active);


--
-- Name: idx_er_clinic_curr_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_clinic_curr_date ON public.exchange_rates USING btree (clinic_id, from_currency, to_currency, effective_date);


--
-- Name: idx_er_clinic_currency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_clinic_currency ON public.exchange_rates USING btree (clinic_id, from_currency, to_currency, effective_date);


--
-- Name: idx_er_currencies; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_currencies ON public.exchange_rates USING btree (from_currency, to_currency);


--
-- Name: idx_er_eff_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_er_eff_date ON public.exchange_rates USING btree (effective_date);


--
-- Name: idx_gl_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gl_clinic_date ON public.general_ledger USING btree (clinic_id, transaction_date, status);


--
-- Name: idx_gl_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gl_reference ON public.general_ledger USING btree (reference_module, reference_id);


--
-- Name: idx_glli_gl_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_glli_gl_account ON public.gl_line_items USING btree (gl_id, account_id);


--
-- Name: idx_grn_clinic_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_clinic_po ON public.goods_receipt_notes USING btree (clinic_id, po_id);


--
-- Name: idx_grnli_grn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grnli_grn ON public.grn_line_items USING btree (grn_id);


--
-- Name: idx_ia_clinic_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ia_clinic_status ON public.inventory_adjustments USING btree (clinic_id, approval_status);


--
-- Name: idx_ib_clinic_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ib_clinic_expiry ON public.inventory_batches USING btree (clinic_id, expiry_date);


--
-- Name: idx_ib_item_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ib_item_location ON public.inventory_batches USING btree (item_id, location_id);


--
-- Name: idx_ibci_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ibci_claim_id ON public.insurance_batch_claim_items USING btree (claim_id);


--
-- Name: idx_ibci_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ibci_invoice_id ON public.insurance_batch_claim_items USING btree (invoice_id);


--
-- Name: idx_ibcsh_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ibcsh_claim_id ON public.insurance_batch_claim_status_history USING btree (claim_id);


--
-- Name: idx_ic_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ic_bill ON public.insurance_claims USING btree (bill_id);


--
-- Name: idx_ic_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ic_patient ON public.insurance_claims USING btree (patient_id);


--
-- Name: idx_ic_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ic_status ON public.insurance_claims USING btree (status);


--
-- Name: idx_insuranceclaims_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insuranceclaims_branch ON public.insurance_claims USING btree (branch_id);


--
-- Name: idx_inv_batches_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_batches_expiry ON public.inventory_batches USING btree (expiry_date);


--
-- Name: idx_inv_batches_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_batches_item ON public.inventory_batches USING btree (item_id, status);


--
-- Name: idx_inv_batches_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_batches_item_id ON public.inventory_batches USING btree (item_id);


--
-- Name: idx_inv_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_batches_status ON public.inventory_batches USING btree (status);


--
-- Name: idx_inv_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_items_active ON public.inventory_items USING btree (is_active);


--
-- Name: idx_inv_items_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_items_branch ON public.inventory_items USING btree (branch_id);


--
-- Name: idx_inv_items_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_items_clinic ON public.inventory_items USING btree (clinic_id);


--
-- Name: idx_inv_items_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_items_name ON public.inventory_items USING btree (item_name);


--
-- Name: idx_inventoryadjustments_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventoryadjustments_branch ON public.inventory_adjustments USING btree (branch_id);


--
-- Name: idx_inventorybatches_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventorybatches_branch ON public.inventory_batches USING btree (branch_id);


--
-- Name: idx_inventorytransactions_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventorytransactions_branch ON public.inventory_transactions USING btree (branch_id);


--
-- Name: idx_invitems_clinic_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitems_clinic_active ON public.inventory_items USING btree (clinic_id, is_active);


--
-- Name: idx_invitems_clinic_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitems_clinic_cat ON public.inventory_items USING btree (clinic_id, item_category);


--
-- Name: idx_invoice_items_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_invoice ON public.invoice_items USING btree (invoice_id);


--
-- Name: idx_invoice_payments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_invoice ON public.invoice_payments USING btree (invoice_id);


--
-- Name: idx_invoices_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_branch ON public.invoices USING btree (branch_id);


--
-- Name: idx_invoices_scheme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_scheme ON public.invoices USING btree (scheme_id);


--
-- Name: idx_ip_admission_bed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_admission_bed ON public.inpatient_admissions USING btree (bed_id, status);


--
-- Name: idx_ip_admission_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_admission_patient ON public.inpatient_admissions USING btree (patient_id, status);


--
-- Name: idx_ip_admission_ward; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_admission_ward ON public.inpatient_admissions USING btree (ward_id, status);


--
-- Name: idx_ip_doctor_notes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_doctor_notes ON public.doctor_notes USING btree (admission_id, note_date);


--
-- Name: idx_ip_drug_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_drug_admin ON public.drug_administrations USING btree (prescription_id);


--
-- Name: idx_ip_lab_requests; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_lab_requests ON public.inpatient_lab_requests USING btree (admission_id, status);


--
-- Name: idx_ip_nursing_notes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_nursing_notes ON public.nursing_notes USING btree (admission_id, note_date);


--
-- Name: idx_ip_prescriptions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_prescriptions ON public.inpatient_prescriptions USING btree (admission_id, status);


--
-- Name: idx_ip_radiology; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ip_radiology ON public.inpatient_radiology_requests USING btree (admission_id, status);


--
-- Name: idx_iph_item_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iph_item_date ON public.item_pricing_history USING btree (item_id, effective_from);


--
-- Name: idx_ir_clinic_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_clinic_item ON public.inventory_reservations USING btree (clinic_id, item_id);


--
-- Name: idx_ir_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_status ON public.inventory_reservations USING btree (status);


--
-- Name: idx_it_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_clinic_date ON public.inventory_transactions USING btree (clinic_id, transaction_date);


--
-- Name: idx_it_item_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_it_item_type ON public.inventory_transactions USING btree (item_id, transaction_type);


--
-- Name: idx_iv_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iv_clinic_date ON public.inventory_valuation USING btree (clinic_id, valuation_date);


--
-- Name: idx_je_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_je_clinic_date ON public.journal_entries USING btree (clinic_id, entry_date, status);


--
-- Name: idx_jel_je_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jel_je_account ON public.journal_entry_lines USING btree (je_id, account_id);


--
-- Name: idx_lab_requests_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lab_requests_clinic ON public.lab_requests USING btree (clinic_id);


--
-- Name: idx_lab_requests_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lab_requests_patient_id ON public.lab_requests USING btree (patient_id);


--
-- Name: idx_lab_requests_visit_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lab_requests_visit_id ON public.lab_requests USING btree (visit_id);


--
-- Name: idx_lab_results_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lab_results_patient_id ON public.lab_results USING btree (patient_id);


--
-- Name: idx_labrequests_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labrequests_branch ON public.lab_requests USING btree (branch_id);


--
-- Name: idx_labresults_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labresults_branch ON public.lab_results USING btree (branch_id);


--
-- Name: idx_lr_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_patient ON public.lab_requests USING btree (patient_id);


--
-- Name: idx_lr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lr_status ON public.lab_requests USING btree (status);


--
-- Name: idx_lres_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lres_patient ON public.lab_results USING btree (patient_id);


--
-- Name: idx_ltc_lab_test_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ltc_lab_test_id ON public.lab_test_components USING btree (lab_test_id);


--
-- Name: idx_pal_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pal_clinic_date ON public.pharmacy_audit_log USING btree (clinic_id, action_date);


--
-- Name: idx_patient_bills_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_bills_bill_id ON public.patient_bills USING btree (bill_id);


--
-- Name: idx_patient_bills_bill_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_bills_bill_number ON public.patient_bills USING btree (bill_number);


--
-- Name: idx_patient_bills_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_bills_clinic ON public.patient_bills USING btree (clinic_id);


--
-- Name: idx_patient_bills_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_bills_patient ON public.patient_bills USING btree (patient_id);


--
-- Name: idx_patient_queue_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_queue_branch ON public.patient_queue USING btree (branch_id);


--
-- Name: idx_patient_queue_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_queue_clinic ON public.patient_queue USING btree (clinic_id);


--
-- Name: idx_patient_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patient_queue_status ON public.patient_queue USING btree (status);


--
-- Name: idx_patientbills_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patientbills_branch ON public.patient_bills USING btree (branch_id);


--
-- Name: idx_patientqueue_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patientqueue_branch ON public.patient_queue USING btree (branch_id);


--
-- Name: idx_patients_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_branch_id ON public.patients USING btree (branch_id);


--
-- Name: idx_patients_clinic_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_clinic_branch ON public.patients USING btree (clinic_id, branch_id);


--
-- Name: idx_patients_clinic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_clinic_id ON public.patients USING btree (clinic_id);


--
-- Name: idx_patients_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_patient_id ON public.patients USING btree (patient_id);


--
-- Name: idx_pc_patient_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_patient_date ON public.pharmacy_charges USING btree (patient_id, charge_date);


--
-- Name: idx_pcl_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcl_count ON public.physical_count_lines USING btree (count_id);


--
-- Name: idx_pharmacycharges_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pharmacycharges_branch ON public.pharmacy_charges USING btree (branch_id);


--
-- Name: idx_pharmacyprescriptions_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pharmacyprescriptions_branch ON public.pharmacy_prescriptions USING btree (branch_id);


--
-- Name: idx_physicalinventorycounts_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_physicalinventorycounts_branch ON public.physical_inventory_counts USING btree (branch_id);


--
-- Name: idx_pi_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_patient ON public.patient_insurance USING btree (patient_id, is_active);


--
-- Name: idx_pic_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pic_clinic_date ON public.physical_inventory_counts USING btree (clinic_id, count_date);


--
-- Name: idx_pip_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pip_clinic ON public.pharmacy_insurance_pricing USING btree (clinic_id, insurance_type);


--
-- Name: idx_pl_drug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_drug ON public.prescription_lines USING btree (drug_id);


--
-- Name: idx_pl_prescription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_prescription ON public.prescription_lines USING btree (prescription_id);


--
-- Name: idx_pl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_status ON public.prescription_lines USING btree (status);


--
-- Name: idx_poi_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_po_id ON public.purchase_order_items USING btree (purchase_order_id);


--
-- Name: idx_pp_clinic_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_clinic_status ON public.pharmacy_prescriptions USING btree (clinic_id, status);


--
-- Name: idx_pp_patient_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_patient_date ON public.pharmacy_prescriptions USING btree (patient_id, prescription_date);


--
-- Name: idx_pp_rx_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_rx_number ON public.pharmacy_prescriptions USING btree (prescription_number);


--
-- Name: idx_pp_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_visit ON public.pharmacy_prescriptions USING btree (visit_id);


--
-- Name: idx_pr_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_bill_id ON public.patient_receivables USING btree (bill_id);


--
-- Name: idx_pr_clinic_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_clinic_date ON public.purchase_requisitions USING btree (clinic_id, requisition_date);


--
-- Name: idx_pr_clinic_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_clinic_status ON public.patient_receivables USING btree (clinic_id, status);


--
-- Name: idx_prli_pr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prli_pr ON public.pr_line_items USING btree (pr_id);


--
-- Name: idx_receipts_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_bill_id ON public.receipts USING btree (bill_id);


--
-- Name: idx_receipts_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_patient_id ON public.receipts USING btree (patient_id);


--
-- Name: idx_rooms_ward; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_ward ON public.rooms USING btree (ward_id);


--
-- Name: idx_sba_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sba_po ON public.supplier_bill_approvals USING btree (po_id);


--
-- Name: idx_sbl_clinic_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sbl_clinic_item ON public.stock_by_location USING btree (clinic_id, item_id);


--
-- Name: idx_sch_scheme_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sch_scheme_date ON public.scheme_changes_history USING btree (scheme_id, change_date);


--
-- Name: idx_scheme_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheme_type ON public.patient_schemes USING btree (scheme_type);


--
-- Name: idx_sd_clinic_scheme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sd_clinic_scheme ON public.scheme_discounts USING btree (clinic_id, scheme_id);


--
-- Name: idx_sl_clinic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sl_clinic ON public.stock_locations USING btree (clinic_id);


--
-- Name: idx_sm_clinic_scheme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_clinic_scheme ON public.scheme_membership USING btree (clinic_id, scheme_id);


--
-- Name: idx_sm_patient_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_patient_active ON public.scheme_membership USING btree (patient_id, is_active);


--
-- Name: idx_snp_clinic_scheme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snp_clinic_scheme ON public.scheme_negotiated_prices USING btree (clinic_id, scheme_id);


--
-- Name: idx_snp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snp_status ON public.scheme_negotiated_prices USING btree (status);


--
-- Name: idx_sp_clinic_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sp_clinic_supplier ON public.supplier_performance USING btree (clinic_id, supplier_id);


--
-- Name: idx_spp_clinic_scheme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spp_clinic_scheme ON public.scheme_product_pricing USING btree (clinic_id, scheme_id);


--
-- Name: idx_spp_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spp_product ON public.scheme_product_pricing USING btree (product_id, product_type);


--
-- Name: idx_spph_scheme_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spph_scheme_product ON public.scheme_product_pricing_history USING btree (scheme_id, product_id);


--
-- Name: idx_spr_scheme_rules; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spr_scheme_rules ON public.scheme_price_rules USING btree (scheme_id, is_active);


--
-- Name: idx_ssp_clinic_scheme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssp_clinic_scheme ON public.scheme_service_pricing USING btree (clinic_id, scheme_id);


--
-- Name: idx_ssp_service_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssp_service_active ON public.scheme_service_pricing USING btree (service_id, is_active);


--
-- Name: idx_ssph_scheme_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssph_scheme_service ON public.scheme_service_pricing_history USING btree (scheme_id, service_id);


--
-- Name: idx_stocklocations_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stocklocations_branch ON public.stock_locations USING btree (branch_id);


--
-- Name: idx_stp_scheme_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stp_scheme_tier ON public.scheme_tiered_pricing USING btree (scheme_id, tier_level);


--
-- Name: idx_svc_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_svc_category ON public.services USING btree (category);


--
-- Name: idx_ub_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ub_branch_id ON public.user_branches USING btree (branch_id);


--
-- Name: idx_ub_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ub_user_id ON public.user_branches USING btree (user_id);


--
-- Name: idx_user_branches_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_branches_user_id ON public.user_branches USING btree (user_id);


--
-- Name: idx_user_branches_user_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_branches_user_primary ON public.user_branches USING btree (user_id, is_primary);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_id_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_id_active ON public.users USING btree (id, is_active);


--
-- Name: idx_visits_clinic_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_clinic_branch ON public.visits USING btree (clinic_id, branch_id);


--
-- Name: idx_visits_doctor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_doctor_id ON public.visits USING btree (doctor_id);


--
-- Name: idx_visits_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_patient_id ON public.visits USING btree (patient_id);


--
-- Name: idx_visits_visit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visits_visit_date ON public.visits USING btree (visit_date);


--
-- Name: journal_entries_clinic_id_entry_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_clinic_id_entry_date_status ON public.journal_entries USING btree (clinic_id, entry_date, status);


--
-- Name: journal_entries_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_created_by ON public.journal_entries USING btree (created_by);


--
-- Name: journal_entries_je_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journal_entries_je_number ON public.journal_entries USING btree (je_number);


--
-- Name: journal_entries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_status ON public.journal_entries USING btree (status);


--
-- Name: journal_entry_lines_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entry_lines_account_id ON public.journal_entry_lines USING btree (account_id);


--
-- Name: journal_entry_lines_je_id_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entry_lines_je_id_account_id ON public.journal_entry_lines USING btree (je_id, account_id);


--
-- Name: patient_receivables_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_receivables_bill_id ON public.patient_receivables USING btree (bill_id);


--
-- Name: patient_receivables_clinic_id_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_receivables_clinic_id_status ON public.patient_receivables USING btree (clinic_id, status);


--
-- Name: patient_receivables_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_receivables_due_date ON public.patient_receivables USING btree (due_date);


--
-- Name: patient_receivables_patient_id_amount_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_receivables_patient_id_amount_due ON public.patient_receivables USING btree (patient_id, amount_due);


--
-- Name: patient_receivables_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patient_receivables_status ON public.patient_receivables USING btree (status);


--
-- Name: prescriptions_clinic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prescriptions_clinic_id ON public.prescriptions USING btree (clinic_id);


--
-- Name: prescriptions_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prescriptions_patient_id ON public.prescriptions USING btree (patient_id);


--
-- Name: prescriptions_prescribed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prescriptions_prescribed_at ON public.prescriptions USING btree (prescribed_at);


--
-- Name: prescriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prescriptions_status ON public.prescriptions USING btree (status);


--
-- Name: prescriptions_visit_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prescriptions_visit_id ON public.prescriptions USING btree (visit_id);


--
-- Name: receipts_bill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_bill_id ON public.receipts USING btree (bill_id);


--
-- Name: receipts_clinic_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_clinic_id ON public.receipts USING btree (clinic_id);


--
-- Name: receipts_patient_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_patient_id ON public.receipts USING btree (patient_id);


--
-- Name: receipts_payment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_payment_date ON public.receipts USING btree (payment_date);


--
-- Name: receipts_receipt_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receipts_receipt_number ON public.receipts USING btree (receipt_number);


--
-- Name: branches branches_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id);


--
-- Name: cashier_shifts cashier_shifts_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashier_shifts
    ADD CONSTRAINT cashier_shifts_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.users(id);


--
-- Name: lab_requests lab_requests_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_requests
    ADD CONSTRAINT lab_requests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: lab_results lab_results_lab_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_results
    ADD CONSTRAINT lab_results_lab_request_id_fkey FOREIGN KEY (lab_request_id) REFERENCES public.lab_requests(id);


--
-- Name: lab_results lab_results_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_results
    ADD CONSTRAINT lab_results_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: lab_test_components lab_test_components_lab_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_test_components
    ADD CONSTRAINT lab_test_components_lab_test_id_fkey FOREIGN KEY (lab_test_id) REFERENCES public.lab_tests(id);


--
-- Name: ledger_accounts ledger_accounts_parent_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_accounts
    ADD CONSTRAINT ledger_accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.ledger_accounts(id);


--
-- Name: patient_bills patient_bills_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_bills
    ADD CONSTRAINT patient_bills_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: patient_queue patient_queue_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patient_queue
    ADD CONSTRAINT patient_queue_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: pharmacy_dispensing pharmacy_dispensing_drug_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_dispensing
    ADD CONSTRAINT pharmacy_dispensing_drug_id_fkey FOREIGN KEY (drug_id) REFERENCES public.drug_inventory(id);


--
-- Name: pharmacy_dispensing pharmacy_dispensing_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pharmacy_dispensing
    ADD CONSTRAINT pharmacy_dispensing_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: prescriptions prescriptions_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: purchase_order_items purchase_order_items_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: receipts receipts_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: user_branches user_branches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: user_branches user_branches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: visits visits_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- PostgreSQL database dump complete
--

\unrestrict YJZFd6zRJbRDoWgHVN63yBtPEQou95gHR6hhb6j2NgiN9yHFKX41Mgb0JK3174u


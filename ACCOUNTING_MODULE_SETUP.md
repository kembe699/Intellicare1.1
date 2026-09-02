# IntelliCare Accounting Module - Setup & Documentation

## Overview

The IntelliCare Accounting Module is a comprehensive enterprise-grade financial management system designed specifically for healthcare facilities. It provides complete double-entry bookkeeping, financial reporting, and integration with the existing patient billing system.

## Features Implemented

### ✅ Core Accounting Features
- **Chart of Accounts**: Healthcare-specific account structure (Assets, Liabilities, Equity, Revenue, Expenses)
- **General Ledger**: Complete double-entry bookkeeping system
- **Journal Entries**: Manual accounting entries with approval workflow
- **Account Ledger**: Detailed transaction history per account
- **Trial Balance**: Automated balance verification

### ✅ Billing Integration
- **Automatic GL Entries**: Patient bills automatically create receivables and revenue entries
- **Payment Processing**: Receipts automatically update cash and receivables
- **Lab Request Billing**: Integrated with lab test billing
- **Pharmacy Sales**: Cost of goods sold tracking

### ✅ Financial Reporting
- **Income Statement (P&L)**: Revenue and expense reporting
- **Balance Sheet**: Assets, liabilities, and equity positions
- **Trial Balance**: Debit/credit balance verification
- **Aging Reports**: Receivables and payables aging analysis

### ✅ User Management
- **New Roles**: `accountant`, `finance_manager`, `auditor`
- **Role-Based Access**: Granular permissions for accounting functions
- **Audit Trail**: Complete transaction logging

### ✅ Frontend Interface
- **Accounting Dashboard**: Financial overview and quick actions
- **Chart of Accounts Management**: Create and manage accounts
- **Journal Entry Interface**: Multi-line entry creation
- **Financial Reports**: Interactive report generation

## Database Schema

### Core Tables Created

1. **chart_of_accounts** - Account master data
2. **general_ledger** - Main transaction entries
3. **gl_line_items** - Detailed line items for GL entries
4. **account_ledger** - Account-specific transaction history
5. **journal_entries** - Manual journal entries
6. **journal_entry_lines** - Journal entry line items
7. **patient_receivables** - Patient billing receivables tracking
8. **suppliers** - Supplier master for payables
9. **expense_invoices** - Supplier invoice management
10. **expense_invoice_lines** - Invoice line items
11. **cost_centers** - Cost center tracking

## Installation & Setup

### Step 1: Database Migration

Run the accounting tables migration script:

```bash
cd server/scripts
node migrateAccountingTables.js
```

This will:
- Create all accounting tables with proper relationships
- Initialize Chart of Accounts for all existing clinics
- Set up healthcare-specific account structure

### Step 2: Update User Roles

The system now supports three new user roles:
- `accountant` - Create journal entries, manage suppliers, process expenses
- `finance_manager` - Approve transactions, run reports, access GL
- `auditor` - Read-only access to all accounting data

Update user roles in the database as needed:

```sql
UPDATE users SET role = 'accountant' WHERE email = 'accountant@clinic.com';
UPDATE users SET role = 'finance_manager' WHERE email = 'finance@clinic.com';
UPDATE users SET role = 'auditor' WHERE email = 'auditor@clinic.com';
```

### Step 3: Access the Accounting Module

Navigate to `/accounting` in the IntelliCare application. The module includes:

1. **Dashboard Tab**: Financial overview and quick actions
2. **Chart of Accounts Tab**: Account management
3. **General Ledger Tab**: View GL entries
4. **Journal Entries Tab**: Create manual entries
5. **Receivables Tab**: Patient receivables management
6. **Reports Tab**: Financial statement generation

## Healthcare-Specific Chart of Accounts

The system initializes with a comprehensive healthcare-focused chart of accounts:

### Assets (1000-1999)
- **1100** - Cash
- **1110** - Bank Account - Main
- **1200** - Accounts Receivable - Patients
- **1210** - Insurance Receivables
- **1300** - Medical Supplies Inventory
- **1310** - Pharmaceutical Inventory
- **1500** - Medical Equipment
- **1510** - Laboratory Equipment

### Liabilities (2000-2999)
- **2100** - Accounts Payable - Suppliers
- **2200** - Payroll Liabilities
- **2210** - PAYE Tax Payable
- **2220** - NHIF Contributions Payable
- **2300** - VAT Payable

### Equity (3000-3999)
- **3100** - Owner's Capital
- **3200** - Retained Earnings

### Revenue (4000-4999)
- **4100** - Patient Services Revenue
- **4110** - Laboratory Services Revenue
- **4120** - Pharmacy Sales Revenue
- **4130** - Radiology Services Revenue

### Expenses (5000-5999)
- **5100** - Salaries and Wages
- **5110** - Doctor Fees
- **5200** - Medical Supplies Expense
- **5210** - Pharmaceutical Cost of Sales
- **5300** - Rent Expense
- **5310** - Utilities Expense

## API Endpoints

### Chart of Accounts
- `GET /api/accounting/chart-of-accounts` - List accounts
- `POST /api/accounting/chart-of-accounts` - Create account
- `POST /api/accounting/chart-of-accounts/initialize` - Initialize default accounts

### General Ledger
- `GET /api/accounting/general-ledger` - List GL entries
- `POST /api/accounting/general-ledger` - Create GL entry
- `POST /api/accounting/general-ledger/:id/post` - Post GL entry

### Journal Entries
- `GET /api/accounting/journal-entries` - List journal entries
- `POST /api/accounting/journal-entries` - Create journal entry
- `POST /api/accounting/journal-entries/:id/submit` - Submit for approval
- `POST /api/accounting/journal-entries/:id/approve` - Approve entry

### Financial Reports
- `GET /api/accounting/reports/trial-balance` - Generate trial balance
- `GET /api/accounting/reports/income-statement` - Generate P&L
- `GET /api/accounting/reports/balance-sheet` - Generate balance sheet

### Receivables
- `GET /api/accounting/patient-receivables` - List receivables
- `GET /api/accounting/patient-receivables/aging` - Aging analysis

## Automatic Integration

### Patient Billing Integration

When a patient bill is created, the system automatically:

1. **Creates GL Entry**:
   - Dr. Accounts Receivable (1200)
   - Cr. Patient Services Revenue (4100)

2. **Creates Receivable Record**:
   - Tracks outstanding balance
   - Manages payment status
   - Calculates aging

### Payment Processing Integration

When a payment is received, the system automatically:

1. **Creates GL Entry**:
   - Dr. Cash (1100)
   - Cr. Accounts Receivable (1200)

2. **Updates Receivables**:
   - Reduces outstanding balance
   - Updates payment status
   - Records payment date

## Business Rules

### Double-Entry Bookkeeping
- All transactions must balance (Total Debits = Total Credits)
- GL entries cannot be posted if unbalanced
- Journal entries require approval for amounts > threshold

### Account Management
- Account codes must be unique per clinic
- Cannot delete accounts with transactions
- Account types determine normal balance (debit/credit)

### Financial Periods
- Transactions are date-based
- Reports can be generated for any date range
- Period-end closing procedures available

## Security & Audit Trail

### Role-Based Access Control
- **Accountant**: Create entries, manage suppliers
- **Finance Manager**: Approve transactions, run reports
- **Auditor**: Read-only access to all data
- **Admin**: Full access to all features

### Audit Logging
- All GL entries logged with user and timestamp
- Transaction history preserved
- Approval workflow tracked
- Report access logged

## Troubleshooting

### Common Issues

1. **Chart of Accounts Not Initialized**
   - Run the initialization script: `POST /api/accounting/chart-of-accounts/initialize`

2. **GL Entries Not Balancing**
   - Check that total debits equal total credits
   - Verify account types and balance types

3. **Permission Denied**
   - Ensure user has appropriate role (accountant, finance_manager, auditor)
   - Check role assignments in users table

4. **Reports Not Loading**
   - Verify clinic_id parameter
   - Check date ranges for reports
   - Ensure accounts have transactions

### Database Maintenance

1. **Backup Accounting Data**
   ```sql
   -- Backup all accounting tables
   mysqldump -u username -p database_name chart_of_accounts general_ledger gl_line_items account_ledger journal_entries journal_entry_lines patient_receivables > accounting_backup.sql
   ```

2. **Verify Data Integrity**
   ```sql
   -- Check trial balance
   SELECT 
     SUM(debit_amount) as total_debits,
     SUM(credit_amount) as total_credits
   FROM account_ledger 
   WHERE is_posted = true;
   ```

## Future Enhancements

### Phase 2 Features (Pending)
- Bank reconciliation system
- Advanced cost center reporting
- Budget management and variance analysis
- Multi-currency support
- Automated depreciation calculations

### Phase 3 Features (Planned)
- Cash flow forecasting
- Financial dashboard widgets
- Integration with external accounting systems
- Advanced audit and compliance features

## Support

For technical support or questions about the accounting module:

1. Check the troubleshooting section above
2. Review the API documentation
3. Examine server logs for detailed error messages
4. Verify database schema and relationships

## Compliance

The accounting module is designed to support:
- Kenya Revenue Authority (KRA) requirements
- VAT reporting and compliance
- PAYE and NHIF contribution tracking
- Healthcare industry financial standards
- Audit and regulatory requirements

---

**Version**: 1.0.0  
**Last Updated**: March 2026  
**Compatibility**: IntelliCare v2.0+

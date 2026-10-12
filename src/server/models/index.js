const { Sequelize, DataTypes } = require('sequelize');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const { reportSchemaGuardFailure } = require('../utils/legacyDDL');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables robustly
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'production.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../production.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../production.env') });

// Use centralized database config
function createModels(sequelize) {

// Define User model
const User = sequelize.define('User', {
  // users.id is a real MySQL INT AUTO_INCREMENT column on this deployment (unlike most
  // other tables in this app, which use UUID primary keys) — this was previously declared
  // as DataTypes.UUID, which doesn't match the actual column and made User.create() fail
  // ("Data truncated for column 'id'") whenever calling code (correctly, per this model's
  // stated type) tried to supply a generated UUID string for a new user.
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  display_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // Plain string, not DataTypes.ENUM — the actual users.role column has been plain
  // TEXT for a while (no DB-level enum constraint at all), but Sequelize's ENUM type
  // validates client-side against exactly the list given here before a query is even
  // sent. Security.tsx's role dropdown is fed live from GET /api/roles, which includes
  // any custom role an admin creates (e.g. "Branch Manager") alongside the system
  // ones — so picking a custom role as a user's primary role always 500'd with a
  // Sequelize ValidationError, even though the database itself would have accepted it.
  role: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  clinic_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'inactive'),
    defaultValue: 'pending',
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  signature: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
  },
  current_room_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
});

// Define Patient model
const Patient = sequelize.define('Patient', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  patient_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  first_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  last_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  date_of_birth: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  gender: {
    type: DataTypes.ENUM('male', 'female', 'other'),
    allowNull: false,
  },
  phone_number: {
    type: DataTypes.STRING,
  },
  address: {
    type: DataTypes.TEXT,
  },
  next_of_kin_name: {
    type: DataTypes.STRING,
  },
  next_of_kin_phone: {
    type: DataTypes.STRING,
  },
  insurance_type: {
    type: DataTypes.STRING,
  },
  insurance_number: {
    type: DataTypes.STRING,
  },
  registration_date: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  clinic_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  registered_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  default_scheme_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'patients',
  timestamps: true,
  underscored: true,
  hooks: {
    // beforeValidate, not beforeCreate — Sequelize runs field validation
    // (including patient_id's allowNull: false) before beforeCreate fires, so
    // generating it there was always too late and every create failed with
    // "notNull Violation: Patient.patient_id cannot be null".
    beforeValidate: async (patient) => {
      if (!patient.patient_id) {
        // Generate patient_id: UH-XXXXXX (6 random digits)
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        patient.patient_id = `UH-${randomNum}`;

        // Check if it already exists, regenerate if needed
        const existing = await Patient.findOne({ where: { patient_id: patient.patient_id } });
        if (existing) {
          const newNum = Math.floor(100000 + Math.random() * 900000);
          patient.patient_id = `UH-${newNum}`;
        }
      }
    }
  }
});

// Define LabTest model
const LabTest = sequelize.define('LabTest', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  test_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  test_code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  service_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  clinic_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  category_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'lab_tests',
  timestamps: true,
  underscored: true,
});

// Define LabTestComponent model
const LabTestComponent = sequelize.define('LabTestComponent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  lab_test_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  component_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  unit: {
    type: DataTypes.STRING,
  },
  reference_range: {
    type: DataTypes.STRING,
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  tableName: 'lab_test_components',
  timestamps: true,
  underscored: true,
});

// Import Visit model
const VisitModel = require('./Visit');
const Visit = VisitModel(sequelize);

// Import Receipt model
const ReceiptModel = require('./Receipt');
const Receipt = ReceiptModel(sequelize);

// Define PatientQueue model
const PatientQueue = sequelize.define('PatientQueue', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  patient_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  visit_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  queue_type: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'waiting',
  },
  priority: {
    type: DataTypes.STRING,
    defaultValue: 'normal',
  },
  assigned_to: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
  },
  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'patient_queue',
  timestamps: true,
  underscored: true,
});

// Import model definitions that exist
const DrClinicModel = require('./drClinics');
const ServiceModel = require('./Service');
const DrugInventoryModel = require('./DrugInventory');
const PharmacyDispensingModel = require('./PharmacyDispensing');
const PrescriptionModel = require('./Prescription');
const LedgerAccountModel = require('./LedgerAccount');
const CashierShiftModel = require('./CashierShift');
const CashTransferModel = require('./CashTransfer');
const PurchaseOrderModel = require('./PurchaseOrder');
const PurchaseOrderItemModel = require('./PurchaseOrderItem');
const DailyExpenseModel = require('./DailyExpense');
const Facility = require('./Facility')(sequelize);

// Initialize DrClinic model
const DrClinic = DrClinicModel(sequelize);

// Initialize Service model
const Service = ServiceModel(sequelize);

// Initialize Pharmacy models
const DrugInventory = DrugInventoryModel(sequelize);
const PharmacyDispensing = PharmacyDispensingModel(sequelize);
const Prescription = PrescriptionModel(sequelize);

// Initialize Accounting models
const LedgerAccount = LedgerAccountModel(sequelize);
const CashierShift = CashierShiftModel(sequelize);
const CashTransfer = CashTransferModel(sequelize);

// Initialize Procurement models
const PurchaseOrder = PurchaseOrderModel(sequelize);
const PurchaseOrderItem = PurchaseOrderItemModel(sequelize);
const DailyExpense = DailyExpenseModel(sequelize);

// Initialize Accounting models
const ChartOfAccountsModel = require('./ChartOfAccounts');
const GeneralLedgerModel = require('./GeneralLedger');
const GLLineItemsModel = require('./GLLineItems');
const AccountLedgerModel = require('./AccountLedger');
const JournalEntriesModel = require('./JournalEntries');
const JournalEntryLinesModel = require('./JournalEntryLines');
const PatientReceivablesModel = require('./PatientReceivables');
const SuppliersModel = require('./Suppliers');
const ExpenseInvoicesModel = require('./ExpenseInvoices');
const ExpenseInvoiceLinesModel = require('./ExpenseInvoiceLines');
const CostCentersModel = require('./CostCenters');
const ExchangeRateModel = require('./ExchangeRate');

const ChartOfAccounts = ChartOfAccountsModel(sequelize);
const GeneralLedger = GeneralLedgerModel(sequelize);
const GLLineItems = GLLineItemsModel(sequelize);
const AccountLedger = AccountLedgerModel(sequelize);
const JournalEntries = JournalEntriesModel(sequelize);
const JournalEntryLines = JournalEntryLinesModel(sequelize);
const PatientReceivables = PatientReceivablesModel(sequelize);
const SuppliersAccounting = SuppliersModel(sequelize);
const ExpenseInvoices = ExpenseInvoicesModel(sequelize);
const ExpenseInvoiceLines = ExpenseInvoiceLinesModel(sequelize);
const CostCenters = CostCentersModel(sequelize);
const ExchangeRate = ExchangeRateModel(sequelize);

// Define associations
LabTest.hasMany(LabTestComponent, { foreignKey: 'lab_test_id', as: 'components' });
LabTestComponent.belongsTo(LabTest, { foreignKey: 'lab_test_id', as: 'labTest' });

// Patient Queue associations
PatientQueue.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });

// Purchase Order associations
PurchaseOrder.hasMany(PurchaseOrderItem, { foreignKey: 'purchase_order_id', as: 'items' });
PurchaseOrderItem.belongsTo(PurchaseOrder, { foreignKey: 'purchase_order_id', as: 'purchaseOrder' });

// Accounting associations
GeneralLedger.hasMany(GLLineItems, { foreignKey: 'gl_id', as: 'lineItems' });
GLLineItems.belongsTo(GeneralLedger, { foreignKey: 'gl_id', as: 'generalLedger' });
GLLineItems.belongsTo(ChartOfAccounts, { foreignKey: 'account_id', as: 'account' });

JournalEntries.hasMany(JournalEntryLines, { foreignKey: 'je_id', as: 'lines' });
JournalEntryLines.belongsTo(JournalEntries, { foreignKey: 'je_id', as: 'journalEntry' });
JournalEntryLines.belongsTo(ChartOfAccounts, { foreignKey: 'account_id', as: 'account' });

AccountLedger.belongsTo(ChartOfAccounts, { foreignKey: 'account_id', as: 'account' });
AccountLedger.belongsTo(GeneralLedger, { foreignKey: 'transaction_id', as: 'transaction' });

PatientReceivables.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
PatientReceivables.belongsTo(GeneralLedger, { foreignKey: 'gl_entry_id', as: 'glEntry' });

SuppliersAccounting.belongsTo(ChartOfAccounts, { foreignKey: 'account_id', as: 'account' });
ExpenseInvoices.belongsTo(SuppliersAccounting, { foreignKey: 'supplier_id', as: 'supplier' });
ExpenseInvoices.hasMany(ExpenseInvoiceLines, { foreignKey: 'expense_invoice_id', as: 'lines' });
ExpenseInvoiceLines.belongsTo(ExpenseInvoices, { foreignKey: 'expense_invoice_id', as: 'invoice' });
ExpenseInvoiceLines.belongsTo(ChartOfAccounts, { foreignKey: 'account_id', as: 'account' });


const PatientBill = sequelize.define('PatientBill', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  bill_number: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  patient_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  patient_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  clinic_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  total_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  paid_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  balance_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  status: {
    type: DataTypes.ENUM('pending', 'partial', 'paid', 'overdue', 'active'),
    defaultValue: 'pending',
  },
  bill_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  due_date: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  services: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  created_by: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  updated_by: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  scheme_id: {
    type: DataTypes.STRING(36),
    allowNull: true,
  },
  scheme_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  scheme_pricing_applied: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  invoice_id: {
    type: DataTypes.STRING(36),
    allowNull: true,
  },
  bill_currency: {
    type: DataTypes.STRING(10),
    defaultValue: 'SSP',
  },
  billing_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'cash',
  },
  visit_id: {
    type: DataTypes.STRING(36),
    allowNull: true,
  },
}, {
  tableName: 'patient_bills',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

  return {
    sequelize,
    User, Patient, LabTest, LabTestComponent, Visit, Receipt, PatientQueue, PatientBill,
    DrClinic, Service, DrugInventory, PharmacyDispensing, Prescription, LedgerAccount,
    CashierShift, CashTransfer, PurchaseOrder, PurchaseOrderItem, DailyExpense, Facility,
    ChartOfAccounts, GeneralLedger, GLLineItems, AccountLedger, JournalEntries,
    JournalEntryLines, PatientReceivables, SuppliersAccounting, ExpenseInvoices,
    ExpenseInvoiceLines, CostCenters, ExchangeRate,
  };
}

// Schema bootstrap (create/patch tables) — pure raw SQL keyed off whichever connection
// is passed in, so it can build either the app's single default database (unchanged
// call site below) or a brand-new tenant database during provisioning.
async function runSchemaBootstrap(sequelize) {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    
    // Sync models with database - disable alter to avoid foreign key issues
    try {
      await sequelize.sync({ force: false, alter: false });
      console.log('✅ Models synchronized with database');
    } catch (syncError) {
      console.log('⚠️  Model sync skipped:', syncError.message);
      // Continue without sync - tables will be created manually below
    }

    // Ensure procurement supplier columns exist (safe to re-run via IF NOT EXISTS)
    // Must run here — after sync() creates the suppliers table — not at require() time
    try {
      const supplierCols = [
        ["supplier_code",       "VARCHAR(50) NULL"],
        ["supplier_type",       "VARCHAR(50) DEFAULT 'general'"],
        ["country",             "VARCHAR(100) DEFAULT 'South Sudan'"],
        ["payment_terms",       "VARCHAR(50) DEFAULT 'Net30'"],
        ["credit_limit",        "DECIMAL(15,2) DEFAULT 0"],
        ["currency",            "VARCHAR(3) DEFAULT 'SSP'"],
        ["is_preferred",        "BOOLEAN DEFAULT false"],
        ["on_hold",             "BOOLEAN DEFAULT false"],
        ["hold_reason",         "TEXT NULL"],
        ["tax_id",              "VARCHAR(50) NULL"],
        ["bank_account_name",   "VARCHAR(255) NULL"],
        ["bank_account_number", "VARCHAR(50) NULL"],
        ["bank_name",           "VARCHAR(255) NULL"],
        ["clinic_id",           "INTEGER NULL"],
        ["performance_rating",  "DECIMAL(3,1) DEFAULT 0"],
        ["total_purchases",     "DECIMAL(15,2) DEFAULT 0"],
        ["total_paid",          "DECIMAL(15,2) DEFAULT 0"],
      ];
      for (const [col, def] of supplierCols) {
        await sequelize.query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ${col} ${def}`).catch(() => {});
      }
      console.log('✅ Supplier procurement columns ensured');
    } catch (e) {
      console.log('Note: Supplier column migration skipped:', e.message);
    }

    // Add multi-currency columns to accounting tables (safe to re-run)
    try {
      const { addMultiCurrencyColumns } = require('../scripts/migrateAccountingTables');
      await addMultiCurrencyColumns();
    } catch (mcError) {
      console.log('Note: Multi-currency migration skipped or already applied:', mcError.message);
    }
    
    // Manually add password_hash column if it doesn't exist
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT ''`);
      console.log('Added password_hash column to users table');
    } catch (error) {
      console.log('Note: Could not add password_hash column (may already exist)');
    }

    // Manually add signature column if it doesn't exist
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature TEXT NULL`);
      console.log('Added signature column to users table');
    } catch (error) {
      console.log('Note: Could not add signature column (may already exist)');
    }

    // Add current_room_id column to users (doctor's currently assigned consultation room)
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN current_room_id VARCHAR(36) NULL`);
      console.log('Added current_room_id column to users table');
    } catch (error) {
      if (!isDuplicateColumn(error)) {
        console.log('Note: Could not add current_room_id column:', error.message);
      }
    }

    // users.role is a real MySQL ENUM column on this deployment (not just a Sequelize-side
    // guard) — adding a role to the JS ENUM above doesn't widen the actual DB column, so
    // INSERT/UPDATE with a new role value fails with "Data truncated for column 'role'"
    // until the column itself is redefined. Read the live list and only append what's
    // missing, so this never drops a role some other user already has.
    // Note: 'cashier' is also missing from this DB enum (pre-existing gap, same symptom,
    // predates this change) — left alone here since it's outside this change's scope.
    try {
      // MySQL-only, and unnecessary here: SHOW COLUMNS does not exist in
      // PostgreSQL, and users.role is plain text rather than an enum, so every
      // role value — including 'cashier', which the note above worried about —
      // is already accepted without widening anything.
      if (sequelize.getDialect() !== 'mysql') throw { skipLegacy: true };
      const [[roleColumn]] = await sequelize.query(`SHOW COLUMNS FROM users LIKE 'role'`);
      const match = roleColumn?.Type?.match(/^enum\((.*)\)$/i);
      if (match) {
        const current = match[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
        const missing = ['procurement', 'nurse'].filter(r => !current.includes(r));
        if (missing.length > 0) {
          const fullList = [...current, ...missing];
          const enumSql = fullList.map(v => `'${v}'`).join(', ');
          await sequelize.query(`ALTER TABLE users MODIFY COLUMN role ENUM(${enumSql}) NOT NULL`);
          console.log('Widened users.role ENUM to include:', missing.join(', '));
        }
      }
    } catch (error) {
      if (!error?.skipLegacy) reportSchemaGuardFailure('users.role enum', error);
    }

    // Ensure visits table has all required columns
    try {
      const visitCols = [
        'clinical_notes TEXT NULL',
        'vitals TEXT NULL',
        'lab_requests TEXT NULL',
        'diagnosis VARCHAR(500) NULL',
        'diagnosis_code VARCHAR(50) NULL',
        'patient_name VARCHAR(255) NULL',
        'doctor_name VARCHAR(255) NULL',
        'queue_id VARCHAR(36) NULL',
        'closed_at TIMESTAMP NULL',
        'closed_by VARCHAR(255) NULL',
      ];
      for (const colDef of visitCols) {
        const colName = colDef.split(' ')[0];
        try { await sequelize.query(`ALTER TABLE visits ADD COLUMN IF NOT EXISTS ${colDef}`); } catch(e){}
      }
    } catch (error) {
      console.log('Note: visits column migration skipped or error:', error.message);
    }

    // Ensure lab_tests table has the correct structure
    try {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS lab_tests (
        id VARCHAR(36) PRIMARY KEY,
        test_name VARCHAR(255) NOT NULL,
        test_code VARCHAR(50) NOT NULL UNIQUE,
        category VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NULL,
        service_id INT NULL,
        clinic_id INT NOT NULL,
        created_by VARCHAR(255) NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
      const ltCols = ['price DECIMAL(10,2) NULL','service_id INT NULL','created_by VARCHAR(255) NULL','is_active BOOLEAN DEFAULT TRUE'];
      for (const c of ltCols) { try { await sequelize.query(`ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS ${c}`); } catch(e){} }
      console.log('lab_tests table ensured');
    } catch (error) {
      console.log('Note: Could not ensure lab_tests table structure:', error.message);
    }

    // Ensure lab_test_components table exists with the correct structure (never drop it)
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS lab_test_components (
          id VARCHAR(36) PRIMARY KEY,
          lab_test_id VARCHAR(36) NOT NULL,
          component_name VARCHAR(255) NOT NULL,
          unit VARCHAR(50),
          reference_range VARCHAR(255),
          display_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ltc_lab_test_id ON lab_test_components(lab_test_id)`); } catch(e){}
      console.log('lab_test_components table ensured (CREATE IF NOT EXISTS)');
    } catch (error) {
      console.log('Note: Could not ensure lab_test_components table:', error.message);
    }
    // Rename sort_order → display_order if old column still exists (schema migration)
    try {
      const [cols] = await sequelize.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='lab_test_components' AND column_name='sort_order'`
      );
      if (cols.length > 0) {
        await sequelize.query(`ALTER TABLE lab_test_components RENAME COLUMN sort_order TO display_order`);
        console.log('✅ Migrated lab_test_components.sort_order → display_order');
      }
    } catch(e) {
      console.log('Note: sort_order migration skipped:', e.message);
    }

    // Ensure lab_machine_raw_results table exists (Holding Tank for BC-10)
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS lab_machine_raw_results (
          id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          sample_id VARCHAR(100) NOT NULL,
          machine_name VARCHAR(100) NOT NULL DEFAULT 'Unknown Lab Machine',
          raw_data JSON NOT NULL,
          parsed_data JSON NOT NULL,
          is_processed BOOLEAN DEFAULT FALSE,
          processed_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          -- Plain DEFAULT, and indexes declared separately: "ON UPDATE
          -- CURRENT_TIMESTAMP" and inline INDEX clauses are MySQL-only and make
          -- the whole statement a syntax error on PostgreSQL. It is wrapped in a
          -- try/catch, so it failed silently on every boot and only ever logged
          -- a note — the table exists because the tenant template carries it.
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_sample_id ON lab_machine_raw_results (sample_id)');
      await sequelize.query('CREATE INDEX IF NOT EXISTS idx_is_processed ON lab_machine_raw_results (is_processed)');
      console.log('✅ lab_machine_raw_results table ensured (Holding Tank)');
    } catch (error) {
      console.log('Note: Could not ensure lab_machine_raw_results table:', error.message);
    }

    // Ensure patient_bills table exists and remove foreign key constraints
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS patient_bills (
          id VARCHAR(36) PRIMARY KEY,
          bill_number VARCHAR(255) NOT NULL UNIQUE,
          patient_id VARCHAR(255) NOT NULL,
          patient_name VARCHAR(255) NOT NULL,
          clinic_id INT NOT NULL,
          total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          paid_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          balance_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          status VARCHAR(20) DEFAULT 'pending',
          bill_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          due_date TIMESTAMP NULL,
          services JSON NULL,
          notes TEXT NULL,
          created_by VARCHAR(255) NOT NULL,
          updated_by VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('patient_bills table ensured');
    } catch (error) {
      console.log('Note: Could not ensure patient_bills table:', error.message);
    }

    // Ensure services table exists with correct structure
    try {
      console.log('Checking services table structure...');
      
      // Create services table if it doesn't exist (preserves existing data)
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS services (
          id VARCHAR(36) PRIMARY KEY,
          service_name VARCHAR(255) NOT NULL UNIQUE,
          category VARCHAR(100) NOT NULL,
          price DECIMAL(10, 2) DEFAULT 0.00,
          description TEXT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_by VARCHAR(255) NULL,
          updated_by VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_svc_category ON services(category)`); } catch(e){}
      console.log('Services table verified/created');
      
    } catch (error) {
      console.log('Note: Could not ensure services table:', error.message);
    }

    // Ensure dr_clinics table exists
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS dr_clinics (
          id VARCHAR(36) PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          description TEXT NULL,
          department VARCHAR(100) NOT NULL,
          services JSON NULL,
          service VARCHAR(255) NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_by VARCHAR(255) NULL,
          updated_by VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`ALTER TABLE dr_clinics ADD COLUMN IF NOT EXISTS service VARCHAR(255) NULL`); } catch(e){}
      console.log('dr_clinics table ensured');
    } catch (error) {
      console.log('Note: Could not ensure dr_clinics table:', error.message);
    }

    // Ensure procurement tables exist
    try {
      console.log('Checking procurement tables...');
      
      // Create suppliers table first
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          contact_person VARCHAR(255) NULL,
          phone VARCHAR(50) NULL,
          email VARCHAR(255) NULL,
          address TEXT NULL,
          town VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created/verified suppliers table');
      
      // Add town column if it doesn't exist
      try {
        await sequelize.query(`
          ALTER TABLE suppliers 
          ADD COLUMN town VARCHAR(255) NULL
        `);
        console.log('Added town column to suppliers table');
      } catch (error) {
        console.log('Note: Could not add town column (may already exist)');
      }
      
      // Insert sample suppliers if table is empty
      const [supplierCount] = await sequelize.query('SELECT COUNT(*) as count FROM suppliers');
      if (supplierCount[0].count === 0) {
        await sequelize.query(`
          INSERT INTO suppliers (name, contact_person, phone, email, address, town) VALUES
          ('Medical Supplies Co.', 'John Smith', '+211-123-456789', 'john@medsupplies.com', 'Juba, South Sudan', 'Juba'),
          ('Pharma Distributors Ltd', 'Sarah Johnson', '+211-987-654321', 'sarah@pharmadist.com', 'Wau, South Sudan', 'Wau'),
          ('Healthcare Equipment Inc', 'Mike Wilson', '+211-555-123456', 'mike@healthequip.com', 'Malakal, South Sudan', 'Malakal')
        `);
        console.log('Added sample suppliers');
      }

      // Create purchase_orders table with correct structure (preserve existing data)
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id SERIAL PRIMARY KEY,
          po_number VARCHAR(50) NOT NULL UNIQUE,
          supplier_id INT NOT NULL,
          order_date DATE NOT NULL,
          total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          status VARCHAR(20) DEFAULT 'draft',
          notes TEXT NULL,
          check_signature TEXT NULL,
          check_signed_by VARCHAR(255) NULL,
          check_signed_at TIMESTAMP NULL,
          approved_signature TEXT NULL,
          approved_signed_by VARCHAR(255) NULL,
          approved_signed_at TIMESTAMP NULL,
          authorized_signature TEXT NULL,
          authorized_signed_by VARCHAR(255) NULL,
          authorized_signed_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created/verified purchase_orders table with correct structure');
      
      // Create purchase_order_items table (preserve existing data)
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS purchase_order_items (
          id SERIAL PRIMARY KEY,
          purchase_order_id INT NOT NULL,
          item_name VARCHAR(255) NOT NULL,
          description TEXT NULL,
          quantity INT NOT NULL DEFAULT 1,
          unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          total_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          unit_of_measure VARCHAR(50) NULL DEFAULT 'Each',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_poi_po_id ON purchase_order_items(purchase_order_id)`); } catch(e){}
      console.log('Created/verified purchase_order_items table with correct structure');
      
    } catch (error) {
      console.log('Note: Could not ensure procurement tables:', error.message);
    }

    // Ensure pharmacy tables exist
    try {
      console.log('Checking pharmacy tables...');
      
      // Create drug_inventory table
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS drug_inventory (
          id VARCHAR(36) PRIMARY KEY,
          drug_name VARCHAR(255) NOT NULL,
          generic_name VARCHAR(255) NULL,
          unit_of_measure VARCHAR(100) NOT NULL DEFAULT 'Tablets',
          quantity_received INT NOT NULL DEFAULT 0,
          current_stock INT NOT NULL DEFAULT 0,
          expiry_date DATE NOT NULL,
          batch_number VARCHAR(50) NULL,
          reorder_level INT NOT NULL DEFAULT 10,
          clinic_id INT NOT NULL,
          date_received DATE NOT NULL,
          received_by VARCHAR(36) NOT NULL,
          unit_cost DECIMAL(10, 2) NULL DEFAULT 0.00,
          selling_price DECIMAL(10, 2) NULL DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created/verified drug_inventory table');
      
      // Create pharmacy_dispensing table
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS pharmacy_dispensing (
          id VARCHAR(36) PRIMARY KEY,
          drug_id VARCHAR(36) NOT NULL,
          drug_name VARCHAR(255) NOT NULL,
          patient_id VARCHAR(255),
          patient_name VARCHAR(255) NOT NULL,
          visit_id VARCHAR(36),
          quantity INT NOT NULL,
          unit_of_measure VARCHAR(50),
          prescribed_by VARCHAR(255),
          dispensed_by VARCHAR(255) NOT NULL,
          clinic_id INT NOT NULL,
          dispensed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created/verified pharmacy_dispensing table');
      
      // Create prescriptions table
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS prescriptions (
          id VARCHAR(36) PRIMARY KEY,
          patient_id VARCHAR(255) NOT NULL,
          patient_name VARCHAR(255) NOT NULL,
          visit_id VARCHAR(36),
          prescribed_by VARCHAR(255) NOT NULL,
          clinic_id INT NOT NULL,
          medications JSON,
          medication_name VARCHAR(255),
          take_instructions VARCHAR(100),
          frequency VARCHAR(100),
          duration VARCHAR(100),
          quantity VARCHAR(50),
          instructions TEXT,
          status VARCHAR(20) DEFAULT 'active',
          prescribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created/verified prescriptions table');
      
    } catch (error) {
      console.log('Note: Could not ensure pharmacy tables:', error.message);
    }

    // Ensure visits table exists
    try {
      console.log('Checking visits table...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS visits (
          id VARCHAR(36) PRIMARY KEY,
          patient_id VARCHAR(255) NOT NULL,
          patient_name VARCHAR(255) NOT NULL,
          doctor_id VARCHAR(36) NOT NULL,
          doctor_name VARCHAR(255) NOT NULL,
          clinic_id INT NOT NULL,
          visit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          chief_complaint TEXT,
          clinical_notes TEXT,
          vitals JSON,
          lab_requests JSON,
          diagnosis TEXT,
          diagnosis_code VARCHAR(50),
          prescription JSON,
          status VARCHAR(20) DEFAULT 'active',
          queue_id VARCHAR(36),
          closed_at TIMESTAMP NULL,
          closed_by VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created/verified visits table');
      
    } catch (error) {
      console.log('Note: Could not ensure visits table:', error.message);
    }

    // Ensure receipts table exists
    try {
      console.log('Checking receipts table...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS receipts (
          id VARCHAR(36) PRIMARY KEY,
          receipt_number VARCHAR(50) NOT NULL UNIQUE,
          bill_id VARCHAR(36) NULL,
          patient_id VARCHAR(255) NULL,
          patient_name VARCHAR(255) NULL,
          clinic_id INT NOT NULL,
          payment_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
          payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          paid_services JSON,
          service_details JSON,
          notes TEXT,
          from_lease BOOLEAN NOT NULL DEFAULT FALSE,
          lease_details TEXT,
          cashier_name VARCHAR(255),
          cashier_id VARCHAR(36),
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          branch_id INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`ALTER TABLE receipts ALTER COLUMN bill_id DROP NOT NULL`); } catch(e){}
      try { await sequelize.query(`ALTER TABLE receipts ALTER COLUMN patient_id DROP NOT NULL`); } catch(e){}
      try { await sequelize.query(`ALTER TABLE receipts ALTER COLUMN patient_name DROP NOT NULL`); } catch(e){}
      console.log('Created/verified receipts table');
      
    } catch (error) {
      console.log('Note: Could not ensure receipts table:', error.message);
    }

    // Create lab_requests table
    try {
      console.log('Creating lab_requests table...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS lab_requests (
          id VARCHAR(36) PRIMARY KEY,
          patient_id VARCHAR(255) NOT NULL,
          patient_name VARCHAR(255),
          clinic_id INT NOT NULL,
          test_id VARCHAR(36),
          test_name VARCHAR(255) NOT NULL,
          test_code VARCHAR(50),
          requested_by VARCHAR(255) NOT NULL,
          requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          priority VARCHAR(20) DEFAULT 'normal',
          status VARCHAR(20) DEFAULT 'pending',
          notes TEXT,
          visit_id VARCHAR(36),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_lr_patient ON lab_requests(patient_id)`); } catch(e){}
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_lr_status ON lab_requests(status)`); } catch(e){}
      console.log('Created/verified lab_requests table');
      
    } catch (error) {
      console.log('Note: Could not ensure lab_requests table:', error.message);
    }

    // Create lab_results table
    try {
      console.log('Creating lab_results table...');
      
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS lab_results (
          id VARCHAR(36) PRIMARY KEY,
          request_id VARCHAR(36) NOT NULL,
          patient_id VARCHAR(255) NOT NULL,
          patient_name VARCHAR(255) NOT NULL,
          clinic_id INT NOT NULL,
          test_id VARCHAR(36) NOT NULL,
          test_name VARCHAR(255) NOT NULL,
          test_code VARCHAR(50) NOT NULL,
          results JSON NOT NULL,
          reference_ranges JSON,
          abnormal_flags JSON,
          status VARCHAR(20) DEFAULT 'preliminary',
          performed_by VARCHAR(255) NOT NULL,
          performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          verified_by VARCHAR(255),
          verified_at TIMESTAMP NULL,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_lres_request ON lab_results(request_id)`); } catch(e){}
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_lres_patient ON lab_results(patient_id)`); } catch(e){}
      console.log('Created/verified lab_results table');
      
    } catch (error) {
      console.log('Note: Could not ensure lab_results table:', error.message);
    }

    // Ensure facilities table exists
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS facilities (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(100) NOT NULL DEFAULT 'Hospital',
          address TEXT NOT NULL,
          city VARCHAR(100),
          state VARCHAR(100),
          postal_code VARCHAR(20),
          country VARCHAR(100) NOT NULL DEFAULT 'South Sudan',
          phone VARCHAR(50) NOT NULL,
          fax VARCHAR(50),
          email VARCHAR(255) NOT NULL,
          website VARCHAR(255),
          license_number VARCHAR(100),
          established_date DATE,
          bed_capacity INT,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('facilities table ensured');
    } catch (error) {
      console.log('Note: Could not ensure facilities table:', error.message);
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS branches (
          id SERIAL PRIMARY KEY,
          facility_id INT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT NULL,
          is_main_branch BOOLEAN DEFAULT FALSE,
          phone VARCHAR(50) NULL,
          email VARCHAR(255) NULL,
          address TEXT NULL,
          city VARCHAR(100) NULL,
          region VARCHAR(100) NULL,
          country VARCHAR(100) DEFAULT 'South Sudan',
          manager_name VARCHAR(255) NULL,
          manager_phone VARCHAR(50) NULL,
          opening_time VARCHAR(10) DEFAULT '08:00',
          closing_time VARCHAR(10) DEFAULT '17:00',
          bed_capacity INT DEFAULT 0,
          staff_count INT DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('branches table ensured');
    } catch (error) {
      console.log('Note: Could not ensure branches table:', error.message);
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS user_branches (
          id SERIAL PRIMARY KEY,
          user_id CHAR(36) NOT NULL,
          branch_id INT NOT NULL,
          is_primary BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uniq_user_branch UNIQUE (user_id, branch_id)
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ub_user_id ON user_branches(user_id)`); } catch(e){}
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ub_branch_id ON user_branches(branch_id)`); } catch(e){}
      console.log('user_branches table ensured');
    } catch (error) {
      console.log('Note: Could not ensure user_branches table:', error.message);
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS branch_access_audit_logs (
          id CHAR(36) PRIMARY KEY,
          user_id CHAR(36) NULL,
          branch_id INT NULL,
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(100) NULL,
          resource_id VARCHAR(100) NULL,
          is_unauthorized BOOLEAN DEFAULT FALSE,
          ip_address VARCHAR(45) NULL,
          user_agent TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_baal_user_id ON branch_access_audit_logs(user_id)`); } catch(e){}
      try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_baal_branch_id ON branch_access_audit_logs(branch_id)`); } catch(e){}
      console.log('branch_access_audit_logs table ensured');
    } catch (error) {
      console.log('Note: Could not ensure branch_access_audit_logs table:', error.message);
    }

    // Ensure branch_id column exists on all key tables for branch-level data isolation
    const branchIdTables = ['users', 'patients', 'visits', 'patient_queue', 'patient_bills', 'receipts', 'lab_requests'];
    for (const table of branchIdTables) {
      try {
        await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS branch_id INT NULL`);
      } catch (error) {
        console.log(`Note: Could not ensure branch_id on ${table}:`, error.message);
      }
    }

    // Ensure invoice_id and billing_type columns exist on patient_bills
    try {
      await sequelize.query(`ALTER TABLE patient_bills ADD COLUMN IF NOT EXISTS invoice_id CHAR(36) NULL`);
      await sequelize.query(`ALTER TABLE patient_bills ADD COLUMN IF NOT EXISTS billing_type VARCHAR(20) DEFAULT 'cash'`);
    } catch (error) {
      console.log('Note: Could not ensure invoice columns on patient_bills:', error.message);
    }

    // Backfill: mark services as invoiced on existing credit bills
    try {
      const [creditBills] = await sequelize.query("SELECT id, services FROM patient_bills WHERE billing_type = 'credit' AND services IS NOT NULL");
      for (const bill of creditBills) {
        let svcList = typeof bill.services === 'string' ? JSON.parse(bill.services) : bill.services;
        if (Array.isArray(svcList) && svcList.length > 0 && !svcList[0].invoiced) {
          svcList = svcList.map(s => ({ ...s, invoiced: true }));
          await sequelize.query("UPDATE patient_bills SET services = ? WHERE id = ?", { replacements: [JSON.stringify(svcList), bill.id] });
        }
      }
      if (creditBills.length > 0) console.log(`Backfilled invoiced flag on ${creditBills.length} credit bill(s).`);
    } catch (error) {
      console.log('Note: Could not backfill invoiced services:', error.message);
    }

    console.log('Database models synchronized.');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize database');
    console.error('Database connection error:', error.message);
    console.log('⚠️  Server will continue without database connection');
    console.log('💡 Please check your database configuration and restart');
    return false;
  }
}

const defaultSequelize = require('../config/database');
const defaultModels = createModels(defaultSequelize);

// Every model export (and `sequelize` itself) is wrapped so the ~50 existing
// route files' `const { Patient, sequelize } = require('../models')` keeps
// working completely unchanged, but transparently operates against whichever
// tenant is active for the current request (see tenantContext.js +
// middleware/auth.js) instead of always hitting one static database.
//
// Outside a request — migrations at boot, the standalone provisioning
// script — tenantContext.getCurrent() is undefined and this falls back to
// the app's original single default connection, so none of that existing
// code needed to change either.
const tenantContext = require('../tenantContext');

function resolveReal(key) {
  const current = tenantContext.getCurrent();
  if (!current) return defaultModels[key];
  return key === 'sequelize' ? current.sequelize : current.models[key];
}

function wrapTenantAware(key) {
  return new Proxy({}, {
    get(_target, prop, _receiver) {
      const real = resolveReal(key);
      const value = real[prop];
      if (typeof value !== 'function') return value;
      // sequelize.Sequelize (used for sequelize.Sequelize.Op, .DataTypes, etc. —
      // see routes/dashboard.js) is a class reference, not an instance method: a
      // plain .bind(real) on it silently drops every static property (Op,
      // DataTypes, QueryTypes, ...) because Function.prototype.bind returns a new
      // bound function object that doesn't carry the original's own properties.
      // That turned sequelize.Sequelize.Op.in into "Cannot read properties of
      // undefined" at request time. Copying the original's own properties onto
      // the bound function keeps every such static/namespace access working,
      // while still binding correctly for genuine instance methods.
      return Object.assign(value.bind(real), value);
    },
    set(_target, prop, value) {
      resolveReal(key)[prop] = value;
      return true;
    },
    has(_target, prop) {
      return prop in resolveReal(key);
    },
  });
}

const tenantAwareExports = {};
for (const key of Object.keys(defaultModels)) {
  tenantAwareExports[key] = wrapTenantAware(key);
}

module.exports = {
  ...tenantAwareExports,
  createModels,
  initializeDatabase: (sequelize = defaultSequelize) => runSchemaBootstrap(sequelize),
};

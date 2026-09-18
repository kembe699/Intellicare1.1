const platformSequelize = require('../../config/platformDatabase');

const PlatformAdmin = require('./PlatformAdmin')(platformSequelize);
const Client = require('./Client')(platformSequelize);
const SubscriptionPlan = require('./SubscriptionPlan')(platformSequelize);
const Invoice = require('./Invoice')(platformSequelize);
const DbUsageSnapshot = require('./DbUsageSnapshot')(platformSequelize);
const Customer = require('./Customer')(platformSequelize);
const Quotation = require('./Quotation')(platformSequelize);
const CompanyProfile = require('./CompanyProfile')(platformSequelize);
const QuotationInvoice = require('./QuotationInvoice')(platformSequelize);

Client.hasMany(Invoice, { foreignKey: 'client_id', as: 'invoices' });
Invoice.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
SubscriptionPlan.hasMany(Invoice, { foreignKey: 'plan_id', as: 'invoices' });
Invoice.belongsTo(SubscriptionPlan, { foreignKey: 'plan_id', as: 'plan' });
Client.hasMany(DbUsageSnapshot, { foreignKey: 'client_id', as: 'dbUsageSnapshots' });
DbUsageSnapshot.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Customer.hasMany(Quotation, { foreignKey: 'customer_id', as: 'quotations' });
Quotation.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
Quotation.hasOne(QuotationInvoice, { foreignKey: 'quotation_id', as: 'invoice' });
QuotationInvoice.belongsTo(Quotation, { foreignKey: 'quotation_id', as: 'quotation' });
Customer.hasMany(QuotationInvoice, { foreignKey: 'customer_id', as: 'quotationInvoices' });
QuotationInvoice.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

async function initializePlatformDatabase() {
  await platformSequelize.authenticate();
  await platformSequelize.sync({ force: false, alter: false });

  // sync({alter: false}) only creates missing tables, never adds columns to
  // ones that already exist — so an already-deployed clients table needs
  // these added by hand the first time this runs after they were introduced.
  // Checked via information_schema first rather than a blind
  // "ADD COLUMN IF NOT EXISTS" — that clause is MariaDB-only and throws a
  // plain syntax error (not caught by an ER_DUP_FIELDNAME check) on stock
  // MySQL, which would silently skip adding the column on every engine that
  // doesn't support it, including local dev.
  for (const [table, col, def] of [
    ['clients', 'db_user', 'VARCHAR(64) NULL'],
    ['clients', 'db_password', 'VARCHAR(255) NULL'],
    // Added after platform_company_profile first shipped — an
    // already-deployed row won't get this column from sync({alter:false}).
    ['platform_company_profile', 'stamp', 'TEXT NULL'],
  ]) {
    try {
      const [existing] = await platformSequelize.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
        { replacements: [table, col] }
      );
      if (existing.length === 0) {
        await platformSequelize.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      }
    } catch (err) {
      console.log(`Note: could not add ${table}.${col}:`, err.message);
    }
  }

  // Seed the platform owner's own login if none exists yet — same bootstrap
  // pattern and credentials already used to seed this app's first tenant
  // admin (see runBackgroundMigrations in index.js), so there's one
  // consistent "day one" account to change the password on rather than a
  // separate convention just for this new panel.
  const existing = await PlatformAdmin.findOne({ where: { email: 'kembe699@gmail.com' } });
  if (!existing) {
    const bcrypt = require('bcrypt');
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!seedPassword) throw new Error('Set SEED_ADMIN_PASSWORD to seed an admin account');
    const hash = await bcrypt.hash(seedPassword, 12);
    await PlatformAdmin.create({ name: 'Platform Admin', email: 'kembe699@gmail.com', password_hash: hash });
    console.log('  ✅ Default platform admin seeded');
  }
}

module.exports = {
  sequelize: platformSequelize,
  PlatformAdmin,
  Client,
  SubscriptionPlan,
  Invoice,
  DbUsageSnapshot,
  Customer,
  Quotation,
  CompanyProfile,
  QuotationInvoice,
  initializePlatformDatabase,
};

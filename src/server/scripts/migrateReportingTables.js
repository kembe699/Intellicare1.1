const { sequelize } = require('../models');

async function migrateReportingTables() {
  console.log('\n=== Reporting Module Migration ===\n');

  const tables = [
    {
      name: 'audit_logs',
      sql: `CREATE TABLE IF NOT EXISTS audit_logs (
        id CHAR(36) PRIMARY KEY,
        clinic_id INT,
        user_id CHAR(36),
        user_name VARCHAR(255),
        user_role VARCHAR(100),
        module VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        entity_id VARCHAR(255),
        description TEXT,
        old_values JSON,
        new_values JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(50) DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'daily_financial_summary',
      sql: `CREATE TABLE IF NOT EXISTS daily_financial_summary (
        id SERIAL PRIMARY KEY,
        clinic_id INT NOT NULL,
        summary_date DATE NOT NULL,
        total_revenue DECIMAL(15,2) DEFAULT 0,
        total_collections DECIMAL(15,2) DEFAULT 0,
        total_expenses DECIMAL(15,2) DEFAULT 0,
        net_profit DECIMAL(15,2) DEFAULT 0,
        patient_count INT DEFAULT 0,
        visit_count INT DEFAULT 0,
        bill_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_daily_summary UNIQUE (clinic_id, summary_date)
      )`
    }
  ];

  for (const table of tables) {
    try {
      await sequelize.query(table.sql);
      console.log(`  ✅ ${table.name} table ready`);
    } catch (err) {
      if (err.message?.includes('already exists')) {
        console.log(`  ${table.name} already exists`);
      } else {
        console.error(`  ❌ Error creating ${table.name}:`, err.message);
      }
    }
  }

  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module, action)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at)`); } catch(e){}
  try { await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)`); } catch(e){}

  console.log('\n=== Reporting Module Migration Complete ===\n');
}

module.exports = { migrateReportingTables };

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
        status ENUM('success', 'failure') DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_user (user_id),
        INDEX idx_audit_module (module, action),
        INDEX idx_audit_date (created_at),
        INDEX idx_audit_entity (entity_type, entity_id)
      )`
    },
    {
      name: 'daily_financial_summary',
      sql: `CREATE TABLE IF NOT EXISTS daily_financial_summary (
        id INT AUTO_INCREMENT PRIMARY KEY,
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_daily_summary (clinic_id, summary_date)
      )`
    }
  ];

  for (const table of tables) {
    try {
      await sequelize.query(table.sql);
      console.log(`  ✅ ${table.name} table ready`);
    } catch (err) {
      console.error(`  ❌ Error creating ${table.name}:`, err.message);
    }
  }

  console.log('\n=== Reporting Module Migration Complete ===\n');
}

module.exports = { migrateReportingTables };

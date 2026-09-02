const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

async function seedAuditLogs() {
  console.log('\n=== Seeding Audit Logs ===\n');

  try {
    // Check if table exists
    const [tables] = await sequelize.query("SHOW TABLES LIKE 'audit_logs'");
    if (tables.length === 0) {
      console.log('❌ audit_logs table does not exist. Run migration first.');
      return;
    }

    // Check current count
    const [countResult] = await sequelize.query('SELECT COUNT(*) as cnt FROM audit_logs');
    const currentCount = countResult[0].cnt;
    console.log(`Current audit log entries: ${currentCount}`);

    // Sample audit log entries
    const sampleLogs = [
      // Patient module
      { module: 'patients', action: 'create', entity_type: 'patient', user_name: 'Dr. Sarah Johnson', user_role: 'doctor', description: 'New patient registered', status: 'success' },
      { module: 'patients', action: 'update', entity_type: 'patient', user_name: 'Nurse Mary Smith', user_role: 'nurse', description: 'Updated patient contact information', status: 'success', old_values: { phone: '0712345678' }, new_values: { phone: '0723456789' } },
      { module: 'patients', action: 'view', entity_type: 'patient', user_name: 'Dr. John Doe', user_role: 'doctor', description: 'Viewed patient medical history', status: 'success' },
      
      // Billing module
      { module: 'billing', action: 'create_invoice', entity_type: 'invoice', user_name: 'Jane Accountant', user_role: 'accountant', description: 'Generated patient invoice', status: 'success' },
      { module: 'billing', action: 'payment_received', entity_type: 'payment', user_name: 'Cashier Tom', user_role: 'cashier', description: 'Received cash payment', status: 'success', new_values: { amount: 5000, method: 'cash' } },
      { module: 'billing', action: 'void_invoice', entity_type: 'invoice', user_name: 'Finance Manager', user_role: 'finance_manager', description: 'Voided duplicate invoice', status: 'success' },
      
      // Pharmacy module
      { module: 'pharmacy', action: 'dispense', entity_type: 'prescription', user_name: 'Pharmacist Alice', user_role: 'pharmacist', description: 'Dispensed medication', status: 'success', new_values: { drug: 'Amoxicillin 500mg', quantity: 21 } },
      { module: 'pharmacy', action: 'stock_update', entity_type: 'inventory', user_name: 'Pharmacist Bob', user_role: 'pharmacist', description: 'Updated stock levels', status: 'success', old_values: { stock: 100 }, new_values: { stock: 79 } },
      { module: 'pharmacy', action: 'dispense', entity_type: 'prescription', user_name: 'Pharmacist Alice', user_role: 'pharmacist', description: 'Attempted to dispense out-of-stock medication', status: 'failure' },
      
      // Laboratory module
      { module: 'laboratory', action: 'create_test', entity_type: 'lab_test', user_name: 'Lab Tech Mike', user_role: 'lab_technician', description: 'Created lab test order', status: 'success' },
      { module: 'laboratory', action: 'update_results', entity_type: 'lab_test', user_name: 'Lab Tech Sarah', user_role: 'lab_technician', description: 'Updated test results', status: 'success' },
      { module: 'laboratory', action: 'approve_results', entity_type: 'lab_test', user_name: 'Dr. Pathologist', user_role: 'doctor', description: 'Approved lab test results', status: 'success' },
      
      // Inpatient module
      { module: 'inpatient', action: 'admit_patient', entity_type: 'admission', user_name: 'Dr. Sarah Johnson', user_role: 'doctor', description: 'Admitted patient to ward', status: 'success', new_values: { ward: 'General Ward', bed: 'B-12' } },
      { module: 'inpatient', action: 'discharge_patient', entity_type: 'admission', user_name: 'Dr. John Doe', user_role: 'doctor', description: 'Discharged patient', status: 'success' },
      { module: 'inpatient', action: 'transfer_ward', entity_type: 'admission', user_name: 'Nurse Mary Smith', user_role: 'nurse', description: 'Transferred patient to ICU', status: 'success', old_values: { ward: 'General Ward' }, new_values: { ward: 'ICU' } },
      
      // User management
      { module: 'users', action: 'create', entity_type: 'user', user_name: 'Admin User', user_role: 'admin', description: 'Created new user account', status: 'success', new_values: { username: 'newdoctor', role: 'doctor' } },
      { module: 'users', action: 'update_role', entity_type: 'user', user_name: 'Admin User', user_role: 'admin', description: 'Updated user role', status: 'success', old_values: { role: 'nurse' }, new_values: { role: 'senior_nurse' } },
      { module: 'users', action: 'login', entity_type: 'session', user_name: 'Dr. Sarah Johnson', user_role: 'doctor', description: 'User logged in', status: 'success' },
      { module: 'users', action: 'login', entity_type: 'session', user_name: 'Unknown', user_role: null, description: 'Failed login attempt - invalid credentials', status: 'failure' },
      { module: 'users', action: 'logout', entity_type: 'session', user_name: 'Nurse Mary Smith', user_role: 'nurse', description: 'User logged out', status: 'success' },
      
      // Procurement
      { module: 'procurement', action: 'create_po', entity_type: 'purchase_order', user_name: 'Procurement Officer', user_role: 'procurement', description: 'Created purchase order', status: 'success', new_values: { po_number: 'PO-2024-001', supplier: 'MedSupply Ltd' } },
      { module: 'procurement', action: 'approve_po', entity_type: 'purchase_order', user_name: 'Finance Manager', user_role: 'finance_manager', description: 'Approved purchase order', status: 'success' },
      { module: 'procurement', action: 'receive_goods', entity_type: 'purchase_order', user_name: 'Store Keeper', user_role: 'store_keeper', description: 'Received goods from supplier', status: 'success' },
      
      // Reports
      { module: 'reports', action: 'generate', entity_type: 'report', user_name: 'Finance Manager', user_role: 'finance_manager', description: 'Generated financial report', status: 'success' },
      { module: 'reports', action: 'export', entity_type: 'report', user_name: 'Admin User', user_role: 'admin', description: 'Exported audit trail report', status: 'success' },
      
      // Settings
      { module: 'settings', action: 'update', entity_type: 'system_config', user_name: 'Admin User', user_role: 'admin', description: 'Updated system configuration', status: 'success', old_values: { currency: 'USD' }, new_values: { currency: 'KES' } },
      { module: 'settings', action: 'backup', entity_type: 'database', user_name: 'System', user_role: 'system', description: 'Automated database backup', status: 'success' },
    ];

    // Insert logs with varying timestamps over the past 30 days
    const now = new Date();
    let inserted = 0;

    for (let i = 0; i < sampleLogs.length; i++) {
      const log = sampleLogs[i];
      const daysAgo = Math.floor(Math.random() * 30);
      const hoursAgo = Math.floor(Math.random() * 24);
      const minutesAgo = Math.floor(Math.random() * 60);
      
      const timestamp = new Date(now);
      timestamp.setDate(timestamp.getDate() - daysAgo);
      timestamp.setHours(timestamp.getHours() - hoursAgo);
      timestamp.setMinutes(timestamp.getMinutes() - minutesAgo);

      const ipAddresses = ['192.168.1.10', '192.168.1.15', '192.168.1.20', '10.0.0.5', '172.16.0.10'];
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0'
      ];

      try {
        await sequelize.query(
          `INSERT INTO audit_logs (id, clinic_id, user_id, user_name, user_role, module, action, entity_type, entity_id, description, old_values, new_values, ip_address, user_agent, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          {
            replacements: [
              uuidv4(),
              1, // clinic_id
              uuidv4(), // user_id
              log.user_name,
              log.user_role,
              log.module,
              log.action,
              log.entity_type,
              uuidv4(), // entity_id
              log.description,
              log.old_values ? JSON.stringify(log.old_values) : null,
              log.new_values ? JSON.stringify(log.new_values) : null,
              ipAddresses[Math.floor(Math.random() * ipAddresses.length)],
              userAgents[Math.floor(Math.random() * userAgents.length)],
              log.status,
              timestamp
            ]
          }
        );
        inserted++;
      } catch (err) {
        console.error(`Failed to insert log ${i + 1}:`, err.message);
      }
    }

    console.log(`✅ Inserted ${inserted} audit log entries`);

    // Verify final count
    const [finalCount] = await sequelize.query('SELECT COUNT(*) as cnt FROM audit_logs');
    console.log(`Total audit log entries: ${finalCount[0].cnt}`);

    // Show module breakdown
    const [modules] = await sequelize.query('SELECT module, COUNT(*) as count FROM audit_logs GROUP BY module ORDER BY count DESC');
    console.log('\nModule breakdown:');
    modules.forEach(m => console.log(`  ${m.module}: ${m.count}`));

  } catch (err) {
    console.error('❌ Error seeding audit logs:', err.message);
  }

  console.log('\n=== Seeding Complete ===\n');
}

// Run if called directly
if (require.main === module) {
  seedAuditLogs().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedAuditLogs };

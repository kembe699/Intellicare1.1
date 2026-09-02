const express = require('express');
const router = express.Router();
const { PatientQueue, Visit, sequelize } = require('../models');
const { getBranchCondition } = require('../middleware/branchFilter');

// Get dashboard statistics for a clinic
router.get('/stats/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    console.log(`Fetching dashboard stats for clinic: ${clinicId}`);
    
    // Test database connection first
    try {
      await sequelize.authenticate();
      console.log('Database connection established successfully.');
    } catch (error) {
      console.error('Unable to connect to the database:', error);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log(`Date range: ${today.toISOString()} to ${tomorrow.toISOString()}`);

    // Total Patients — `patients`/Patient (queried below only for the branch
    // helper's sake) is the legacy, barely-used table (3 stale rows). The
    // actual patient registry every real page (billing, pharmacy, reports,
    // inpatient, and the Patient Directory UI itself) reads and writes is
    // lis_participants, which has no clinic_id/branch_id column at all — it
    // isn't clinic-scoped, so neither is this count.
    const branchWhere = getBranchCondition(req);
    let totalPatients = 0;
    try {
      const [[row]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM lis_participants`);
      totalPatients = parseInt(row?.cnt || 0);
    } catch (error) {
      console.log('Total patients count error:', error.message);
    }
    console.log(`Total patients: ${totalPatients}`);

    // Today's Registrations
    let todayRegistrations = 0;
    try {
      const [[row]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM lis_participants WHERE created_at >= :today AND created_at < :tomorrow`,
        { replacements: { today, tomorrow } }
      );
      todayRegistrations = parseInt(row?.cnt || 0);
    } catch (error) {
      console.log('Today\'s registrations count error:', error.message);
    }
    console.log(`Today's registrations: ${todayRegistrations}`);

    // Queue Patients (waiting or in_progress)
    const queuePatients = await PatientQueue.count({
      where: {
        ...branchWhere,
        status: {
          [sequelize.Sequelize.Op.in]: ['waiting', 'in_progress']
        }
      }
    });

    // Today's Visits - with error handling
    let todayVisits = 0;
    try {
      todayVisits = await Visit.count({
        where: {
          clinic_id: parseInt(clinicId),
          ...branchWhere,
          visit_date: {
            [sequelize.Sequelize.Op.gte]: today,
            [sequelize.Sequelize.Op.lt]: tomorrow
          }
        }
      });
    } catch (error) {
      console.log('Visit count error (table may not exist):', error.message);
    }

    // Pending Lab Tests — the `lab_tests` table is the test catalog (has no
    // `status` column at all), so this always threw and silently returned 0.
    // Real pending/completed work lives in lis_specimens, the table LIS
    // (the actively-used lab pipeline) writes to.
    let pendingLabTests = 0;
    try {
      const [[row]] = await sequelize.query(
        // No facility filter: lis_test_orders.clinic_id is the *consulting*
        // clinic (a dr_clinics UUID, alongside clinic_name/room_number), not
        // the facility id — comparing it to a numeric clinic_id matched nothing
        // under MySQL (which coerced the UUID to 0) and errors outright on
        // Postgres, so this count silently read 0 either way. Each tenant has
        // its own database, so the whole table already belongs to one facility.
        `SELECT COUNT(*) AS cnt FROM lis_specimens s
         WHERE s.status NOT IN ('approved', 'queried', 'cancelled')`,
        {}
      );
      pendingLabTests = parseInt(row?.cnt || 0);
    } catch (error) {
      console.log('Pending lab tests count error:', error.message);
    }

    // Completed Lab Tests (today)
    let completedLabTests = 0;
    try {
      const [[row]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM lis_specimens s
         WHERE s.status = 'approved'
           AND s.updated_at >= :today AND s.updated_at < :tomorrow`,
        { replacements: { today, tomorrow } }
      );
      completedLabTests = parseInt(row?.cnt || 0);
    } catch (error) {
      console.log('Completed lab tests count error:', error.message);
    }

    // Low Stock Alerts — DrugInventory/drug_inventory is the legacy, unused
    // pharmacy table (empty in production). Real stock lives in
    // inventory_items, which the active pharmacy-module pages read/write.
    let lowStockAlerts = 0;
    try {
      const [[row]] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM inventory_items
         WHERE clinic_id = :clinicId AND is_active = true
           AND quantity_on_hand <= minimum_stock_level`,
        { replacements: { clinicId: parseInt(clinicId) } }
      );
      lowStockAlerts = parseInt(row?.cnt || 0);
    } catch (error) {
      console.log('Low stock alerts count error:', error.message);
    }

    // Outstanding balance — a live snapshot of everything currently unpaid, not scoped to
    // when the bill was first raised. Scoping this by bill_date (as it used to be) meant a
    // bill opened weeks ago with money still owed on it — the normal case — never counted,
    // so this was showing ~0 almost all the time even on days with real billing activity.
    // "Paid" for the dashboard's Paid vs Outstanding chart comes from the receipts endpoint
    // instead (see /api/receipts/clinic/:clinicId/stats), which is real period-filterable
    // collections data already wired to the same Today/Week/Month/custom controls the rest
    // of the dashboard uses — outstanding has no such "period" of its own, it's owed right now.
    let totalOutstanding = 0;
    try {
      const [[row]] = await sequelize.query(
        `SELECT COALESCE(SUM(GREATEST(balance_amount, 0)), 0) AS outstanding
         FROM patient_bills WHERE clinic_id = :clinicId AND status != 'cancelled'`,
        { replacements: { clinicId: parseInt(clinicId) } }
      );
      totalOutstanding = parseFloat(row?.outstanding || 0);
    } catch (error) {
      console.log('Outstanding balance error:', error.message);
    }

    const stats = {
      totalPatients,
      todayPatients: todayRegistrations,
      todayVisits,
      pendingLabTests,
      completedLabTests,
      lowStockItems: lowStockAlerts,
      queuePatients,
      totalOutstanding
    };

    console.log('Dashboard stats calculated:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

module.exports = router;

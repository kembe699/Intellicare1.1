const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /pharmacy-dispensing, so the API enforces what the client already assumes.
const router = express.Router();
const { Patient, DrugInventory, Prescription, PharmacyDispensing, Receipt, sequelize } = require('../models');

// Get pharmacy inventory for a clinic
router.get('/inventory/:clinicId', async (req, res) => {
  try {
    console.log('=== PHARMACY INVENTORY REQUEST ===');
    const { clinicId } = req.params;
    console.log('Clinic ID:', clinicId);
    
    console.log('Fetching drug inventory from database...');
    const inventory = await DrugInventory.findAll({
      where: { clinic_id: clinicId },
      order: [['drug_name', 'ASC']]
    });

    console.log('Inventory found:', inventory ? inventory.length + ' items' : 'none');
    console.log('Sample inventory items:', inventory.slice(0, 3).map(item => ({ id: item.id, drug_name: item.drug_name, current_stock: item.current_stock })));

    res.json(inventory);
  } catch (error) {
    console.error('=== PHARMACY INVENTORY ERROR ===');
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch pharmacy inventory', details: error.message });
  }
});

// Add inventory item
router.post('/inventory', authorize('pharmacy.write'), async (req, res) => {
  try {
    console.log('=== ADD INVENTORY ITEM REQUEST ===');
    const inventoryData = req.body;
    console.log('Request body received:', JSON.stringify(inventoryData, null, 2));
    console.log('Request headers:', req.headers);
    
    // Validate required fields
    const requiredFields = ['drug_name', 'current_stock', 'expiry_date', 'reorder_level', 'clinic_id', 'date_received', 'received_by', 'unit_of_measure'];
    const missingFields = requiredFields.filter(field => !inventoryData[field] && inventoryData[field] !== 0);
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields: missingFields 
      });
    }
    
    // Generate UUID for the inventory item
    const { v4: uuidv4 } = require('uuid');
    inventoryData.id = uuidv4();
    
    // Ensure numeric fields are properly converted
    inventoryData.current_stock = parseInt(inventoryData.current_stock);
    inventoryData.quantity_received = parseInt(inventoryData.quantity_received || inventoryData.current_stock);
    inventoryData.reorder_level = parseInt(inventoryData.reorder_level);
    inventoryData.clinic_id = parseInt(inventoryData.clinic_id);
    
    // Handle price fields
    if (inventoryData.unit_cost) {
      inventoryData.unit_cost = parseFloat(inventoryData.unit_cost);
    }
    if (inventoryData.selling_price) {
      inventoryData.selling_price = parseFloat(inventoryData.selling_price);
    }
    
    console.log('Processed inventory data before DB insert:', JSON.stringify(inventoryData, null, 2));
    
    console.log('Attempting to create inventory item in database...');
    const inventoryItem = await DrugInventory.create(inventoryData);
    console.log('Inventory item created successfully with ID:', inventoryItem.id);
    
    res.json(inventoryItem);
  } catch (error) {
    console.error('=== ERROR ADDING INVENTORY ITEM ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    
    if (error.errors && error.errors.length > 0) {
      console.error('Validation errors:', error.errors.map(e => ({
        field: e.path,
        message: e.message,
        value: e.value
      })));
    }
    
    // Provide more specific error messages
    let errorMessage = 'Failed to add inventory item';
    if (error.name === 'SequelizeValidationError') {
      errorMessage = 'Validation error: ' + error.errors.map(e => e.message).join(', ');
    } else if (error.name === 'SequelizeDatabaseError') {
      errorMessage = 'Database error: ' + error.message;
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.message 
    });
  }
});

// Update inventory item
router.put('/inventory/:itemId', authorize('pharmacy.write'), async (req, res) => {
  try {
    const { itemId } = req.params;
    const updateData = req.body;
    
    // Handle numeric fields
    if (updateData.current_stock) {
      updateData.current_stock = parseInt(updateData.current_stock);
    }
    if (updateData.reorder_level) {
      updateData.reorder_level = parseInt(updateData.reorder_level);
    }
    if (updateData.unit_cost) {
      updateData.unit_cost = parseFloat(updateData.unit_cost);
    }
    if (updateData.selling_price) {
      updateData.selling_price = parseFloat(updateData.selling_price);
    }
    
    console.log('Updating inventory item:', itemId, 'with data:', updateData);
    
    const [updatedRows] = await DrugInventory.update(updateData, {
      where: { id: itemId }
    });

    if (updatedRows === 0) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    res.json({ message: 'Inventory item updated successfully' });
  } catch (error) {
    console.error('Error updating inventory item:', error);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// Delete inventory item
router.delete('/inventory/:itemId', authorize('pharmacy.write'), async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const deletedRows = await DrugInventory.destroy({
      where: { id: itemId }
    });

    if (deletedRows === 0) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    res.json({ message: 'Inventory item deleted successfully' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

// Get prescriptions for pharmacy dispensing
router.get('/prescriptions/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    
    // Optimize: Limit to recent active prescriptions
    const prescriptions = await Prescription.findAll({
      where: { 
        clinic_id: parseInt(clinicId),
        status: 'active' // Only show active prescriptions
      },
      order: [['prescribed_at', 'DESC']],
      limit: 200 // Limit to recent 200 prescriptions for performance
    });

    res.json(prescriptions);
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    res.status(500).json({ error: 'Failed to fetch prescriptions' });
  }
});

// Update prescription status (e.g., mark as dispensed)
router.put('/prescriptions/:prescriptionId', authorize('pharmacy.write'), async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const { status } = req.body;
    
    const [updatedRows] = await Prescription.update(
      { status },
      { where: { id: prescriptionId } }
    );

    if (updatedRows === 0) {
      return res.status(404).json({ error: 'Prescription not found' });
    }

    res.json({ message: 'Prescription status updated successfully' });
  } catch (error) {
    console.error('Error updating prescription status:', error);
    res.status(500).json({ error: 'Failed to update prescription status' });
  }
});

// Get dispensing history for a clinic
router.get('/dispensing/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { sequelize } = require('../models');
    
    // Use raw query to join with patients and drug_inventory tables
    // Optimize: Limit to recent 500 records for performance
    const dispensingHistory = await sequelize.query(`
      SELECT 
        pd.*,
        p.first_name,
        p.last_name,
        di.drug_name,
        u.display_name as dispensed_by_name
      FROM pharmacy_dispensing pd
      LEFT JOIN patients p ON pd.patient_id = p.id
      LEFT JOIN drug_inventory di ON pd.drug_id = di.id
      LEFT JOIN users u ON pd.dispensed_by = u.id
      WHERE pd.clinic_id = :clinicId
      ORDER BY pd.dispensed_at DESC
      LIMIT 500
    `, {
      replacements: { clinicId: parseInt(clinicId) },
      type: sequelize.QueryTypes.SELECT
    });
    
    res.json(dispensingHistory);
  } catch (error) {
    console.error('Error fetching dispensing history:', error);
    res.status(500).json({ error: 'Failed to fetch dispensing history' });
  }
});

// Add dispensing record
router.post('/dispensing', authorize('pharmacy.write'), async (req, res) => {
  try {
    const dispensingData = req.body;
    console.log('Adding dispensing record:', dispensingData);
    
    // Generate UUID for the dispensing record
    const { v4: uuidv4 } = require('uuid');
    dispensingData.id = uuidv4();
    
    const dispensingRecord = await PharmacyDispensing.create(dispensingData);
    console.log('Dispensing record created successfully:', dispensingRecord.id);
    
    res.json(dispensingRecord);
  } catch (error) {
    console.error('Error adding dispensing record:', error);
    res.status(500).json({ error: 'Failed to add dispensing record' });
  }
});


// Get patients for pharmacy (reuse existing patients)
router.get('/patients/:clinicId', async (req, res) => {
  try {
    const { clinicId } = req.params;
    
    // Optimize: Only fetch recent patients and necessary fields
    const patients = await Patient.findAll({
      where: { clinic_id: parseInt(clinicId) },
      attributes: ['id', 'patient_id', 'first_name', 'last_name', 'date_of_birth', 'phone_number', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 500 // Limit to recent 500 patients for performance
    });

    res.json(patients);
  } catch (error) {
    console.error('Error fetching patients for pharmacy:', error);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Create pharmacy receipt
router.post('/receipts', authorize('pharmacy.write'), async (req, res) => {
  try {
    const receiptData = req.body;
    console.log('Creating pharmacy receipt:', receiptData);
    
    // Check for active cashier shift for the current user
    const { CashierShift } = require('../models');
    const userId = req.user?.id;
    
    if (!userId) {
      console.log('Validation failed: No authenticated user');
      return res.status(401).json({ 
        error: 'Authentication required',
        requiresAuth: true
      });
    }
    
    const activeShift = await CashierShift.findOne({
      where: { 
        cashier_id: userId,
        status: 'open' 
      },
      order: [['start_time', 'DESC']]
    });
    
    if (!activeShift) {
      console.log('Validation failed: No active cashier shift for user:', userId);
      return res.status(403).json({ 
        error: 'No active cashier shift found. Please start a cashier shift before making payments.',
        requiresShift: true,
        userId: userId
      });
    }
    
    // Generate receipt number and ID
    const receiptNumber = `RCP-${Date.now().toString().slice(-8)}`;
    const receiptId = `receipt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const finalReceiptData = {
      id: receiptId,
      receipt_number: receiptNumber,
      bill_id: receiptData.bill_id,
      patient_id: receiptData.patient_id,
      patient_name: receiptData.patient_name,
      clinic_id: receiptData.clinic_id,
      payment_amount: receiptData.payment_amount,
      payment_method: receiptData.payment_method,
      payment_date: new Date(receiptData.payment_date),
      paid_services: receiptData.paid_services || [],
      service_details: receiptData.service_details || [],
      notes: receiptData.notes,
      from_lease: receiptData.from_lease || false,
      lease_details: receiptData.lease_details,
      cashier_name: receiptData.cashier_name,
      cashier_id: receiptData.cashier_id,
      status: 'active'
    };
    
    const receipt = await Receipt.create(finalReceiptData);
    console.log('Pharmacy receipt created successfully:', receipt.receipt_number);
    
    // If payment method is cash, update Cash at Hand sub-account
    if (receiptData.payment_method === 'cash') {
      const { LedgerAccount } = require('../models');
      
      // Find the main cash account
      let cashAccount = await LedgerAccount.findOne({
        where: { account_code: '01' }
      });
      
      // Find cash at hand sub-account
      let cashAtHandAccount = await LedgerAccount.findOne({
        where: { 
          account_code: '3',
          parent_account_id: cashAccount ? cashAccount.id : null
        }
      });
      
      if (cashAtHandAccount) {
        // Add cash payment to Cash at Hand sub-account balance
        await cashAtHandAccount.update({
          balance: parseFloat(cashAtHandAccount.balance) + parseFloat(receiptData.payment_amount)
        });
        
        // Update parent cash account balance
        if (cashAccount) {
          await cashAccount.update({
            balance: parseFloat(cashAccount.balance) + parseFloat(receiptData.payment_amount)
          });
        }
      }
    }
    
    res.json({
      message: 'Pharmacy receipt created successfully',
      receipt: receipt
    });
  } catch (error) {
    console.error('Error creating pharmacy receipt:', error);
    res.status(500).json({ 
      error: 'Failed to create pharmacy receipt',
      details: error.message 
    });
  }
});

module.exports = router;

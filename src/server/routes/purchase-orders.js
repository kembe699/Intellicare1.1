const express = require('express');
const router = express.Router();
const { PurchaseOrder, PurchaseOrderItem } = require('../models');

// Get all purchase orders
router.get('/', async (req, res) => {
  try {
    // include: needs the real, tenant-bound model classes (not the
    // request-agnostic top-level import) so Sequelize's association lookup
    // matches correctly — see models/index.js's tenant-aware proxy comment.
    const { PurchaseOrder, PurchaseOrderItem } = req.models;
    const orders = await PurchaseOrder.findAll({
      include: [{
        model: PurchaseOrderItem,
        as: 'items'
      }],
      order: [['created_at', 'DESC']]
    });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// Get single purchase order with items
router.get('/:id', async (req, res) => {
  try {
    const { PurchaseOrder, PurchaseOrderItem } = req.models;
    const order = await PurchaseOrder.findByPk(req.params.id, {
      include: [{
        model: PurchaseOrderItem,
        as: 'items'
      }]
    });
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    res.status(500).json({ error: 'Failed to fetch purchase order' });
  }
});

// Create new purchase order
router.post('/', async (req, res) => {
  try {
    console.log('=== CREATE PURCHASE ORDER REQUEST ===');
    console.log('Request body:', req.body);
    
    // Generate PO number
    const count = await PurchaseOrder.count();
    const poNumber = `PO-${String(count + 1).padStart(6, '0')}`;
    
    console.log('Generated PO number:', poNumber);
    console.log('Attempting to create PO with data:', {
      supplier_id: parseInt(req.body.supplier_id),
      order_date: req.body.order_date,
      notes: req.body.notes || '',
      po_number: poNumber,
      status: 'draft',
      total_amount: 0.00
    });
    
    const order = await PurchaseOrder.create({
      supplier_id: parseInt(req.body.supplier_id),
      order_date: req.body.order_date,
      notes: req.body.notes || '',
      po_number: poNumber,
      status: 'draft',
      total_amount: 0.00 // Will be calculated when items are added
    });
    
    console.log('Purchase order created successfully:', order.toJSON());
    try { const rr = require('./reports'); await rr.logAudit({ user_id: req.user?.id, user_name: req.user?.display_name, user_role: req.user?.role, module: 'Procurement', action: 'PO_CREATED', entity_type: 'PurchaseOrder', entity_id: String(order.id), description: `PO ${poNumber} created`, new_values: { po_number: poNumber, supplier_id: req.body.supplier_id }, ip_address: req.ip, status: 'success' }); } catch(e) {}
    res.status(201).json(order);
  } catch (error) {
    console.error('=== ERROR CREATING PURCHASE ORDER ===');
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
    
    res.status(500).json({ 
      error: 'Failed to create purchase order',
      details: error.message,
      validationErrors: error.errors ? error.errors.map(e => ({
        field: e.path,
        message: e.message
      })) : []
    });
  }
});

// Add item to purchase order
router.post('/:id/items', async (req, res) => {
  try {
    const order = await PurchaseOrder.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const { item_name, description, quantity, unit_price, unit_of_measure } = req.body;
    const total_price = quantity * unit_price;

    const item = await PurchaseOrderItem.create({
      purchase_order_id: req.params.id,
      item_name,
      description,
      quantity,
      unit_price,
      total_price,
      unit_of_measure
    });

    // Update PO total amount
    const items = await PurchaseOrderItem.findAll({
      where: { purchase_order_id: req.params.id }
    });
    const newTotal = items.reduce((sum, item) => sum + parseFloat(item.total_price), 0);
    await order.update({ total_amount: newTotal });

    res.status(201).json(item);
  } catch (error) {
    console.error('Error adding item to purchase order:', error);
    res.status(500).json({ error: 'Failed to add item to purchase order' });
  }
});

// Update purchase order item
router.put('/:id/items/:itemId', async (req, res) => {
  try {
    const item = await PurchaseOrderItem.findOne({
      where: { 
        id: req.params.itemId,
        purchase_order_id: req.params.id
      }
    });
    
    if (!item) {
      return res.status(404).json({ error: 'Purchase order item not found' });
    }

    const { quantity, unit_price } = req.body;
    const total_price = quantity * unit_price;

    await item.update({
      ...req.body,
      total_price
    });

    // Update PO total amount
    const order = await PurchaseOrder.findByPk(req.params.id);
    const items = await PurchaseOrderItem.findAll({
      where: { purchase_order_id: req.params.id }
    });
    const newTotal = items.reduce((sum, item) => sum + parseFloat(item.total_price), 0);
    await order.update({ total_amount: newTotal });

    res.json(item);
  } catch (error) {
    console.error('Error updating purchase order item:', error);
    res.status(500).json({ error: 'Failed to update purchase order item' });
  }
});

// Delete purchase order item
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const item = await PurchaseOrderItem.findOne({
      where: { 
        id: req.params.itemId,
        purchase_order_id: req.params.id
      }
    });
    
    if (!item) {
      return res.status(404).json({ error: 'Purchase order item not found' });
    }

    await item.destroy();

    // Update PO total amount
    const order = await PurchaseOrder.findByPk(req.params.id);
    const items = await PurchaseOrderItem.findAll({
      where: { purchase_order_id: req.params.id }
    });
    const newTotal = items.reduce((sum, item) => sum + parseFloat(item.total_price), 0);
    await order.update({ total_amount: newTotal });

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting purchase order item:', error);
    res.status(500).json({ error: 'Failed to delete purchase order item' });
  }
});

// Update purchase order
router.put('/:id', async (req, res) => {
  try {
    const order = await PurchaseOrder.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const updateData = { ...req.body };
    
    // If signature data is provided, store it with the status update
    if (req.body.signature && req.body.status) {
      const statusField = `${req.body.status}_signature`;
      const signedByField = `${req.body.status}_signed_by`;
      const signedAtField = `${req.body.status}_signed_at`;
      
      updateData[statusField] = req.body.signature;
      updateData[signedByField] = req.body.signedBy;
      updateData[signedAtField] = req.body.signedAt;
      
      // Remove signature data from main update to avoid column errors
      delete updateData.signature;
      delete updateData.signedBy;
      delete updateData.signedAt;
    }

    const prevStatus = order.status;
    await order.update(updateData);
    if (req.body.status && req.body.status !== prevStatus) {
      try { const rr = require('./reports'); await rr.logAudit({ user_id: req.user?.id, user_name: req.user?.display_name, user_role: req.user?.role, module: 'Procurement', action: `PO_STATUS_${req.body.status.toUpperCase()}`, entity_type: 'PurchaseOrder', entity_id: String(order.id), description: `PO ${order.po_number} status changed: ${prevStatus} → ${req.body.status}`, old_values: { status: prevStatus }, new_values: { status: req.body.status }, ip_address: req.ip, status: 'success' }); } catch(e) {}
    }
    res.json(order);
  } catch (error) {
    console.error('Error updating purchase order:', error);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

module.exports = router;

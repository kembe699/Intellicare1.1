const express = require('express');
const router = express.Router();
const { Service } = require('../models');
const { authorize } = require('../middleware/authorize');
const { resolveRevenueAccount } = require('../utils/resolveRevenueAccount');

// Get all services
router.get('/', async (req, res) => {
  try {
    const services = await Service.findAll({
      order: [['created_at', 'DESC']]
    });

    // Transform data for frontend
    const transformedServices = services.map(service => ({
      id: service.id,
      name: service.service_name,
      category: service.category,
      price: service.price,
      description: service.description,
      isActive: service.is_active,
      revenue_account_id: service.revenue_account_id || null,
      createdAt: service.created_at,
      updatedAt: service.updated_at
    }));

    res.json(transformedServices);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Get service by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findByPk(id);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const transformedService = {
      id: service.id,
      service_name: service.service_name,
      name: service.service_name,
      category: service.category,
      price: service.price,
      description: service.description,
      isActive: service.is_active,
      revenue_account_id: service.revenue_account_id || null,
      createdAt: service.created_at,
      updatedAt: service.updated_at
    };

    res.json(transformedService);
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// Create new service
router.post('/', authorize(['admin']), async (req, res) => {
  try {
    const serviceData = req.body;
    console.log('Creating service with data:', serviceData);

    // Validate required fields
    if (!serviceData.service_name) {
      return res.status(400).json({ error: 'Service name is required' });
    }
    if (!serviceData.category) {
      return res.status(400).json({ error: 'Category is required' });
    }

    const revenueAccountId = serviceData.revenue_account_id ||
      await resolveRevenueAccount(serviceData.category, serviceData.clinic_id);

    // Create service
    const service = await Service.create({
      service_name: serviceData.service_name.trim(),
      category: serviceData.category,
      price: serviceData.price || 0,
      description: serviceData.description?.trim() || null,
      is_active: serviceData.is_active !== undefined ? serviceData.is_active : true,
      created_by: serviceData.created_by || 'system',
      revenue_account_id: revenueAccountId || null
    });

    console.log('Service created successfully:', service.id);

    // Transform response
    const transformedService = {
      id: service.id,
      name: service.service_name,
      category: service.category,
      price: service.price,
      description: service.description,
      isActive: service.is_active,
      createdAt: service.created_at,
      updatedAt: service.updated_at
    };

    res.status(201).json(transformedService);
  } catch (error) {
    console.error('Error creating service:', error);
    
    // Handle unique constraint violation
    if (error.original?.code === '23505' || error.message?.includes('unique')) {
      return res.status(400).json({ error: 'A service with this name already exists' });
    }
    
    res.status(500).json({ 
      error: 'Failed to create service',
      details: error.message 
    });
  }
});

// Update service
router.put('/:id', authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log('Updating service:', id, 'with data:', updateData);

    const service = await Service.findByPk(id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Validate required fields
    if (updateData.service_name && !updateData.service_name.trim()) {
      return res.status(400).json({ error: 'Service name cannot be empty' });
    }

    const newCategory = updateData.category || service.category;
    const revenueAccountId = updateData.revenue_account_id ||
      (newCategory !== service.category
        ? await resolveRevenueAccount(newCategory, updateData.clinic_id)
        : service.revenue_account_id);

    // Update service
    await service.update({
      service_name: updateData.service_name?.trim() || service.service_name,
      category: newCategory,
      price: updateData.price !== undefined ? updateData.price : service.price,
      description: updateData.description?.trim() || service.description,
      is_active: updateData.is_active !== undefined ? updateData.is_active : service.is_active,
      updated_by: updateData.updated_by || 'system',
      revenue_account_id: revenueAccountId || service.revenue_account_id
    });

    console.log('Service updated successfully:', service.id);

    // Transform response
    const transformedService = {
      id: service.id,
      name: service.service_name,
      category: service.category,
      price: service.price,
      description: service.description,
      isActive: service.is_active,
      createdAt: service.created_at,
      updatedAt: service.updated_at
    };

    res.json(transformedService);
  } catch (error) {
    console.error('Error updating service:', error);
    
    // Handle unique constraint violation
    if (error.original?.code === '23505' || error.message?.includes('unique')) {
      return res.status(400).json({ error: 'A service with this name already exists' });
    }
    
    res.status(500).json({ 
      error: 'Failed to update service',
      details: error.message 
    });
  }
});

// Delete service
router.delete('/:id', authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findByPk(id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await service.destroy();
    console.log('Service deleted successfully:', id);

    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ 
      error: 'Failed to delete service',
      details: error.message 
    });
  }
});

// Get services by category
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    
    const services = await Service.findAll({
      where: { 
        category: category,
        is_active: true 
      },
      order: [['service_name', 'ASC']]
    });

    // Transform data for frontend
    const transformedServices = services.map(service => ({
      id: service.id,
      name: service.service_name,
      category: service.category,
      price: service.price,
      description: service.description,
      isActive: service.is_active,
      createdAt: service.created_at,
      updatedAt: service.updated_at
    }));

    res.json(transformedServices);
  } catch (error) {
    console.error('Error fetching services by category:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Seed the curated lab-test catalog (see scripts/labServicesData.js) — safely
// re-runnable, only adds whatever isn't already in the services table.
router.post('/seed-lab-services', authorize(['admin']), async (req, res) => {
  try {
    const { seedLabServices } = require('../scripts/seedLabServices');
    const result = await seedLabServices(req.body.clinic_id, req.user?.id, { Service, resolveRevenueAccount });
    res.status(result.success ? 201 : 200).json(result);
  } catch (error) {
    console.error('Error seeding lab services:', error);
    res.status(500).json({ error: 'Failed to seed lab services' });
  }
});

module.exports = router;

import sequelize from '../lib/database';
import { initializeAssociations } from '../models/associations';

// Import all models to ensure they're registered with Sequelize
import '../models/User';
import '../models/ClinicName';
import '../models/Patient';
import '../models/Visit';
import '../models/Vitals';
import '../models/PhysicalExamination';
import '../models/TreatmentPlan';
import '../models/TreatmentPlanMedication';
import '../models/TreatmentPlanProcedure';
import '../models/Diagnosis';
import '../models/LabTestCategory';
import '../models/LabTest';
import '../models/LabTestComponent';
import '../models/LabRequest';
import '../models/LabResult';
import '../models/LabResultComponentValue';
import '../models/DrugInventory';
import '../models/Prescription';
import '../models/PrescriptionItem';
import '../models/PharmacyDispensing';
import '../models/PharmacyReturn';
import '../models/PatientQueue';

// Initialize clinic names
async function seedClinicNames() {
  const { ClinicName } = sequelize.models;
  
  const clinics = [
    { name: 'IntelliCare' },
    { name: 'Moleeta' },
    { name: 'Adar' },
    { name: 'Gumry' },
    { name: 'Friendship' }
  ];

  try {
    for (const clinic of clinics) {
      await ClinicName.findOrCreate({
        where: { name: clinic.name },
        defaults: clinic
      });
    }
    console.log('Initial clinic names created');
  } catch (error) {
    console.error('Error seeding clinic names:', error);
  }
}

// Initialize lab test categories
async function seedLabTestCategories() {
  const { LabTestCategory } = sequelize.models;
  
  const categories = [
    { name: 'Hematology' },
    { name: 'Chemistry' },
    { name: 'Microbiology' },
    { name: 'Urinalysis' },
    { name: 'Serology' },
    { name: 'Parasitology' },
    { name: 'Other' }
  ];

  try {
    for (const category of categories) {
      await LabTestCategory.findOrCreate({
        where: { name: category.name },
        defaults: category
      });
    }
    console.log('Initial lab test categories created');
  } catch (error) {
    console.error('Error seeding lab test categories:', error);
  }
}

async function initializeDatabase() {
  try {
    console.log('Initializing database schema...');
    
    // Set up model associations
    initializeAssociations();
    
    // Create tables if they don't exist
    await sequelize.sync();
    console.log('Database tables created successfully');
    
    // Seed initial data
    await seedClinicNames();
    await seedLabTestCategories();
    
    console.log('Database initialization completed successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run the initialization
initializeDatabase();

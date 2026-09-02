import sequelize, { testConnection } from './database';
import { initializeAssociations } from '../models/associations';

// Import all model files to ensure they're registered with Sequelize
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

/**
 * Initialize database connection and model associations
 */
export async function initializeDatabase() {
  try {
    // Test the database connection
    const isConnected = await testConnection();
    if (!isConnected) {
      console.error('Failed to connect to the database');
      return false;
    }
    
    // First initialize model associations (establish relationships)
    initializeAssociations();
    
    // Then sync models with the database (create tables if they don't exist)
    // Use { alter: true } to allow adding new columns to existing tables
    // This is safer than force: true which would drop tables
    await sequelize.sync({ alter: true });
    
    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing database:', error);
    return false;
  }
}

export default initializeDatabase;

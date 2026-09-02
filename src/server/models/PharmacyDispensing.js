const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PharmacyDispensing = sequelize.define('PharmacyDispensing', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    drug_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    patient_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    visit_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    prescription_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    quantity_dispensed: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    unit_of_measure: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    dosage: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    frequency: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    duration: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    instructions: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    dispensed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    dispensed_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: 'dispensed',
    },
  }, {
    tableName: 'pharmacy_dispensing',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  return PharmacyDispensing;
};

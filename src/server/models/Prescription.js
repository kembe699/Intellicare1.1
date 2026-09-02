const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Prescription = sequelize.define('Prescription', {
    id: {
      type: DataTypes.STRING(36),
      primaryKey: true,
      allowNull: false
    },
    visit_id: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    patient_id: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    drug_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    dosage: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    frequency: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    duration: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    instructions: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    prescribed_by: {
      type: DataTypes.UUID,
      allowNull: true
    },
    prescribed_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(50),
      defaultValue: 'active',
      allowNull: true
    },
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'prescriptions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['visit_id']
      },
      {
        fields: ['patient_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['prescribed_at']
      }
    ]
  });

  return Prescription;
};

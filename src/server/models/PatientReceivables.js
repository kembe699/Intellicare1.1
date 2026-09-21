const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PatientReceivables = sequelize.define('PatientReceivables', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    patient_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    bill_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    bill_number: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    service_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    bill_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    service_description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    service_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    amount_due: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    amount_paid: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    amount_adjusted: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('pending', 'partial', 'overdue', 'paid', 'written_off'),
      defaultValue: 'pending',
    },
    days_overdue: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    last_payment_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    gl_entry_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Guaranteed by the branch-isolation migration (ensureBranchIsolationColumns.js) —
    // declared here so create() actually writes it instead of silently dropping it
    // (Sequelize ignores any key passed to create() that isn't a declared attribute).
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'patient_receivables',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'status'],
      },
      {
        fields: ['patient_id', 'amount_due'],
      },
      {
        fields: ['bill_id'],
      },
      {
        fields: ['due_date'],
      },
      {
        fields: ['status'],
      },
    ],
    // Temporarily disable foreign key constraints during creation
    sync: {
      force: false,
      alter: false,
    },
  });

  return PatientReceivables;
};

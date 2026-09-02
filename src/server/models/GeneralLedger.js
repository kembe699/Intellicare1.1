const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GeneralLedger = sequelize.define('GeneralLedger', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    gl_number: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    transaction_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    posting_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    transaction_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    reference_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    reference_module: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    transaction_currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'SSP',
    },
    base_currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'SSP',
    },
    exchange_rate: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
      defaultValue: 1.000000,
    },
    total_debit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    total_credit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    base_total_debit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    base_total_credit: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    is_balanced: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_posted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    posted_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    posted_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('draft', 'pending_approval', 'posted', 'reversed'),
      defaultValue: 'draft',
    },
    approval_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    approval_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  }, {
    tableName: 'general_ledger',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'transaction_date', 'status'],
      },
      {
        fields: ['reference_module', 'reference_id'],
      },
      {
        fields: ['gl_number'],
        unique: true,
      },
      {
        fields: ['transaction_date'],
      },
      {
        fields: ['status'],
      },
    ],
  });

  return GeneralLedger;
};

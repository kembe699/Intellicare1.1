const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ChartOfAccounts = sequelize.define('ChartOfAccounts', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    account_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    account_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    account_type: {
      type: DataTypes.ENUM('asset', 'liability', 'equity', 'revenue', 'expense'),
      allowNull: false,
    },
    sub_account_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    balance_type: {
      type: DataTypes.ENUM('debit', 'credit'),
      allowNull: false,
    },
    opening_balance: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    opening_balance_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    is_bank_account: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_customer_account: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_supplier_account: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    tableName: 'chart_of_accounts',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'account_code'],
        unique: true,
      },
      {
        fields: ['account_type'],
      },
      {
        fields: ['is_active'],
      },
    ],
  });

  return ChartOfAccounts;
};

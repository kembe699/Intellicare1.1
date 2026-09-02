const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LedgerAccount = sequelize.define('LedgerAccount', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  account_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  account_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  account_type: {
    type: DataTypes.ENUM('asset', 'liability', 'equity', 'revenue', 'expense'),
    allowNull: false,
    defaultValue: 'asset'
  },
  parent_account_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ledger_accounts',
      key: 'id'
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  balance: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0.00
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ledger_accounts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

  return LedgerAccount;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AccountLedger = sequelize.define('AccountLedger', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    account_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'chart_of_accounts',
        key: 'id',
      },
    },
    transaction_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'general_ledger',
        key: 'id',
      },
    },
    transaction_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    debit_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    credit_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    reference_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    posted_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    posted_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_posted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    source_module: {
      type: DataTypes.STRING(50),
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
    tableName: 'account_ledger',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'account_id', 'transaction_date'],
      },
      {
        fields: ['transaction_date'],
      },
      {
        fields: ['account_id'],
      },
      {
        fields: ['transaction_id'],
      },
    ],
  });

  return AccountLedger;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CashTransfer = sequelize.define('CashTransfer', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    from_account_id: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    from_account_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    to_account_id: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    to_account_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'cash_transfers',
    timestamps: true,
    underscored: true
  });

  return CashTransfer;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CashierShift = sequelize.define('CashierShift', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cashier_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    cashier_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    start_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    end_time: {
      type: DataTypes.DATE,
      allowNull: true
    },
    opening_balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    closing_balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    total_receipts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    status: {
      type: DataTypes.ENUM('open', 'closed'),
      allowNull: false,
      defaultValue: 'open'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    expected_cash: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    cash_variance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    cash_transferred: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00
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
    tableName: 'cashier_shifts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return CashierShift;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PurchaseOrder = sequelize.define('PurchaseOrder', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    po_number: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    order_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    total_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('draft', 'check', 'approved', 'authorized', 'received', 'cancelled'),
      defaultValue: 'draft'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    check_signature: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    },
    check_signed_by: {
      type: DataTypes.STRING,
      allowNull: true
    },
    check_signed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    approved_signature: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    },
    approved_signed_by: {
      type: DataTypes.STRING,
      allowNull: true
    },
    approved_signed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    authorized_signature: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    },
    authorized_signed_by: {
      type: DataTypes.STRING,
      allowNull: true
    },
    authorized_signed_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'purchase_orders',
    timestamps: true,
    underscored: true
  });

  return PurchaseOrder;
};

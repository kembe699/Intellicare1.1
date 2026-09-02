const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PurchaseOrderItem = sequelize.define('PurchaseOrderItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    purchase_order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'purchase_orders',
        key: 'id'
      }
    },
    item_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    unit_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    total_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    unit_of_measure: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'Each'
    }
  }, {
    tableName: 'purchase_order_items',
    timestamps: true,
    underscored: true
  });

  return PurchaseOrderItem;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DrugInventory = sequelize.define('DrugInventory', {
    id: {
      type: DataTypes.STRING(36),
      primaryKey: true
    },
    drug_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    generic_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: null
    },
    unit_of_measure: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'Tablets'
    },
    quantity_received: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    current_stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    batch_number: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    reorder_level: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    date_received: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    received_by: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    unit_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    selling_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0.00
    }
  }, {
    tableName: 'drug_inventory',
    timestamps: true,
    underscored: true
  });

  return DrugInventory;
};

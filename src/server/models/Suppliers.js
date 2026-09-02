const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Suppliers = sequelize.define('Suppliers', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    supplier_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    supplier_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
    },
    contact_person: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    tax_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    payment_terms: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    opening_balance: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'KES',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'chart_of_accounts',
        key: 'id',
      },
    },
  }, {
    tableName: 'accounting_suppliers',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'supplier_code'],
      },
      {
        fields: ['supplier_name'],
      },
      {
        fields: ['is_active'],
      },
    ],
  });

  return Suppliers;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Service = sequelize.define('Service', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    service_name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 255]
      }
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 100]
      }
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0.00,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    revenue_account_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    department_id: {
      type: DataTypes.STRING,
      allowNull: true,
    }
  }, {
    tableName: 'services',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['category']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['service_name'],
        unique: true
      }
    ]
  });

  return Service;
};

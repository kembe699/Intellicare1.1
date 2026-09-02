const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DrClinic = sequelize.define('DrClinic', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 255]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    department: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 100]
      }
    },
    service: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment: 'Service ID associated with this clinic'
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
    }
  }, {
    tableName: 'dr_clinics',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['department']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['name'],
        unique: true
      }
    ]
  });

  return DrClinic;
};

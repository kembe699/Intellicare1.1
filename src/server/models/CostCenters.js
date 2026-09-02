const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CostCenters = sequelize.define('CostCenters', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    cost_center_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    cost_center_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    responsible_person_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    budget_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    budget_period: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  }, {
    tableName: 'cost_centers',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id'],
      },
      {
        fields: ['cost_center_code'],
        unique: true,
      },
      {
        fields: ['is_active'],
      },
    ],
  });

  return CostCenters;
};

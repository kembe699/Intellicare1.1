const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExchangeRate = sequelize.define('ExchangeRate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    from_currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
    },
    to_currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
    },
    rate: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
    },
    effective_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'manual',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    tableName: 'exchange_rates',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: 'idx_er_clinic_curr_date',
        fields: ['clinic_id', 'from_currency', 'to_currency', 'effective_date'],
      },
      {
        name: 'idx_er_currencies',
        fields: ['from_currency', 'to_currency'],
      },
      {
        name: 'idx_er_eff_date',
        fields: ['effective_date'],
      },
      {
        name: 'idx_er_active',
        fields: ['is_active'],
      },
    ],
  });

  return ExchangeRate;
};

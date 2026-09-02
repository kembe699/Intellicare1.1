const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Facility = sequelize.define('Facility', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Hospital'
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true
    },
    postal_code: {
      type: DataTypes.STRING,
      allowNull: true
    },
    country: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'South Sudan'
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false
    },
    fax: {
      type: DataTypes.STRING,
      allowNull: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    website: {
      type: DataTypes.STRING,
      allowNull: true
    },
    license_number: {
      type: DataTypes.STRING,
      allowNull: true
    },
    established_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    bed_capacity: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'facilities',
    timestamps: true,
    underscored: true
  });

  return Facility;
};

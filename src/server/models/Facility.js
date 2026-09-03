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
    // The facility's own logo, held as a data URI rather than a file path.
    //
    // Documents are printed from a separate window that carries no auth, so a
    // URL pointing at a protected endpoint would silently fail to load there.
    // An inline data URI always renders, and it is the same approach already
    // used for user signatures. The image is downscaled in the browser before
    // upload, so the stored string stays small.
    logo: {
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

const { DataTypes } = require('sequelize');

// The platform owner's own login — separate from every tenant's `users` table.
// A platform admin JWT carries no dbName/tenant context at all (see
// routes/platform/auth.js), so it can never accidentally reach tenant data.
module.exports = (sequelize) => {
  const PlatformAdmin = sequelize.define('PlatformAdmin', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password_hash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  }, {
    tableName: 'platform_admins',
    timestamps: true,
    underscored: true,
  });

  return PlatformAdmin;
};

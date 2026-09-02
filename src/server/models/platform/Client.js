const { DataTypes } = require('sequelize');

// One row per hospital/client instance. `code` is admin-typed at creation (not
// auto-generated) — it's what a user types on the normal login page to select
// which instance they're logging into. `schema_name` is the PostgreSQL schema
// that instance's data lives in (see tenantDb.js for how it's connected to).
module.exports = (sequelize) => {
  const Client = sequelize.define('Client', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    // A tenant is a PostgreSQL schema inside the one shared database — not a
    // separate database. Creating a schema needs no special privilege, which is
    // what lets new clients be provisioned on managed Postgres (Render, Neon,
    // Supabase), where the app's role cannot CREATE DATABASE.
    schema_name: {
      type: DataTypes.STRING(63),
      allowNull: false,
      unique: true,
    },
    admin_email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'suspended'),
      allowNull: false,
      defaultValue: 'active',
    },
    suspended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'clients',
    timestamps: true,
    underscored: true,
  });

  return Client;
};

const { DataTypes } = require('sequelize');

// One row per hospital/client instance. `code` is admin-typed at creation (not
// auto-generated) — it's what a user types on the normal login page to select
// which instance they're logging into. `db_name` is the real MySQL database
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
    db_name: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    // On hosts where every database has its own dedicated MySQL user with no
    // cross-database grant available (e.g. Hostinger shared hosting), the
    // app's main DB_USER can't reach a tenant's database at all — so each
    // tenant's own credentials (from the dedicated user created alongside
    // its database) are stored here and used instead. Left null on hosts
    // where one shared user already has access to everything (local dev,
    // a VPS), in which case the connection layer falls back to DB_USER/
    // DB_PASSWORD exactly as before — see tenantDb.js.
    db_user: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    db_password: {
      type: DataTypes.STRING(255),
      allowNull: true,
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

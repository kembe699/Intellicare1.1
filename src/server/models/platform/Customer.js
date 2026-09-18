const { DataTypes } = require('sequelize');

// A prospective client — registered before any tenant instance exists, so a
// quotation can be built and sent without first committing to provisioning
// a Postgres schema (see clients.js: creating a Client today synchronously
// runs provisionTenant.js, which is the wrong shape for "just register the
// lead"). `client_id` is left open for later, if this prospect converts into
// a real provisioned Client — nothing in this feature sets it automatically.
module.exports = (sequelize) => {
  const Customer = sequelize.define('Customer', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    contact_person: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('prospect', 'converted'),
      allowNull: false,
      defaultValue: 'prospect',
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'customers',
    timestamps: true,
    underscored: true,
  });

  return Customer;
};

const { DataTypes } = require('sequelize');

// Platform-admin-managed subscription plans (name, amount, billing period).
// v1 is admin-managed billing only — no payment gateway, so this is just a
// catalog the admin picks from when creating an invoice for a client.
module.exports = (sequelize) => {
  const SubscriptionPlan = sequelize.define('SubscriptionPlan', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    billing_period: {
      type: DataTypes.ENUM('monthly', 'quarterly', 'annual'),
      allowNull: false,
      defaultValue: 'monthly',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'subscription_plans',
    timestamps: true,
    underscored: true,
  });

  return SubscriptionPlan;
};

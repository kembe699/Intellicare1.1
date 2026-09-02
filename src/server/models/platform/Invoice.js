const { DataTypes } = require('sequelize');

// A billing record the platform admin creates and marks paid manually (v1 has
// no payment gateway). plan_name/amount/billing_period are snapshotted from
// the SubscriptionPlan at creation time — same pattern as PatientBill snapshots
// patient_name alongside patient_id — so editing/removing a plan later never
// changes the meaning of a historical invoice.
module.exports = (sequelize) => {
  const Invoice = sequelize.define('Invoice', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    plan_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    plan_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    billing_period: {
      type: DataTypes.ENUM('monthly', 'quarterly', 'annual'),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    period_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    period_end: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'paid', 'overdue'),
      allowNull: false,
      defaultValue: 'pending',
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    marked_paid_by_admin_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    marked_paid_by_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }, {
    tableName: 'invoices',
    timestamps: true,
    underscored: true,
  });

  return Invoice;
};

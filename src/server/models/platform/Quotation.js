const { DataTypes } = require('sequelize');

// A priced sales quotation for a Customer, generated before that customer
// has (or ever gets) a provisioned tenant instance. Pricing is deliberately
// a single bundled total rather than per-feature line items — the printed
// document lists the full standard feature set as an included checklist
// (see src/data/quotationFeatures.ts), matching how these quotes are
// actually written today (see quotationTemplate.ts).
module.exports = (sequelize) => {
  const Quotation = sequelize.define('Quotation', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    quote_number: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    issue_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    valid_until: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'USD',
    },
    total_amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    deployment_model: {
      type: DataTypes.ENUM('cloud', 'on_premise'),
      allowNull: false,
      defaultValue: 'cloud',
    },
    concurrent_users: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    training_hours: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 20,
    },
    scope_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('draft', 'sent', 'accepted', 'expired'),
      allowNull: false,
      defaultValue: 'draft',
    },
    created_by_admin_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'quotations',
    timestamps: true,
    underscored: true,
  });

  return Quotation;
};

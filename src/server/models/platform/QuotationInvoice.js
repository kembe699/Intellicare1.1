const { DataTypes } = require('sequelize');

// A one-off sales invoice generated from an accepted Quotation — distinct
// from the existing Invoice model, which is recurring subscription billing
// against an already-provisioned Client. A quotation's customer may not
// have (or ever get) a Client/tenant, so this can't reuse that table or its
// client_id/plan_id shape.
//
// total_amount/currency are snapshotted from the quotation at conversion
// time — same reasoning as Invoice snapshotting plan_name/amount — so a
// later edit to the source quotation (only possible while it's still a
// draft, long before conversion, but still) never changes the meaning of
// an invoice already issued.
//
// status is derived from amount_paid vs. total_amount rather than set
// directly, so "partially paid, here's how much and what's left" can never
// drift out of sync with a manually-toggled status flag.
module.exports = (sequelize) => {
  const QuotationInvoice = sequelize.define('QuotationInvoice', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    quotation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // one invoice per quotation
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    invoice_number: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    issue_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    total_amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    amount_paid: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('unpaid', 'partial', 'paid'),
      allowNull: false,
      defaultValue: 'unpaid',
    },
    created_by_admin_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'quotation_invoices',
    timestamps: true,
    underscored: true,
  });

  return QuotationInvoice;
};

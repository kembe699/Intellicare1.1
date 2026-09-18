const { DataTypes } = require('sequelize');

// One row per payment recorded against a QuotationInvoice — what
// QuotationInvoice.amount_paid is a running total OF. Needed separately
// (rather than just the running total) so a single invoice detail page can
// show an actual payment history: which payment, how much, when, recorded
// by whom — not just the current balance.
//
// recorded_by_name is snapshotted at the moment of payment (same pattern as
// Invoice.marked_paid_by_name) so the history reads correctly even if that
// admin's account is later renamed or removed.
module.exports = (sequelize) => {
  const QuotationInvoicePayment = sequelize.define('QuotationInvoicePayment', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    invoice_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    recorded_by_admin_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recorded_by_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'quotation_invoice_payments',
    timestamps: true,
    underscored: true,
  });

  return QuotationInvoicePayment;
};

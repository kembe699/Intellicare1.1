const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExpenseInvoices = sequelize.define('ExpenseInvoices', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'accounting_suppliers',
        key: 'id',
      },
    },
    invoice_number: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    invoice_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    received_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    gross_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    amount_paid: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    amount_due: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('received', 'verified', 'approved', 'partial_paid', 'paid', 'cancelled'),
      defaultValue: 'received',
    },
    expense_category: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    reference_po: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    verified_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    verified_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    approved_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    approved_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    gl_entry_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'general_ledger',
        key: 'id',
      },
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    tableName: 'expense_invoices',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'status'],
      },
      {
        fields: ['due_date'],
      },
      {
        fields: ['supplier_id'],
      },
      {
        fields: ['invoice_number'],
      },
    ],
  });

  return ExpenseInvoices;
};

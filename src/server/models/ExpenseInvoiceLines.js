const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExpenseInvoiceLines = sequelize.define('ExpenseInvoiceLines', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    expense_invoice_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'expense_invoices',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    account_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'chart_of_accounts',
        key: 'id',
      },
    },
    item_description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    unit_price: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    line_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    tax_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    cost_center_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Guaranteed by the branch-isolation migration (ensureBranchIsolationColumns.js) —
    // declared here so create() actually writes it instead of silently dropping it
    // (Sequelize ignores any key passed to create() that isn't a declared attribute).
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'expense_invoice_lines',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['expense_invoice_id'],
      },
      {
        fields: ['account_id'],
      },
    ],
  });

  return ExpenseInvoiceLines;
};

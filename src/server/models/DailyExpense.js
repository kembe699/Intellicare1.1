const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DailyExpense = sequelize.define('DailyExpense', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    expense_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    account_id: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    account_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_by: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // These columns are guaranteed by the boot migration in
    // routes/daily-expenses.js (ensureColumn). They were missing from the model,
    // so create() could never write them — a new expense had to fall back to
    // whatever default the column happened to carry, which on older tables is
    // 'paid'. Declaring them lets creation set the status explicitly instead.
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'pending_approval'
    },
    payment_method: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'cash'
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    voucher_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    // Guaranteed by the branch-isolation migration (ensureBranchIsolationColumns.js),
    // same as clinic_id/status/payment_method above — declared here so create()
    // actually writes it instead of silently dropping it (Sequelize ignores any
    // key passed to create() that isn't a declared attribute).
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'daily_expenses',
    timestamps: true,
    underscored: true
  });

  return DailyExpense;
};

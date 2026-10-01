const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CashierShift = sequelize.define('CashierShift', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // Found while setting up U6's CI pipeline: this declared UUID with a
    // references clause to users.id, but users.id (and the real
    // cashier_shifts.cashier_id column) are both plain INTEGER — Postgres
    // can't create a UUID column with a foreign key to an INTEGER one, so
    // this single mismatched definition made sequelize.sync() throw and
    // silently abort EVERY model's sync in the same call (caught by
    // runSchemaBootstrap's blanket try/catch as "Model sync skipped"),
    // taking every other table's freshly-created schema down with it on a
    // brand new database. Invisible on any existing database, since sync()
    // never alters a table that already exists (alter: false) — only
    // exposed when bootstrapping one from nothing. No FK constraint exists
    // on the real column today, so none is declared here either, rather
    // than adding one a fresh install would enforce but existing ones don't.
    cashier_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    cashier_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    start_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    end_time: {
      type: DataTypes.DATE,
      allowNull: true
    },
    opening_balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    closing_balance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    total_receipts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    total_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    status: {
      type: DataTypes.ENUM('open', 'closed'),
      allowNull: false,
      defaultValue: 'open'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    expected_cash: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    cash_variance: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    cash_transferred: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0.00
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    // Guaranteed by the branch-isolation migration (ensureBranchIsolationColumns.js).
    // Declared here so create() actually writes it — Sequelize silently drops any
    // key passed to create() that isn't a declared model attribute.
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'cashier_shifts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return CashierShift;
};

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const JournalEntryLines = sequelize.define('JournalEntryLines', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    je_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'journal_entries',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    account_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'chart_of_accounts',
        key: 'id',
      },
    },
    debit_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    credit_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    base_debit_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    base_credit_amount: {
      type: DataTypes.DECIMAL(15, 2),
      defaultValue: 0,
    },
    description: {
      type: DataTypes.TEXT,
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
    tableName: 'journal_entry_lines',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['je_id', 'account_id'],
      },
      {
        fields: ['account_id'],
      },
    ],
  });

  return JournalEntryLines;
};

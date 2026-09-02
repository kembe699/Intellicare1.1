const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const JournalEntries = sequelize.define('JournalEntries', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    je_number: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    entry_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    narration: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reference: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    transaction_currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'SSP',
    },
    base_currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'SSP',
    },
    exchange_rate: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
      defaultValue: 1.000000,
    },
    total_debit: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    total_credit: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
    },
    base_total_debit: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0,
    },
    base_total_credit: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('draft', 'submitted', 'approved', 'posted', 'rejected'),
      defaultValue: 'draft',
    },
    created_by: {
      type: DataTypes.STRING(36),
      allowNull: false,
    },
    approved_by: {
      type: DataTypes.STRING(36),
      allowNull: true,
    },
    approved_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    posted_by: {
      type: DataTypes.STRING(36),
      allowNull: true,
    },
    posted_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'journal_entries',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['clinic_id', 'entry_date', 'status'],
      },
      {
        fields: ['je_number'],
        unique: true,
      },
      {
        fields: ['status'],
      },
      {
        fields: ['created_by'],
      },
    ],
  });

  return JournalEntries;
};

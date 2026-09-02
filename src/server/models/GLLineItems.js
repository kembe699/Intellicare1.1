const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const GLLineItems = sequelize.define('GLLineItems', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    gl_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'general_ledger',
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
    line_description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cost_center_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    department_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    tableName: 'gl_line_items',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['gl_id', 'account_id'],
      },
      {
        fields: ['account_id'],
      },
    ],
  });

  return GLLineItems;
};

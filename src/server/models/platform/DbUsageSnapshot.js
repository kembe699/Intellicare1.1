const { DataTypes } = require('sequelize');

// A periodic measurement of one client's actual tenant database size, taken
// from information_schema (see services/tenantUsage.js) — not an estimate.
// Rows accumulate over time so the client detail page can chart real growth,
// not just a single current-size snapshot.
module.exports = (sequelize) => {
  const DbUsageSnapshot = sequelize.define('DbUsageSnapshot', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    size_bytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    table_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    recorded_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'db_usage_snapshots',
    timestamps: false,
    indexes: [{ fields: ['client_id', 'recorded_at'] }],
  });

  return DbUsageSnapshot;
};

const { DataTypes } = require('sequelize');

// Singleton settings row (id=1), same pattern as CompanyProfile.js — controls
// how src/server/routes/publicBookDemo.js generates free slots and how long
// in advance the public page lets someone book.
module.exports = (sequelize) => {
  const DemoBookingSettings = sequelize.define('DemoBookingSettings', {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    duration_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    working_days: { type: DataTypes.JSONB, allowNull: false, defaultValue: [1, 2, 3, 4, 5] }, // 0=Sun..6=Sat
    work_start_time: { type: DataTypes.STRING, allowNull: false, defaultValue: '09:00' },
    work_end_time: { type: DataTypes.STRING, allowNull: false, defaultValue: '17:00' },
    buffer_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    min_notice_hours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 12 },
    max_advance_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    timezone: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Africa/Juba' },
  }, { tableName: 'demo_booking_settings', timestamps: true, underscored: true });
  return DemoBookingSettings;
};

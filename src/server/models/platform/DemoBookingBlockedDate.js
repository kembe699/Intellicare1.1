const { DataTypes } = require('sequelize');

// Admin-picked dates (holidays/closures) that close the whole day to booking,
// regardless of working_days/working_hours in DemoBookingSettings.
module.exports = (sequelize) => {
  const DemoBookingBlockedDate = sequelize.define('DemoBookingBlockedDate', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    blocked_date: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
    reason: { type: DataTypes.STRING, allowNull: true },
  }, { tableName: 'demo_booking_blocked_dates', timestamps: true, underscored: true });
  return DemoBookingBlockedDate;
};

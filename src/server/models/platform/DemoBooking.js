const { DataTypes } = require('sequelize');

// A visitor's booked demo slot, taken from the public /book-demo page.
// end_time is computed and frozen at booking time from the duration setting
// as of that moment — a later admin change to the duration must not
// retroactively change what an already-booked slot says.
//
// Double-booking is prevented at the database level by a partial unique
// index on (booking_date, start_time) WHERE status != 'cancelled' — see
// initializePlatformDatabase() in models/platform/index.js. That's a raw
// SQL index (Sequelize's column-level `unique` can't express the partial
// WHERE), so a cancelled booking's old slot doesn't block a new booking for
// that same slot.
module.exports = (sequelize) => {
  const DemoBooking = sequelize.define('DemoBooking', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    booking_date: { type: DataTypes.DATEONLY, allowNull: false },
    start_time: { type: DataTypes.STRING, allowNull: false }, // 'HH:mm', Africa/Juba wall-clock
    end_time: { type: DataTypes.STRING, allowNull: false },
    full_name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: false },
    job_title: { type: DataTypes.STRING, allowNull: true },
    facility_name: { type: DataTypes.STRING, allowNull: false },
    facility_type: {
      type: DataTypes.ENUM('Hospital', 'Clinic', 'Medical Centre', 'Pharmacy', 'Laboratory', 'Other'),
      allowNull: false,
    },
    location_city: { type: DataTypes.STRING, allowNull: false },
    staff_or_beds_range: { type: DataTypes.STRING, allowNull: true },
    demo_type: { type: DataTypes.ENUM('In person', 'Online'), allowNull: false },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM('confirmed', 'completed', 'cancelled', 'no_show'),
      allowNull: false,
      defaultValue: 'confirmed',
    },
    internal_notes: { type: DataTypes.TEXT, allowNull: true },
  }, { tableName: 'demo_bookings', timestamps: true, underscored: true });
  return DemoBooking;
};

// .ics generation shared by the confirmation email's "Add to calendar" link
// (utils/emailService.js). Mirrors the client-side builder in
// pages/public/BookDemo.tsx (used for the success screen's own download
// button) — Africa/Juba is a fixed UTC+2 offset with no DST, so plain
// arithmetic is exact without a timezone library on either side.
function toUtcStamp(dateStr, hhmm) {
  const [y, mo, day] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const ms = Date.UTC(y, mo - 1, day, h, mi) - 2 * 60 * 60000;
  return new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildDemoBookingIcs({ bookingDate, startTime, endTime, facilityName, demoType }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IntelliCare//Book a Demo//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${bookingDate}-${startTime}-${Math.random().toString(36).slice(2)}@intellicare`,
    `DTSTAMP:${toUtcStamp(bookingDate, startTime)}`,
    `DTSTART:${toUtcStamp(bookingDate, startTime)}`,
    `DTEND:${toUtcStamp(bookingDate, endTime)}`,
    `SUMMARY:IntelliCare Demo — ${facilityName}`,
    `DESCRIPTION:${demoType} demo of IntelliCare HMIS for ${facilityName}.`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

// A direct "Add to Google Calendar" link — navigates straight into Google
// Calendar's own prefilled event screen, no file download involved. This is
// the primary action in the confirmation email; the .ics (above) is kept as
// a quiet attachment alongside it for Outlook/Apple Mail users, since those
// clients recognize a text/calendar attachment on their own.
function buildGoogleCalendarUrl({ bookingDate, startTime, endTime, facilityName, demoType }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `IntelliCare Demo — ${facilityName}`,
    dates: `${toUtcStamp(bookingDate, startTime)}/${toUtcStamp(bookingDate, endTime)}`,
    details: `${demoType} demo of IntelliCare HMIS for ${facilityName}.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { buildDemoBookingIcs, buildGoogleCalendarUrl };

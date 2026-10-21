// Shared "what time window does the dashboard's Today/This Week/This Month/
// custom-range filter mean" resolver — used by every dashboard-facing
// endpoint that has some notion of "activity in a period" (new
// registrations, visits, completed lab tests, dispensing) so they all agree
// with each other and with the receipts endpoint's existing period logic
// (routes/receipts.js's /clinic/:clinicId/stats), rather than each one
// reinventing its own today/tomorrow math.
//
// Deliberately NOT used for "current state" numbers that have no period of
// their own — the patient queue right now, lab specimens awaiting action
// right now, low-stock items right now, money currently owed. Filtering
// those by a date range would answer a different, misleading question
// ("what was in the queue last Tuesday?") instead of the one the dashboard
// is actually asking ("what does the queue look like right now?").
function resolveDashboardDateRange(query = {}) {
  const { period = 'today', startDate, endDate } = query;
  const now = new Date();

  if (startDate && endDate) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    end.setDate(end.getDate() + 1); // inclusive of the end date
    return { start, end, label: `${startDate} to ${endDate}` };
  }

  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  switch (period) {
    case 'week':
      return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: endOfToday, label: 'This Week' };
    case 'month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfToday, label: 'This Month' };
    case 'today':
    default:
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: endOfToday, label: 'Today' };
  }
}

module.exports = { resolveDashboardDateRange };

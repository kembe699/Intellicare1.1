/**
 * Turns an analytics-function result into the chatbot's reply. Every number
 * that appears in the text below is read directly off the `data` object the
 * caller passes in — nothing here invents or estimates a figure, per the
 * spec's "responses must never contain numbers that did not come from the
 * database" requirement.
 */

const PERIOD_PHRASES = {
  Today: 'today',
  Yesterday: 'yesterday',
  'This Week': 'this week',
  'Last Week': 'last week',
  'This Month': 'this month',
  'Last Month': 'last month',
  'This Year': 'this year',
};

function periodPhrase(label) {
  if (PERIOD_PHRASES[label]) return PERIOD_PHRASES[label];
  if (label?.startsWith('Last ') && (label.endsWith('Days') || label.endsWith('Months'))) return `in the ${label.toLowerCase()}`;
  if (label?.includes(' to ')) return `between ${label}`;
  return label || 'in this period';
}

function plural(n, word, pluralWord = `${word}s`) {
  return n === 1 ? word : pluralWord;
}

function formatMoney(amount, currencyCode) {
  const n = Number(amount) || 0;
  return `${currencyCode || ''} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function registrations({ count }, label) {
  const phrase = periodPhrase(label);
  if (count === 0) return { text: `No patients were registered ${phrase}.` };
  return { text: `A total of ${count} ${plural(count, 'patient')} ${count === 1 ? 'was' : 'were'} registered ${phrase}.` };
}

/** All-time snapshot — deliberately no period phrase, since this isn't scoped to one. */
function totalPatients({ count }) {
  if (count === 0) return { text: 'There are no patients in the system yet.' };
  return { text: `There ${count === 1 ? 'is' : 'are'} ${count} ${plural(count, 'patient')} in the system.` };
}

function visits({ count }, label) {
  const phrase = periodPhrase(label);
  if (count === 0) return { text: `No patient visits were recorded ${phrase}.` };
  return { text: `There ${count === 1 ? 'was' : 'were'} ${count} patient ${plural(count, 'visit')} ${phrase}.` };
}

/** A static roster, not period-scoped — same reasoning as totalPatients above. */
function doctorDirectory(doctors) {
  if (doctors.length === 0) return { text: 'There are no doctors registered in the system yet.' };
  const names = doctors.map((d) => d.display_name);
  if (doctors.length <= 5) {
    return { text: `There ${doctors.length === 1 ? 'is' : 'are'} ${doctors.length} ${plural(doctors.length, 'doctor')} registered: ${names.join(', ')}.` };
  }
  return {
    text: `There are ${doctors.length} doctors registered in the system.`,
    table: { columns: ['Doctor'], rows: doctors.map((d) => [d.display_name]) },
  };
}

/** A current-moment snapshot, not period-scoped — same reasoning as totalPatients above. */
function lowStock({ count }) {
  if (count === 0) return { text: 'No items are currently low on stock.' };
  return { text: `${count} ${plural(count, 'item')} ${count === 1 ? 'is' : 'are'} currently at or below its reorder level. See the Inventory report for details.` };
}

function revenue({ total, count }, label, currencyCode) {
  const phrase = periodPhrase(label);
  if (count === 0) return { text: `No revenue was collected ${phrase}.` };
  return {
    text: `The hospital collected ${formatMoney(total, currencyCode)} ${phrase}, across ${count} ${plural(count, 'payment')}.`,
  };
}

/**
 * Cash-basis, paid-vouchers-only — see analyticsFunctions.js's
 * getExpensesTotal for exactly what this does and doesn't include (the
 * daily_expenses log, not the full GL expense-account view).
 */
function expenses({ total, count }, label, currencyCode) {
  const phrase = periodPhrase(label);
  if (count === 0) return { text: `No expenses were recorded as paid ${phrase}.` };
  return {
    text: `The hospital paid out ${formatMoney(total, currencyCode)} in expenses ${phrase}, across ${count} ${plural(count, 'voucher')}.`,
  };
}

/**
 * revenue minus expenses, both from the same sources getRevenueTotal/
 * getExpensesTotal already use elsewhere in this chatbot — not the full
 * general-ledger income statement (see getExpensesTotal's header comment
 * for why that's a deliberately different, broader number). Disclosed
 * plainly in the reply rather than presented as the official P&L.
 */
function incomeStatement(rev, exp, label, currencyCode) {
  const phrase = periodPhrase(label);
  const net = rev.total - exp.total;
  const verb = net >= 0 ? 'a net gain of' : 'a net shortfall of';
  return {
    text: [
      `For ${phrase}: ${formatMoney(rev.total, currencyCode)} collected, ${formatMoney(exp.total, currencyCode)} paid out in expenses, for ${verb} ${formatMoney(Math.abs(net), currencyCode)}.`,
      "This is a simplified view (money received, tax excluded, minus paid expense vouchers), not the full general ledger income statement. See the Income Statement report under Reports for the complete figures.",
    ].join('\n'),
  };
}

function doctorActivity(rows, label, doctorFilter) {
  const phrase = periodPhrase(label);
  if (doctorFilter) {
    const row = rows[0];
    const n = row?.visits || 0;
    if (n === 0) return { text: `${doctorFilter.display_name} didn't attend to any patients ${phrase}.` };
    return { text: `${doctorFilter.display_name} attended to ${n} ${plural(n, 'patient')} ${phrase}.` };
  }
  if (rows.length === 0) {
    return { text: `No doctor-attributed visits were recorded ${phrase}.` };
  }
  const top = rows[0];
  return {
    text: `${top.displayName} attended to the most patients ${phrase}, with ${top.visits} ${plural(top.visits, 'visit')}.`,
    table: {
      columns: ['Doctor', 'Visits'],
      rows: rows.map((r) => [r.displayName, r.visits]),
    },
  };
}

function summary({ registrations: reg, visits: vis, revenue: rev, topDoctor }, label, currencyCode, canSeeRevenue) {
  const phrase = periodPhrase(label);
  const lines = [
    `Here's the hospital summary for ${phrase}:`,
    `• ${reg.count} patient ${plural(reg.count, 'registration')}`,
    `• ${vis.count} patient ${plural(vis.count, 'visit')}`,
  ];
  if (canSeeRevenue && rev) {
    lines.push(`• ${formatMoney(rev.total, currencyCode)} collected across ${rev.count} ${plural(rev.count, 'payment')}`);
  }
  if (topDoctor) {
    lines.push(`• ${topDoctor.displayName} attended to the most patients, with ${topDoctor.visits} ${plural(topDoctor.visits, 'visit')}`);
  }
  return { text: lines.join('\n') };
}

function compare(metricLabel, a, b, labelA, labelB, currencyCode) {
  const fmt = (v) => (currencyCode ? formatMoney(v, currencyCode) : String(v));
  const phraseA = periodPhrase(labelA);
  const phraseB = periodPhrase(labelB);
  const delta = a - b;
  let trend = 'unchanged from';
  if (b !== 0) {
    const pct = Math.abs((delta / b) * 100).toFixed(1);
    trend = delta > 0 ? `up ${pct}% from` : delta < 0 ? `down ${pct}% from` : 'unchanged from';
  } else if (delta !== 0) {
    trend = delta > 0 ? 'up from' : 'down from';
  }
  return {
    text: `${metricLabel} ${phraseA}: ${fmt(a)}. ${metricLabel} ${phraseB}: ${fmt(b)}. That's ${trend} ${phraseB}.`,
  };
}

const LIMITATION_MESSAGES = {
  doctor_revenue:
    "Revenue per doctor isn't reliably trackable yet. Patient bills aren't linked to the doctor who provided the service. For visit/consultation counts per doctor, ask about doctor activity instead; for a revenue estimate, see the Doctor Performance report under Reports.",
};

function limitation(intentKey) {
  return { text: LIMITATION_MESSAGES[intentKey] || "I can't answer that reliably yet with the data available." };
}

/**
 * Billed-revenue-by-category — see analyticsFunctions.js's getDepartmentBreakdown
 * for why this is BILLED, not collected, and why only exactly-captured
 * categories count. `categorizedBilled`/`totalBilled` are always reported
 * together so the answer is honest about coverage instead of implying the
 * whole period's billing is accounted for.
 */
function departmentBreakdown({ rows, totalBilled, categorizedBilled }, label, currencyCode) {
  const phrase = periodPhrase(label);
  if (totalBilled === 0) {
    return { text: `No billing activity was recorded ${phrase}.` };
  }
  if (rows.length === 0) {
    return {
      text: `None of the bills ${phrase} have category information captured. They predate category tracking. See the Clinic Performance report under Reports for an approximate, name-matched breakdown instead.`,
    };
  }
  const top = rows[0];
  const coveragePct = Math.round((categorizedBilled / totalBilled) * 100);
  const coverageNote = coveragePct >= 99
    ? ''
    : ` (based on the ${coveragePct}% of billing ${phrase} whose lines can be traced to a department)`;
  return {
    text: `${top.category} had the most billed activity ${phrase}, at ${formatMoney(top.amount, currencyCode)}${coverageNote}.`,
    table: {
      columns: ['Department', 'Billed'],
      rows: rows.map((r) => [r.category, formatMoney(r.amount, currencyCode)]),
    },
  };
}

function accessDenied() {
  return { text: "You don't have permission to view financial figures. Contact an administrator if you need access to this." };
}

const SUGGESTED_QUESTIONS = [
  { text: 'How many patients were registered today?', requiresPermission: null },
  { text: 'How many patient visits occurred today?', requiresPermission: null },
  { text: 'Which doctor attended to the most patients today?', requiresPermission: null },
  { text: 'How much revenue was collected today?', requiresPermission: 'accounting.read' },
  { text: "Give me today's hospital summary.", requiresPermission: null },
  { text: 'What can you do?', requiresPermission: null },
];

function clarifying() {
  return {
    text: "I'm not sure I understood that question. Here are some things you can ask me, or ask \"what can you do?\" for the full list.",
    suggestions: SUGGESTED_QUESTIONS.map((s) => s.text),
  };
}

/**
 * Answers "what date range was that?" straight from the prior turn's stored
 * params — never re-derives or guesses a range, since the whole point is to
 * report back exactly what was actually used to answer the previous
 * question. `end` is stored exclusive (the day after the range, so a
 * `< end` SQL comparison is correct) — shown here as the last INCLUDED day,
 * which is what a person actually means by "date range".
 */
function dateRangeQuery(priorParams) {
  if (!priorParams?.start) {
    return { text: "I haven't answered anything yet in this conversation. Ask me something first, and I can tell you what date range it covered." };
  }
  const start = new Date(priorParams.start);
  const lastIncluded = new Date(new Date(priorParams.end).getTime() - 1);
  // dateParser.js builds these as LOCAL-midnight Date objects (server-local
  // time, same convention as every other "today" in this app — see its own
  // header comment). `.toISOString()` converts to UTC first, which silently
  // shifts the displayed calendar date back a day on a server running
  // east of UTC (confirmed live: this server is Africa/Cairo, UTC+3) — so
  // format off the LOCAL getters instead, never toISOString(), to show the
  // actual calendar date the range was resolved against.
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { text: `That was for ${priorParams.label}: ${fmt(start)} to ${fmt(lastIncluded)}.` };
}

function help() {
  return {
    text: [
      "Here's what I can help with. Ask in your own words, no exact phrasing needed:",
      '• Patient registrations: "how many patients registered this week?"',
      '• Total patients in the system: "how many patients do we have in total?"',
      '• Patient visits: "how many visits today?"',
      '• Revenue collected: "how much revenue this month?" (requires financial access)',
      '• Expenses paid: "how much did we spend this month?" (requires financial access)',
      '• Income statement (revenue minus expenses): "show me the income statement for this month" (requires financial access)',
      '• Doctor activity: "which doctor saw the most patients?", or ask about one by name',
      '• Doctor directory: "list all doctors registered in the system"',
      '• Revenue by department/category: "which department made the most today?"',
      '• Low stock alerts: "are any items low on stock?"',
      '• A full hospital summary: "give me today\'s summary"',
      '• Comparisons: "compare today\'s revenue with yesterday\'s"',
      '• Date ranges: today, yesterday, this/last week, this/last month, this year, "last 14 days", "last 5 months", or "between 2026-10-01 and 2026-10-15"',
      '• Follow-ups: ask something, then just say "what about yesterday?" or "what date range was that?"',
    ].join('\n'),
  };
}

module.exports = {
  registrations,
  totalPatients,
  doctorDirectory,
  lowStock,
  visits,
  revenue,
  expenses,
  incomeStatement,
  doctorActivity,
  departmentBreakdown,
  dateRangeQuery,
  help,
  summary,
  compare,
  limitation,
  accessDenied,
  clarifying,
  periodPhrase,
  formatMoney,
  SUGGESTED_QUESTIONS,
};

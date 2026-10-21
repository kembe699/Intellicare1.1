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
  if (label?.startsWith('Last ') && label.endsWith('Days')) return `in the ${label.toLowerCase()}`;
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

function visits({ count }, label) {
  const phrase = periodPhrase(label);
  if (count === 0) return { text: `No patient visits were recorded ${phrase}.` };
  return { text: `There ${count === 1 ? 'was' : 'were'} ${count} patient ${plural(count, 'visit')} ${phrase}.` };
}

function revenue({ total, count }, label, currencyCode) {
  const phrase = periodPhrase(label);
  if (count === 0) return { text: `No revenue was collected ${phrase}.` };
  return {
    text: `The hospital collected ${formatMoney(total, currencyCode)} ${phrase}, across ${count} ${plural(count, 'receipt')}.`,
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
    lines.push(`• ${formatMoney(rev.total, currencyCode)} collected across ${rev.count} ${plural(rev.count, 'receipt')}`);
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
    "Revenue per doctor isn't reliably trackable yet — patient bills aren't linked to the doctor who provided the service. For visit/consultation counts per doctor, ask about doctor activity instead; for a revenue estimate, see the Doctor Performance report under Reports.",
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
      text: `None of the bills ${phrase} have category information captured — they predate category tracking. See the Clinic Performance report under Reports for an approximate, name-matched breakdown instead.`,
    };
  }
  const top = rows[0];
  const coveragePct = Math.round((categorizedBilled / totalBilled) * 100);
  const coverageNote = coveragePct >= 99
    ? ''
    : ` (based on the ${coveragePct}% of billing ${phrase} that has a category captured — the rest predates category tracking)`;
  return {
    text: `${top.category} had the most billed activity ${phrase}, at ${formatMoney(top.amount, currencyCode)}${coverageNote}.`,
    table: {
      columns: ['Category', 'Billed'],
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
];

function clarifying() {
  return {
    text: "I'm not sure I understood that question. Here are some things you can ask me:",
    suggestions: SUGGESTED_QUESTIONS.map((s) => s.text),
  };
}

module.exports = {
  registrations,
  visits,
  revenue,
  doctorActivity,
  departmentBreakdown,
  summary,
  compare,
  limitation,
  accessDenied,
  clarifying,
  periodPhrase,
  formatMoney,
  SUGGESTED_QUESTIONS,
};

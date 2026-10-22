// ─── Report Utilities ────────────────────────────────────────────────────────

/** Parse MySQL "YYYY-MM-DD HH:MM:SS" or ISO strings safely */
export function parseDate(val?: string | null): Date | null {
  if (!val) return null;
  const d = new Date(String(val).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** Format a date value as locale date string */
export function fmtDate(val?: string | null): string {
  const d = parseDate(val);
  return d ? d.toLocaleDateString() : '—';
}

// The dozens of fmtCurrency(val) call sites across the Reports pages never
// pass a currency — they all relied on a hardcoded 'SSP' default, which
// showed the wrong currency code for any tenant whose base currency isn't
// SSP (confirmed live: lab-request pricing and report totals both showed
// "SSP" for a USD-based tenant). Touching every one of those call sites
// individually would be a huge, risky diff for what's really one root
// cause — instead, CurrencyContext.tsx sets this module-level value the
// moment it resolves the tenant's real base currency (see
// setCurrentBaseCurrencyCode below), and fmtCurrency's default parameter —
// evaluated fresh on every call, not memoized — picks up the current
// value automatically. Starts as '' (not 'SSP') to match
// CurrencyContext's own default: an unloaded currency should show as
// blank, not confidently wrong.
let currentBaseCurrencyCode = '';
export function setCurrentBaseCurrencyCode(code: string) {
  if (code) currentBaseCurrencyCode = code;
}

/** Format a number as currency — defaults to the tenant's real base currency. */
export function fmtCurrency(val?: number | string | null, currency = currentBaseCurrencyCode): string {
  const n = parseFloat(String(val ?? 0)) || 0;
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

/** Format a plain number */
export function fmtNum(val?: number | string | null, dp = 2): string {
  const n = parseFloat(String(val ?? 0)) || 0;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
}

/** Format integer count */
export function fmtCount(val?: number | string | null): string {
  return new Intl.NumberFormat('en-US').format(parseInt(String(val ?? 0)) || 0);
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

export interface CsvColumn {
  header: string;
  key: string;
  transform?: (val: any, row: any) => string;
}

export function exportCSV(rows: any[], columns: CsvColumn[], filename: string): void {
  const header = columns.map(c => `"${c.header}"`).join(',');
  const body = rows.map(row =>
    columns.map(c => {
      const raw = row[c.key];
      const val = c.transform ? c.transform(raw, row) : (raw ?? '');
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [header, ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Print ───────────────────────────────────────────────────────────────────

export function triggerPrint(): void {
  window.print();
}

// ─── Date range presets ──────────────────────────────────────────────────────

export function getDatePresets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const y = now.getFullYear();
  const m = now.getMonth();

  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => d.toISOString().split('T')[0];

  return [
    {
      label: 'Today',
      from: today,
      to: today,
    },
    {
      label: 'Last 7 Days',
      from: iso(new Date(now.getTime() - 6 * 86400000)),
      to: today,
    },
    {
      label: 'Last 30 Days',
      from: iso(new Date(now.getTime() - 29 * 86400000)),
      to: today,
    },
    {
      label: 'This Month',
      from: `${y}-${pad(m + 1)}-01`,
      to: iso(new Date(y, m + 1, 0)),
    },
    {
      label: 'Last Month',
      from: `${y}-${pad(m)}-01`,
      to: iso(new Date(y, m, 0)),
    },
    {
      label: 'This Year',
      from: `${y}-01-01`,
      to: `${y}-12-31`,
    },
  ];
}

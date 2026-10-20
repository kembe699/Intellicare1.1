/**
 * The single source of truth for displaying dates, money, durations and
 * phone numbers — replaces ad-hoc `toLocaleDateString()` / `toFixed(2)` /
 * `toLocaleString()` calls scattered across the app, each of which
 * rendered slightly differently (and some depended on the viewer's device
 * locale, so the same bill could read as "10/20/2026" on one machine and
 * "20/10/2026" on another).
 *
 * Every function here is pinned to a fixed locale (en-GB) so the output is
 * the same regardless of the device, and returns "—" for null/undefined/
 * invalid input instead of throwing or printing "Invalid Date"/"NaN".
 */

const LOCALE = 'en-GB';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "20 Oct 2026" */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "20 Oct 2026, 14:05" (24-hour clock) */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date}, ${time}`;
}

/** "SSP 1,250,000.00" — thousand separators, 2 decimals, currency prefix, minus sign for negatives. */
export function formatMoney(amount: number | string | null | undefined, currency = 'SSP'): string {
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount ?? ''));
  if (amount === null || amount === undefined || amount === '' || Number.isNaN(n)) return '—';
  const formatted = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(n),
  );
  return `${n < 0 ? '-' : ''}${currency} ${formatted}`;
}

/** "3 h 20 min" — from a duration in milliseconds, or "—" when missing/invalid. Omits the hours part under 1h ("20 min"). */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

/**
 * "+211 912 345 678" — groups digits after the country code in 3s. This is
 * a display-only heuristic (country code = digits up to the first 3 after
 * a leading "+", or "211" as the South Sudan default when the number has
 * no "+"), not full E.164 validation/parsing — good enough for showing a
 * number back to a human, not for validating one.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return '—';
  const hasPlus = value.trim().startsWith('+');
  const countryLen = hasPlus ? Math.min(3, digits.length) : Math.min(3, Math.max(0, digits.length - 9));
  const country = digits.slice(0, countryLen);
  const rest = digits.slice(countryLen);
  const groups = rest.match(/.{1,3}/g) ?? [];
  return `+${country}${groups.length ? ' ' + groups.join(' ') : ''}`;
}

/**
 * Shared status → Tailwind badge class utility.
 * Single source of truth for all status colours across the app.
 */

const SUCCESS = 'bg-success-bg text-success';
const WARNING = 'bg-warning-bg text-warning';
const DANGER  = 'bg-destructive-bg text-destructive';
const INFO    = 'bg-info-bg text-info';
const NEUTRAL = 'bg-neutral-bg text-neutral';

const STATUS_MAP: Record<string, string> = {
  // ── Positive / complete → success ───────────────────────────────────────
  posted:     SUCCESS,
  paid:       SUCCESS,
  completed:  SUCCESS,
  balanced:   SUCCESS,
  authorized: SUCCESS,
  active:     SUCCESS,
  open:       SUCCESS,
  success:    SUCCESS,
  sent:       SUCCESS,
  dispensed:  SUCCESS,
  discharged: SUCCESS,
  normal:     SUCCESS,
  available:  SUCCESS,
  received:   SUCCESS,
  occupied:   DANGER,
  inspected:  SUCCESS,
  settled:    SUCCESS,
  applied:    SUCCESS,
  pass:       SUCCESS,
  fail:       DANGER,

  // ── In-progress → info ───────────────────────────────────────────────────
  admitted:   INFO,
  partial:           WARNING,
  processing:        INFO,
  in_progress:       INFO,
  'in-progress':     INFO,
  collected:         INFO,
  submitted:         INFO,
  approved:          INFO,
  accepted:          SUCCESS,
  partially_paid:    WARNING,
  pending_inspection:WARNING,

  // ── Warning / pending ────────────────────────────────────────────────────
  pending:          WARNING,
  pending_approval: WARNING,
  check:            WARNING,
  due:              WARNING,
  overdue:          DANGER,
  low_stock:        WARNING,
  expiring_soon:    WARNING,
  expiring:         WARNING,
  low:              WARNING,
  urgent:           WARNING,
  stat:             WARNING,

  // ── Negative / stopped → danger ─────────────────────────────────────────
  unpaid:     DANGER,
  cancelled:  NEUTRAL,
  rejected:   DANGER,
  failed:     DANGER,
  short:      DANGER,
  expired:    DANGER,
  out_of_stock:DANGER,
  void:       DANGER,
  inactive:   NEUTRAL,
  returned:   DANGER,

  // ── Neutral / draft ──────────────────────────────────────────────────────
  draft:    NEUTRAL,
  unknown:  NEUTRAL,
  'n/a':    NEUTRAL,

  // ── Special — no dedicated tone in the Option B palette; info reads
  //    better than a 6th hue for these two. ───────────────────────────────
  over_stock: INFO,
  credit:     INFO,
};

/**
 * Returns Tailwind classes for a status value.
 * Falls back to neutral for unrecognised statuses.
 */
export function getStatusColor(status: string | null | undefined): string {
  if (!status) return NEUTRAL;
  return STATUS_MAP[status.toLowerCase()] ?? NEUTRAL;
}

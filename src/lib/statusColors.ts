/**
 * Shared status → Tailwind badge class utility.
 * Single source of truth for all status colours across the app.
 */

const STATUS_MAP: Record<string, string> = {
  // ── Positive / complete ──────────────────────────────────────────────────
  posted:     'bg-green-100 text-green-800',
  paid:       'bg-green-100 text-green-800',
  completed:  'bg-green-100 text-green-800',
  authorized: 'bg-emerald-100 text-emerald-800',
  active:     'bg-green-100 text-green-800',
  open:       'bg-green-100 text-green-800',
  success:    'bg-green-100 text-green-800',
  sent:       'bg-green-100 text-green-800',
  dispensed:  'bg-green-100 text-green-800',
  discharged: 'bg-green-100 text-green-800',
  normal:     'bg-green-100 text-green-800',
  available:  'bg-green-100 text-green-800',
  received:   'bg-green-100 text-green-800',
  occupied:   'bg-red-100 text-red-800',
  inspected:  'bg-primary/10 text-primary',
  settled:    'bg-green-100 text-green-800',
  applied:    'bg-green-100 text-green-800',
  pass:       'bg-emerald-100 text-emerald-700',
  fail:       'bg-red-100 text-red-800',

  // ── In-progress / info ───────────────────────────────────────────────────
  admitted:   'bg-primary/10 text-primary',
  partial:           'bg-primary/10 text-primary',
  processing:        'bg-primary/10 text-primary',
  in_progress:       'bg-primary/10 text-primary',
  'in-progress':     'bg-primary/10 text-primary',
  collected:         'bg-primary/10 text-primary',
  submitted:         'bg-primary/10 text-primary',
  approved:          'bg-primary/10 text-primary',
  accepted:          'bg-emerald-100 text-emerald-800',
  partially_paid:    'bg-primary/10 text-primary',
  pending_inspection:'bg-orange-100 text-orange-700',

  // ── Warning / pending ────────────────────────────────────────────────────
  pending:          'bg-amber-100 text-amber-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  check:            'bg-amber-100 text-amber-700',
  overdue:          'bg-amber-100 text-amber-800',
  low_stock:        'bg-amber-100 text-amber-800',
  expiring_soon:    'bg-orange-100 text-orange-700',
  expiring:         'bg-orange-100 text-orange-700',
  low:              'bg-amber-100 text-amber-800',
  urgent:           'bg-orange-100 text-orange-700',
  stat:             'bg-orange-100 text-orange-700',

  // ── Negative / stopped ───────────────────────────────────────────────────
  unpaid:     'bg-red-100 text-red-800',
  cancelled:  'bg-red-100 text-red-800',
  rejected:   'bg-red-100 text-red-800',
  failed:     'bg-red-100 text-red-800',
  expired:    'bg-red-100 text-red-800',
  out_of_stock:'bg-red-100 text-red-800',
  void:       'bg-red-100 text-red-800',
  inactive:   'bg-red-100 text-red-800',
  returned:   'bg-red-100 text-red-800',

  // ── Neutral / draft ──────────────────────────────────────────────────────
  draft:    'bg-gray-100 text-gray-700',
  unknown:  'bg-gray-100 text-gray-700',
  'n/a':    'bg-gray-100 text-gray-700',

  // ── Special ──────────────────────────────────────────────────────────────
  over_stock: 'bg-purple-100 text-purple-800',
  credit:     'bg-purple-100 text-purple-800',
};

/**
 * Returns Tailwind classes for a status value.
 * Falls back to neutral gray for unrecognised statuses.
 */
export function getStatusColor(status: string | null | undefined): string {
  if (!status) return 'bg-gray-100 text-gray-700';
  return STATUS_MAP[status.toLowerCase()] ?? 'bg-gray-100 text-gray-700';
}

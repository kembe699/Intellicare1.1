import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusBadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary' | 'info';

interface StatusBadgeProps {
  /** Raw status/priority value, e.g. "active", "waiting", "urgent". */
  status: string;
  /** Maps a status value to a tone. Falls back to the built-in Option B
   *  mapping (then `neutral`) for values it doesn't cover. */
  map?: Record<string, StatusBadgeTone>;
  /** Overrides the rendered label (defaults to `status`). */
  label?: ReactNode;
  className?: string;
}

/** The Option B status → tone table: every status in the app is one of
 *  five tones. Used as the default when a call site doesn't pass its own
 *  `map` (most of this app's custom statuses — room states, HR statuses,
 *  etc. — still need to pass one; this just means an un-mapped, generic
 *  status reads sensibly instead of defaulting straight to neutral). */
const DEFAULT_MAP: Record<string, StatusBadgeTone> = {
  // success — paid, completed, balanced, active
  paid: 'success', completed: 'success', balanced: 'success', active: 'success',
  // warning — partial, pending, waiting, due
  partial: 'warning', pending: 'warning', waiting: 'warning', due: 'warning',
  // danger — unpaid, overdue, failed, short, rejected
  unpaid: 'danger', overdue: 'danger', failed: 'danger', short: 'danger', rejected: 'danger',
  // info — in progress, processing
  in_progress: 'info', 'in-progress': 'info', processing: 'info',
  // neutral — cancelled, draft, inactive
  cancelled: 'neutral', draft: 'neutral', inactive: 'neutral',
};

/**
 * Renders a status/priority pill — rounded-full, a coloured dot, 13px/600
 * text — using the shared `.ic-badge-*` classes (src/index.css), which are
 * themselves built from the five semantic tokens (success/warning/danger/
 * info/neutral) rather than each call site hand-coding raw Tailwind colors.
 */
export function StatusBadge({ status, map, label, className }: StatusBadgeProps) {
  // A caller-supplied map keeps its original exact-case lookup (unchanged
  // behavior for the 30+ call sites already passing their own map); only
  // the fallback to the built-in table is new, and that one's
  // case-insensitive since it doesn't know each call site's casing.
  const tone: StatusBadgeTone = map
    ? map[status] ?? 'neutral'
    : DEFAULT_MAP[status?.toLowerCase()] ?? 'neutral';
  return (
    <span className={cn('ic-badge', `ic-badge-${tone}`, className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[tone])} aria-hidden="true" />
      {label ?? status}
    </span>
  );
}

const DOT_CLASS: Record<StatusBadgeTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  neutral: 'bg-neutral',
  primary: 'bg-primary',
  info: 'bg-info',
};

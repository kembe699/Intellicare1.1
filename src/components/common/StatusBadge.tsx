import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusBadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary' | 'info';

interface StatusBadgeProps {
  /** Raw status/priority value, e.g. "active", "waiting", "urgent". */
  status: string;
  /** Maps a status value to a tone. Falls back to `neutral` for unmapped values. */
  map: Record<string, StatusBadgeTone>;
  /** Overrides the rendered label (defaults to `status`). */
  label?: ReactNode;
  className?: string;
}

/**
 * Renders a status/priority pill using the shared `.ic-badge-*` classes
 * (src/index.css) instead of each call site hand-coding raw Tailwind color triples.
 */
export function StatusBadge({ status, map, label, className }: StatusBadgeProps) {
  const tone = map[status] ?? 'neutral';
  return (
    <span className={cn('ic-badge', `ic-badge-${tone}`, className)}>
      {label ?? status}
    </span>
  );
}

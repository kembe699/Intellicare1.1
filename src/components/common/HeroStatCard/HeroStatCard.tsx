import React, { useState, type ReactNode } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

export interface HeroStatCardProps {
  label: string;
  value: string;
  stats?: { label: string; value: string }[];
  actions?: ReactNode;
  /**
   * Whether the viewer is allowed to reveal the figure. When false the card
   * stays masked and the toggle reports the refusal through `onDeniedReveal`
   * instead of quietly doing nothing — a dead button reads as a bug, whereas an
   * explicit "access denied" tells the user the restriction is deliberate.
   */
  canReveal?: boolean;
  /** Start masked. Financial headline figures pass false. */
  defaultRevealed?: boolean;
  onDeniedReveal?: () => void;
  /**
   * Controlled mode. Pass both when the same figure is rendered elsewhere on
   * the page and must mask and unmask together — hiding it here while the
   * identical number sits in a chart below achieves nothing.
   */
  revealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
}

/**
 * Prominent gradient stat card for a dashboard's headline number — same shape
 * as the "hero balance" pattern used elsewhere in the product suite, restyled
 * with this app's own teal (see the `hero-gradient` utility in tailwind.config.ts)
 * rather than borrowing another product's brand color.
 *
 * Masking here is a presentation control, not a security boundary: the figure
 * has already been fetched by the time this renders. Anything that must not
 * reach a role at all has to be withheld by the API.
 */
export const HeroStatCard: React.FC<HeroStatCardProps> = ({
  label,
  value,
  stats,
  actions,
  canReveal = true,
  defaultRevealed = true,
  onDeniedReveal,
  revealed: revealedProp,
  onRevealedChange,
}) => {
  const [uncontrolled, setUncontrolled] = useState(defaultRevealed && canReveal);
  const isControlled = revealedProp !== undefined;
  const revealed = isControlled ? revealedProp && canReveal : uncontrolled;

  const toggle = () => {
    if (!canReveal) {
      onDeniedReveal?.();
      return;
    }
    const next = !revealed;
    if (isControlled) onRevealedChange?.(next);
    else setUncontrolled(next);
  };

  const Icon = !canReveal ? Lock : revealed ? Eye : EyeOff;

  return (
    <div className="rounded-2xl bg-hero-gradient p-6 text-white shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white/80">{label}</p>
        <button
          type="button"
          onClick={toggle}
          className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={!canReveal ? 'Restricted value' : revealed ? 'Hide value' : 'Show value'}
          title={!canReveal ? 'Restricted — administrators and accountants only' : undefined}
        >
          <Icon className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 text-3xl font-bold tracking-tight">{revealed ? value : '••••••••'}</p>

      {stats && stats.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-8">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-xs text-white/70">{stat.label}</p>
              <p className="mt-0.5 text-base font-semibold">{revealed ? stat.value : '••••'}</p>
            </div>
          ))}
        </div>
      )}

      {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
};

import React, { useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface HeroStatCardProps {
  label: string;
  value: string;
  stats?: { label: string; value: string }[];
  actions?: ReactNode;
}

/**
 * Prominent gradient stat card for a dashboard's headline number — same shape
 * as the "hero balance" pattern used elsewhere in the product suite, restyled
 * with this app's own teal (see the `hero-gradient` utility in tailwind.config.ts)
 * rather than borrowing another product's brand color.
 */
export const HeroStatCard: React.FC<HeroStatCardProps> = ({ label, value, stats, actions }) => {
  const [revealed, setRevealed] = useState(true);

  return (
    <div className="rounded-2xl bg-hero-gradient p-6 text-white shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white/80">{label}</p>
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label={revealed ? 'Hide value' : 'Show value'}
        >
          {revealed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
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

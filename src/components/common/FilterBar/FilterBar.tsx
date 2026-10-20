import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const FilterBar: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>
);

interface FilterPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export const FilterPill: React.FC<FilterPillProps> = ({ label, active, className, ...props }) => (
  <button
    type="button"
    aria-pressed={!!active}
    className={cn(
      'inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
      active
        ? 'border-primary bg-primary-soft text-primary'
        : 'border-border bg-card text-muted-foreground hover:text-foreground',
      className,
    )}
    {...props}
  >
    {label}
  </button>
);

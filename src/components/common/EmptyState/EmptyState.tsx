import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** A short line explaining what goes here / what to do next. */
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * The one empty-state pattern for the app — a dashed box with a brand-teal
 * icon, a short title, an optional explanatory line, and an optional
 * action button. Replaces ad-hoc "No … found" text scattered across pages.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  message,
  action,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input py-12 px-4 text-center',
        className,
      )}
    >
      {Icon && <Icon className="mb-3 h-7 w-7 text-brand-teal" aria-hidden="true" strokeWidth={1.75} />}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {message && <p className="max-w-xs text-sm text-muted-foreground">{message}</p>}
      {action && (
        <Button onClick={action.onClick} variant="outline" size="sm" className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  );
};

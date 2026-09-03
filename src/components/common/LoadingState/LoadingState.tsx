import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The single loading indicator for the whole app.
 *
 * Loading used to be written by hand at each call site, so the same wait looked
 * different depending on which screen you were on: a spinner at h-96 here, py-12
 * there, py-8 somewhere else, sometimes with a message and sometimes not. Worse,
 * some of them replaced the surrounding chrome entirely, so content jumped
 * position the moment data arrived.
 *
 * `variant` covers the three places a wait actually happens, and nothing else
 * should be invented at a call site:
 *
 *   page    — a whole route is not ready yet. Tall and centred, so it reads as
 *             the page itself loading rather than a piece of it.
 *   section — a panel, card or table body inside a page that is already drawn.
 *             This is the default and the common case.
 *   inline   — next to or inside a control, e.g. a button mid-submit.
 */
export interface LoadingStateProps {
  message?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'page' | 'section' | 'inline';
  /** Fixed height for the container, so content does not jump when data lands. */
  minHeight?: number | string;
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

const variantWrapper = {
  page: 'flex flex-col items-center justify-center min-h-[60vh]',
  section: 'flex flex-col items-center justify-center py-16',
  inline: 'inline-flex items-center gap-2',
};

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
  className,
  size,
  variant = 'section',
  minHeight,
}) => {
  const resolvedSize = size ?? (variant === 'inline' ? 'sm' : variant === 'page' ? 'lg' : 'md');

  if (variant === 'inline') {
    return (
      <span className={cn(variantWrapper.inline, 'text-muted-foreground', className)}>
        <Loader2 className={cn('animate-spin', sizeMap[resolvedSize])} />
        {message && <span className="text-sm">{message}</span>}
      </span>
    );
  }

  return (
    <div
      className={cn(variantWrapper[variant], className)}
      style={minHeight ? { minHeight } : undefined}
      role="status"
      aria-live="polite"
    >
      <Loader2 className={cn('animate-spin text-muted-foreground', sizeMap[resolvedSize])} />
      {message && <p className="text-sm text-muted-foreground mt-4">{message}</p>}
    </div>
  );
};

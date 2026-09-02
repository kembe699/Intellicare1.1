import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  description?: string;
  className?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  message,
  description,
  className,
  action,
}) => (
  <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
    {Icon && (
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-muted-foreground opacity-60" />
      </div>
    )}
    <p className="text-sm font-medium text-foreground">{message}</p>
    {description && (
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

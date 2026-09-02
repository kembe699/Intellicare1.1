import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

export interface QuickAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  color?: string;
  bgColor?: string;
}

export interface QuickActionsProps {
  actions: QuickAction[];
  columns?: 2 | 3 | 4;
  className?: string;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  actions,
  columns = 4,
  className,
}) => {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
  };

  const renderAction = (action: QuickAction) => {
    const Icon = action.icon;
    const content = (
      <>
        <div className={cn(
          'w-12 h-12 rounded-md flex items-center justify-center mb-3 transition-colors',
          action.bgColor || 'bg-primary/10',
          'group-hover:opacity-80'
        )}>
          <Icon className={cn('w-6 h-6', action.color || 'text-primary')} />
        </div>
        <span className="font-medium text-foreground">{action.label}</span>
      </>
    );

    const baseClasses = 'flex flex-col items-center justify-center p-6 bg-card rounded-md border border-border hover:border-primary hover:shadow-md transition-all group';

    if (action.href) {
      return (
        <Link key={action.label} to={action.href} className={baseClasses}>
          {content}
        </Link>
      );
    }

    return (
      <button key={action.label} onClick={action.onClick} className={baseClasses}>
        {content}
      </button>
    );
  };

  return (
    <div className={cn('grid gap-4', gridCols[columns], className)}>
      {actions.map(renderAction)}
    </div>
  );
};

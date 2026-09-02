import React from 'react';
import { Button } from '@/components/ui/button';
import { X, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BulkAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'outline';
}

export interface BulkActionsBarProps {
  selectedCount: number;
  actions: BulkAction[];
  onClearSelection: () => void;
  className?: string;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  actions,
  onClearSelection,
  className,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className={cn('flex items-center justify-between p-3 bg-primary/10 border-b border-border', className)}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">
          {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="h-7"
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.label}
              variant={action.variant || 'outline'}
              size="sm"
              onClick={action.onClick}
              className="h-7"
            >
              <Icon className="h-4 w-4 mr-1" />
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
};

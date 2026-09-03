import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { EmptyState } from '../EmptyState';
import { LoadingState } from '../LoadingState';

export interface ListCardProps<T> {
  title: string;
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  onItemClick?: (item: T, index: number) => void;
  actions?: React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  emptyIcon?: LucideIcon;
  className?: string;
  maxHeight?: string;
}

export function ListCard<T>({
  title,
  items,
  renderItem,
  onItemClick,
  actions,
  loading = false,
  emptyMessage = 'No items found',
  emptyIcon,
  className,
  maxHeight = '400px',
}: ListCardProps<T>) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState size="sm" message="Loading..." />
        ) : items.length === 0 ? (
          <EmptyState
            icon={emptyIcon}
            message={emptyMessage}
            className="py-8"
          />
        ) : (
          <div
            className="space-y-2 overflow-y-auto"
            style={{ maxHeight }}
          >
            {items.map((item, index) => (
              <div
                key={index}
                className={cn(
                  'p-3 rounded-md border border-border transition-colors',
                  onItemClick && 'cursor-pointer hover:bg-muted/50'
                )}
                onClick={() => onItemClick?.(item, index)}
              >
                {renderItem(item, index)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

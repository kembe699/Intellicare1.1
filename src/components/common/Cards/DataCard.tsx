import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DataItem {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export interface DataCardProps {
  title: string;
  data: DataItem[];
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  className?: string;
  columns?: 1 | 2 | 3;
}

export const DataCard: React.FC<DataCardProps> = ({
  title,
  data,
  actions,
  collapsible = false,
  defaultCollapsed = false,
  className,
  columns = 2,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  };

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle
          className={cn(
            'text-lg font-semibold',
            collapsible && 'cursor-pointer select-none'
          )}
          onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-2">
            {title}
            {collapsible && (
              isCollapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )
            )}
          </div>
        </CardTitle>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </CardHeader>
      {!isCollapsed && (
        <CardContent>
          <div className={cn('grid gap-4', gridCols[columns])}>
            {data.map((item, index) => (
              <div key={index} className={cn('space-y-1', item.className)}>
                <p className="text-sm font-medium text-muted-foreground">
                  {item.label}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {item.value || '-'}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
};

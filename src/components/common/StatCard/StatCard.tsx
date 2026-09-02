import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  onClick?: () => void;
  className?: string;
  iconColor?: string;
  iconBgColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  trend,
  onClick,
  className,
  iconColor = 'text-primary',
  iconBgColor = 'bg-primary/10',
}) => {
  const isClickable = !!onClick;

  return (
    <Card
      className={cn(
        'transition-all duration-200',
        isClickable && 'cursor-pointer hover:shadow-md hover:border-primary',
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center', iconBgColor)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {trend && (
          <p className={cn(
            'text-xs mt-1',
            trend.isPositive ? 'text-success' : 'text-destructive'
          )}>
            {trend.isPositive ? '+' : ''}{trend.value}% from last period
          </p>
        )}
      </CardContent>
    </Card>
  );
};

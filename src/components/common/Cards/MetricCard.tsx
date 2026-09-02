import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  period?: string;
  icon?: LucideIcon;
  trend?: number[];
  onClick?: () => void;
  className?: string;
  valueClassName?: string;
  loading?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  period = 'vs last period',
  icon: Icon,
  trend,
  onClick,
  className,
  valueClassName,
  loading = false,
}) => {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isNeutral = change !== undefined && change === 0;

  return (
    <Card
      className={cn(
        'transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary',
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {Icon && (
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-12 flex items-center">
            <div className="h-8 w-24 bg-muted animate-pulse rounded" />
          </div>
        ) : (
          <>
            <div className={cn('text-3xl font-bold', valueClassName)}>
              {value}
            </div>
            {change !== undefined && (
              <div className="flex items-center gap-2 mt-2">
                {isPositive && (
                  <TrendingUp className="h-4 w-4 text-success" />
                )}
                {isNegative && (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
                {isNeutral && (
                  <Minus className="h-4 w-4 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    'text-sm font-medium',
                    isPositive && 'text-success',
                    isNegative && 'text-destructive',
                    isNeutral && 'text-muted-foreground'
                  )}
                >
                  {change > 0 && '+'}
                  {change}%
                </span>
                <span className="text-sm text-muted-foreground">{period}</span>
              </div>
            )}
            {trend && trend.length > 0 && (
              <div className="mt-3 flex items-end gap-1 h-8">
                {trend.map((value, index) => {
                  const maxValue = Math.max(...trend);
                  const height = (value / maxValue) * 100;
                  return (
                    <div
                      key={index}
                      className="flex-1 bg-primary/20 rounded-sm"
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

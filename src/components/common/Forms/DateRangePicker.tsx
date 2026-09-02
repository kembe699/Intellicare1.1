import React from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  placeholder?: string;
  className?: string;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  onChange,
  placeholder = 'Select date range',
  className,
}) => {
  const formatDate = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const displayText = value.from && value.to
    ? `${formatDate(value.from)} - ${formatDate(value.to)}`
    : value.from
    ? `From ${formatDate(value.from)}`
    : placeholder;

  return (
    <div className={cn('relative', className)}>
      <Button
        variant="outline"
        className={cn(
          'w-full justify-start text-left font-normal',
          !value.from && 'text-muted-foreground'
        )}
      >
        <Calendar className="mr-2 h-4 w-4" />
        {displayText}
      </Button>
    </div>
  );
};

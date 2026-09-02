import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoadingStateProps {
  message?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
  className,
  size = 'md',
}) => {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16', className)}>
      <Loader2 className={cn('animate-spin text-muted-foreground', sizeMap[size])} />
      {message && (
        <p className="text-sm text-muted-foreground mt-4">{message}</p>
      )}
    </div>
  );
};

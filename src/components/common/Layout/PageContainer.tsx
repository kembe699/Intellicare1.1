import React from 'react';
import { cn } from '@/lib/utils';

export interface PageContainerProps {
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  className?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  maxWidth = '2xl',
  className,
}) => {
  const maxWidthClasses = {
    sm: 'max-w-screen-sm',
    md: 'max-w-screen-md',
    lg: 'max-w-screen-lg',
    xl: 'max-w-screen-xl',
    '2xl': 'max-w-screen-2xl',
    full: 'max-w-full',
  };

  return (
    <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', maxWidthClasses[maxWidth], className)}>
      {children}
    </div>
  );
};

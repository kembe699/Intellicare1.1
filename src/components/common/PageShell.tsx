import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader, type PageHeaderProps } from './PageHeader/PageHeader';
import { cn } from '@/lib/utils';

interface PageShellProps extends PageHeaderProps {
  children: React.ReactNode;
  /** Extra className applied to the inner content wrapper */
  contentClassName?: string;
}

/**
 * Standard page wrapper used by every module page.
 * Provides AppLayout + branded PageHeader + content area.
 */
export const PageShell: React.FC<PageShellProps> = ({
  children,
  contentClassName,
  // PageHeader props
  title,
  subtitle,
  actions,
  breadcrumbs,
  icon,
  className,
}) => {
  return (
    <AppLayout>
      <div className={cn('animate-fade-in space-y-3', contentClassName)}>
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={actions}
          breadcrumbs={breadcrumbs}
          icon={icon}
          className={className}
        />
        {children}
      </div>
    </AppLayout>
  );
};

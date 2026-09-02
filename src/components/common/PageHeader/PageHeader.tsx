import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className,
}) => {
  return (
    <div className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={index}>
              {index > 0 && <ChevronRight className="h-4 w-4" />}
              {crumb.href ? (
                <Link
                  to={crumb.href}
                  className="hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      
      <div className="border-b border-border mt-4" />
    </div>
  );
};

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
  /**
   * Icon shown beside the title.
   *
   * 50 pages were already passing one, but the prop did not exist and nothing
   * rendered it — so those icons were silently dropped and page headers looked
   * inconsistent depending on whether a screen happened to draw its own.
   */
  icon?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className,
  icon,
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
      
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            {icon && (
              <span className="text-primary shrink-0 [&>svg]:h-6 [&>svg]:w-6" aria-hidden="true">
                {icon}
              </span>
            )}
            {/* No truncate: on a narrow screen with wide actions (a button
                group, an icon + label), squeezing the title down to fit one
                row cut off the page's own name (e.g. "Purchas..." for
                "Purchase Orders"). flex-wrap above lets actions drop to
                their own row instead, so the title keeps its full width. */}
            <h1 className="text-2xl font-bold text-foreground break-words">{title}</h1>
          </div>
          {subtitle && (
            <p className="text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 flex-wrap">
            {actions}
          </div>
        )}
      </div>
      
      <div className="border-b border-border mt-4" />
    </div>
  );
};

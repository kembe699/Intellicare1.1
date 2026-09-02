import React from 'react';
import { cn } from '@/lib/utils';

/* ─── IcCard ─────────────────────────────────────────────────────────────────
 * Standard branded card/panel.
 * • Light teal-tinted background, rounded-xl, teal-tinted border, subtle shadow
 * • Optional teal-tinted header strip (title + icon + actions)
 * • Optional body padding
 * ─────────────────────────────────────────────────────────────────────────── */

interface IcCardProps {
  children: React.ReactNode;
  className?: string;
}

interface IcCardHeaderProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

interface IcCardBodyProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

/** Root card shell */
export const IcCard: React.FC<IcCardProps> = ({ children, className }) => (
  <div className={cn('ic-card', className)}>{children}</div>
);

/** Teal-tinted card header */
export const IcCardHeader: React.FC<IcCardHeaderProps> = ({
  title,
  icon,
  actions,
  className,
}) => (
  <div className={cn('ic-card-header', className)}>
    <div className="ic-card-title">
      {icon && (
        <span className="[&>svg]:w-4 [&>svg]:h-4 [&>svg]:text-primary shrink-0">{icon}</span>
      )}
      {typeof title === 'string' ? (
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
      ) : (
        title
      )}
    </div>
    {actions && (
      <div className="flex items-center gap-2 ml-auto">{actions}</div>
    )}
  </div>
);

/** Card body */
export const IcCardBody: React.FC<IcCardBodyProps> = ({
  children,
  className,
  noPadding = false,
}) => (
  <div className={cn(!noPadding && 'ic-card-body', className)}>{children}</div>
);

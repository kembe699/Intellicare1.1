import React from 'react';
import { cn } from '@/lib/utils';

/* ─── IcFormField ────────────────────────────────────────────────────────────
 * Standard form field: label + input/select/children + optional error.
 * Enforces consistent label size, spacing, and error display.
 * ─────────────────────────────────────────────────────────────────────────── */

interface IcFormFieldProps {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  /** Apply a 2-col grid layout across N fields */
  labelFor?: string;
}

export const IcFormField: React.FC<IcFormFieldProps> = ({
  label,
  required,
  error,
  hint,
  children,
  className,
  labelFor,
}) => (
  <div className={cn('ic-form-field', className)}>
    {label && (
      <label htmlFor={labelFor} className="ic-form-label">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
    )}
    {children}
    {hint && !error && (
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    )}
    {error && (
      <p className="ic-form-error">{error}</p>
    )}
  </div>
);

/* ─── IcFormGrid ─────────────────────────────────────────────────────────────
 * Responsive 2-column grid for form fields inside a dialog or form section.
 * ─────────────────────────────────────────────────────────────────────────── */
interface IcFormGridProps {
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
  className?: string;
}

export const IcFormGrid: React.FC<IcFormGridProps> = ({
  children,
  cols = 2,
  className,
}) => {
  const colClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-3',
  }[cols];

  return (
    <div className={cn('grid gap-3 p-5', colClass, className)}>
      {children}
    </div>
  );
};

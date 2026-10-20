import React, { useId } from 'react';
import { cn } from '@/lib/utils';

/* ─── IcFormField ────────────────────────────────────────────────────────────
 * Standard form field: label + input/select/children + optional error.
 * Enforces consistent label size, spacing, and error display.
 *
 * When `children` is a single element (the common case — one <Input>,
 * <Select>, <DatePicker>, …), it's cloned with `aria-invalid` and
 * `aria-describedby` wired to the error message automatically, so call
 * sites don't have to repeat that wiring by hand everywhere. Multiple
 * children (e.g. an input next to a button) fall back to rendering as-is.
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
}) => {
  const autoId = useId();
  const errorId = `${labelFor || autoId}-error`;
  const hintId = `${labelFor || autoId}-hint`;

  const content = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any>, {
        'aria-invalid': error ? true : (children as React.ReactElement<any>).props?.['aria-invalid'],
        'aria-required': required || (children as React.ReactElement<any>).props?.['aria-required'],
        'aria-describedby':
          cn(error && errorId, !error && hint && hintId, (children as React.ReactElement<any>).props?.['aria-describedby']) || undefined,
      })
    : children;

  return (
    <div className={cn('ic-form-field', className)}>
      {label && (
        <label htmlFor={labelFor} className="ic-form-label">
          {label}
          {required && (
            <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
          )}
        </label>
      )}
      {content}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="ic-form-error" role="alert">{error}</p>
      )}
    </div>
  );
};

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

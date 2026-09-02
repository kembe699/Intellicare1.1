import React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  error,
  helpText,
  required = false,
  children,
  className,
}) => {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {error && (
        <div className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-3 w-3" />
          <span>{error}</span>
        </div>
      )}
      {helpText && !error && (
        <p className="text-sm text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
};

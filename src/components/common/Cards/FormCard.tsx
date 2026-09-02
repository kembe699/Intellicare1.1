import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FormCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  footerActions?: React.ReactNode;
}

export const FormCard: React.FC<FormCardProps> = ({
  title,
  description,
  children,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  loading = false,
  disabled = false,
  className,
  footerActions,
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(e);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {children}
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={loading}
              >
                {cancelLabel}
              </Button>
            )}
            <Button
              type="submit"
              disabled={disabled || loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
          {footerActions && <div>{footerActions}</div>}
        </CardFooter>
      </form>
    </Card>
  );
};

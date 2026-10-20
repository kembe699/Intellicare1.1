import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmDialogReasonConfig {
  label: string;
  placeholder?: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** Shows a required reason text field (e.g. voiding a bill) — the confirm
   *  button stays disabled until it's filled in. */
  reason?: ConfirmDialogReasonConfig;
  /** May be async. The confirm button shows a spinner and stays disabled
   *  while it runs; if it throws, the dialog stays open so the user can
   *  retry instead of silently losing the action. */
  onConfirm: (reason: string) => void | Promise<void>;
  /** Icon shown in the tinted circle. Defaults to a warning triangle. */
  icon?: LucideIcon;
}

// The one confirm-dialog pattern for every destructive/high-stakes action in
// the app (logout, delete, discharge, cancel, void) — a 44px icon badge, a
// short question-phrased title, the description, an optional required
// reason field, and cancel/confirm right-aligned (cancel on the left).
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  reason,
  onConfirm,
  icon: Icon = AlertTriangle,
}: ConfirmDialogProps) {
  const [reasonValue, setReasonValue] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);

  const reasonMissing = Boolean(reason) && reasonValue.trim() === '';

  const handleOpenChange = (next: boolean) => {
    if (isConfirming) return; // don't let Escape/overlay-click abandon an in-flight action
    if (!next) setReasonValue('');
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (reasonMissing) return;
    setIsConfirming(true);
    try {
      await onConfirm(reasonValue.trim());
      setReasonValue('');
      onOpenChange(false);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              tone === 'danger' ? 'bg-destructive-bg text-destructive' : 'bg-primary-soft text-primary',
            )}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </div>
          <AlertDialogHeader className="flex-1 text-left space-y-1.5">
            <AlertDialogTitle className={cn('text-left', tone === 'danger' && 'text-destructive')}>
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">{description}</AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        {reason && (
          <div className="pl-[59px]">
            <label htmlFor="confirm-dialog-reason" className="ic-form-label">
              {reason.label}
            </label>
            <Textarea
              id="confirm-dialog-reason"
              value={reasonValue}
              onChange={(e) => setReasonValue(e.target.value)}
              placeholder={reason.placeholder}
              rows={2}
              className="mt-1.5 min-h-0"
              aria-required="true"
            />
          </div>
        )}

        <AlertDialogFooter className="gap-2 sm:justify-end pt-1">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={isConfirming} className="mt-0">
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant={tone === 'danger' ? 'destructive' : 'default'}
            loading={isConfirming}
            disabled={reasonMissing}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

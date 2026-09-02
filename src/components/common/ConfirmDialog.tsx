import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, AlertTriangle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: 'destructive' | 'default';
  loading?: boolean;
  /** Icon shown centered above the title, in a tinted circle. Defaults to a warning triangle. */
  icon?: LucideIcon;
}

// The one confirm-dialog pattern for every destructive/high-stakes action in the app
// (logout, delete, discharge, cancel) — centered icon badge, short question, two
// side-by-side buttons (primary confirm + secondary cancel).
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  variant = 'default',
  loading = false,
  icon: Icon = AlertTriangle,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <div className="flex flex-col items-center text-center pt-2">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full mb-3',
              variant === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">{title}</AlertDialogTitle>
            <AlertDialogDescription className="text-center">{description}</AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter className="sm:justify-center gap-2 pt-2">
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={loading}
            className={cn('flex-1', variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
          <AlertDialogCancel disabled={loading} className="flex-1 mt-0">{cancelLabel}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

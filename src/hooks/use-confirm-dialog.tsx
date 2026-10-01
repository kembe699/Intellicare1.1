import { useCallback, useRef, useState } from 'react';
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

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  /** Styles the confirm button as destructive (red) — use for delete/void/cancel/discharge-style actions. */
  destructive?: boolean;
}

/**
 * U2: replaces window.confirm(), which blocks the whole tab and looks like
 * the browser rather than the app — the same problem U1 fixes for
 * window.prompt(). Usage:
 *
 *   const { confirmDialog, confirm } = useConfirmDialog();
 *   if (!(await confirm({ description: 'Delete this ward?', destructive: true }))) return;
 *   ...
 *   return <>{confirmDialog}{...rest of the page}</>;
 */
export function useConfirmDialog() {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolveRef = useRef<(v: boolean) => void>();

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setState({ ...options, open: true });
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  const finish = useCallback((result: boolean) => {
    setState((s) => (s ? { ...s, open: false } : s));
    resolveRef.current?.(result);
    resolveRef.current = undefined;
  }, []);

  const confirmDialog = (
    <AlertDialog open={!!state?.open} onOpenChange={(open) => { if (!open) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title || 'Are you sure?'}</AlertDialogTitle>
          <AlertDialogDescription>{state?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => finish(true)}
            className={state?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {state?.confirmLabel || 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}

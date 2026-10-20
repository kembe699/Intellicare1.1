import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red) — use for delete/void/cancel/discharge-style actions. */
  destructive?: boolean;
  /** Shows a required reason field (e.g. voiding a bill) before Confirm enables. */
  reason?: { label: string; placeholder?: string };
}

/**
 * U2: replaces window.confirm(), which blocks the whole tab and looks like
 * the browser rather than the app — the same problem U1 fixes for
 * window.prompt(). Usage:
 *
 *   const { confirmDialog, confirm } = useConfirmDialog();
 *   if (!(await confirm({ title: 'Delete this ward?', description: 'This cannot be undone.', destructive: true }))) return;
 *   ...
 *   return <>{confirmDialog}{...rest of the page}</>;
 *
 * Renders through the shared <ConfirmDialog> (the Option B icon/pill/
 * right-aligned-buttons treatment), so all existing call sites pick up
 * that styling automatically. Prefer a specific `title` phrased as a
 * question ("Cancel bill INV-0231?") with the consequences in
 * `description` — a call site that only passes `description` still works,
 * falling back to a generic "Are you sure?" title.
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
    <ConfirmDialog
      open={!!state?.open}
      onOpenChange={(open) => { if (!open) finish(false); }}
      title={state?.title || 'Are you sure?'}
      description={state?.description || ''}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      tone={state?.destructive ? 'danger' : 'default'}
      reason={state?.reason}
      onConfirm={() => finish(true)}
    />
  );

  return { confirm, confirmDialog };
}

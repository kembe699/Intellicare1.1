import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmDialogReasonConfig } from '@/components/common/ConfirmDialog';
import type { LucideIcon } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  icon?: LucideIcon;
  /** Shows a required reason field (e.g. voiding a bill) before Confirm enables. */
  reason?: ConfirmDialogReasonConfig;
  /**
   * For when the action itself needs the reason text, or needs to run
   * *before* the dialog closes (so its own error can keep the dialog open
   * for a retry) — e.g. `onConfirm: (reason) => voidBill(id, reason)`. May
   * be async; the confirm button shows a spinner while it runs. Omit this
   * for the common case and just await the returned promise instead:
   *
   *   const ok = await confirm({ title: '...', description: '...' });
   *   if (ok) await doTheThing();
   */
  onConfirm?: (reason: string) => void | Promise<void>;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Mount once near the app root (see App.tsx). Renders the single shared
 *  ConfirmDialog instance that every useConfirm() call reuses. */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resolveRef.current?.(false);
      resolveRef.current = null;
      setOptions(null);
    }
  };

  const handleConfirm = async (reason: string) => {
    // Let the action run — and stay open, so a thrown error can be retried
    // — before resolving the promise, so a caller awaiting confirm() never
    // sees `true` until onConfirm actually finished.
    await options?.onConfirm?.(reason);
    resolveRef.current?.(true);
    resolveRef.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <ConfirmDialog
          open
          onOpenChange={handleOpenChange}
          title={options.title}
          description={options.description}
          confirmLabel={options.confirmLabel}
          cancelLabel={options.cancelLabel}
          tone={options.tone}
          icon={options.icon}
          reason={options.reason}
          onConfirm={handleConfirm}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Drop-in replacement for the native `confirm()` — but non-blocking, async,
 * and themed. Swaps a call site from:
 *
 *   if (confirm('Delete this item?')) { await deleteItem(id); }
 *
 * to:
 *
 *   const ok = await confirm({ title: 'Delete this item?', description: '...' });
 *   if (ok) { await deleteItem(id); }
 *
 * For destructive/irreversible actions, pass `tone: 'danger'`; for voiding
 * or cancelling bills/receipts/payments, also pass `reason`.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm() must be used within <ConfirmDialogProvider>');
  }
  return ctx;
}

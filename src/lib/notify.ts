import { toast as sonnerToast, type ExternalToast } from 'sonner';

/**
 * Drop-in replacement for `import { toast } from 'sonner'` — same shape and
 * call signatures, so every one of the app's ~1300 existing
 * `toast.success(...)` / `toast.error(...)` call sites keeps working
 * unchanged. The difference: `success` now auto-closes after 4s and
 * `error` now stays until the user dismisses it (optionally with a Retry
 * action), matching the Option B toast spec, instead of every call site
 * having to opt into that behavior individually.
 *
 * To adopt it, a file only needs to change its import from 'sonner' to
 * '@/lib/notify' — nothing else. (For new code, prefer the simpler
 * `notify.success(title, description?)` / `notify.error(...)` below.)
 */
export const toast: typeof sonnerToast = Object.assign(
  (message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) => sonnerToast(message, data),
  {
    success: (message: Parameters<typeof sonnerToast.success>[0], data?: ExternalToast) =>
      sonnerToast.success(message, { duration: 4000, ...data }),
    error: (message: Parameters<typeof sonnerToast.error>[0], data?: ExternalToast) =>
      sonnerToast.error(message, { duration: Infinity, ...data }),
    info: sonnerToast.info,
    warning: sonnerToast.warning,
    message: sonnerToast.message,
    custom: sonnerToast.custom,
    promise: sonnerToast.promise,
    dismiss: sonnerToast.dismiss,
    loading: sonnerToast.loading,
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
  },
) as typeof sonnerToast;

/** For new code: the plain-language form instead of raw sonner calls. */
export const notify = {
  success(title: string, description?: string) {
    return toast.success(title, { description });
  },
  /** Stays on screen until dismissed. Pass `retry` to add a "Retry" action button. */
  error(title: string, description?: string, retry?: () => void) {
    return toast.error(title, {
      description,
      action: retry ? { label: 'Retry', onClick: retry } : undefined,
    });
  },
  info(title: string, description?: string) {
    return toast.info(title, { description });
  },
};

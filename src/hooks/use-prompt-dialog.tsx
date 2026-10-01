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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Blocks confirming with an empty value — trims before checking. Default true. */
  required?: boolean;
  /** Use a multi-line Textarea instead of a single-line Input. */
  multiline?: boolean;
}

/**
 * U1: replaces window.prompt(), which blocks the whole tab, looks like the
 * browser rather than the app, and silently returns null on some mobile
 * browsers that don't implement it at all. Usage:
 *
 *   const { prompt, promptDialog } = usePromptDialog();
 *   const reason = await prompt({ title: 'Reason for rejection' });
 *   if (reason === null) return; // cancelled, same contract as window.prompt
 *   ...
 *   return <>{promptDialog}{...rest of the page}</>;
 */
export function usePromptDialog() {
  const [state, setState] = useState<(PromptOptions & { open: boolean }) | null>(null);
  const [value, setValue] = useState('');
  const resolveRef = useRef<(v: string | null) => void>();

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    setValue(options.defaultValue || '');
    setState({ ...options, open: true });
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  const finish = useCallback((result: string | null) => {
    setState((s) => (s ? { ...s, open: false } : s));
    resolveRef.current?.(result);
    resolveRef.current = undefined;
  }, []);

  const required = state?.required !== false;
  const trimmed = value.trim();
  const canConfirm = !required || trimmed.length > 0;
  const InputField = state?.multiline ? Textarea : Input;

  const promptDialog = (
    <AlertDialog open={!!state?.open} onOpenChange={(open) => { if (!open) finish(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          {state?.description && <AlertDialogDescription>{state.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <InputField
          autoFocus
          value={value}
          placeholder={state?.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !state?.multiline && canConfirm) finish(trimmed);
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm} onClick={() => finish(trimmed)}>
            {state?.confirmLabel || 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { prompt, promptDialog };
}

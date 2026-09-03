import { lazy, type ComponentType } from 'react';

// Mirrors React.lazy's own signature: the props of a route component are not
// known here, and narrowing them rejects every real page.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * React.lazy that survives a deploy happening while the app is open.
 *
 * Vite fingerprints every route chunk (LISTestOrders-DvgFi4hj.js). A tab that
 * loaded before a deploy is still holding the previous build's filenames, so the
 * first navigation afterwards requests a chunk that no longer exists. The import
 * rejects, React has nothing to render, and the whole tree unmounts: the URL in
 * the address bar changes but the page does not — which is exactly what it looks
 * like from the user's side.
 *
 * Recovering is simply a matter of reloading, because a reload fetches the
 * current index.html and with it the current chunk names. The guard below makes
 * that safe to do automatically:
 *
 *   - sessionStorage records that a reload was already attempted, so a chunk
 *     that is genuinely missing (a bad deploy, an offline device) produces one
 *     reload and then a real error, never a reload loop.
 *   - the marker is cleared on a successful import, so a later deploy in the
 *     same tab is handled the same way.
 *
 * Only failures that look like a module-loading problem trigger this. A crash
 * inside a component that happens to be lazy is a real bug and must surface, not
 * be papered over by a refresh.
 */
const RELOAD_KEY = 'chunk-reload-attempted';

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||   // Safari
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message)
  );
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === '1';
  } catch {
    // Private mode or blocked storage: fall back to not reloading, so a broken
    // chunk shows an error rather than looping forever.
    return true;
  }
}

function writeFlag(value: boolean) {
  try {
    if (value) sessionStorage.setItem(RELOAD_KEY, '1');
    else sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* storage unavailable — nothing to do */
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const module = await factory();
      writeFlag(false);
      return module;
    } catch (error) {
      if (isChunkLoadError(error) && !readFlag()) {
        writeFlag(true);
        window.location.reload();
        // Never resolves — the reload replaces this document. Returning a
        // pending promise keeps Suspense showing its fallback rather than
        // flashing an error for the moment before navigation happens.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}

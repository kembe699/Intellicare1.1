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
 * Every failure caught below is a module-loading problem, full stop — the try
 * block wraps nothing but the `import()` call itself, so the component has not
 * even begun rendering yet. A crash inside the component is a separate,
 * later failure (surfaced by RouteErrorBoundary instead) and never lands here.
 *
 * That means recovery does not need to pattern-match the error's message to
 * decide whether it "looks like" a chunk-load failure — a browser rewords
 * these constantly, and a connection reset mid-deploy (the server restarting
 * while a chunk request is in flight, which this app's own deploys cause)
 * produces a plain "Failed to fetch" that says nothing about modules at all.
 * Requiring specific wording let exactly that case fall through uncaught,
 * which is what a stuck-on-the-old-page report with no visible error looks
 * like from the user's side. Retrying unconditionally closes that gap.
 */
const RELOAD_KEY = 'chunk-reload-attempted';

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
      if (!readFlag()) {
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

import React from 'react';

/**
 * Catches render errors from the routed page tree.
 *
 * Without a boundary anywhere above the routes, any thrown error unmounts the
 * entire application and leaves an empty <div id="root">. That is what a stale
 * route chunk did after a deploy: the address bar changed and the screen went
 * blank, with the cause visible only in the console.
 *
 * A chunk-loading failure is treated as recoverable and offers a reload, since
 * reloading is genuinely the fix (it fetches the current build). Anything else
 * is a real bug and says so, but still leaves the user a way out rather than a
 * blank page.
 */
interface State {
  error: Error | null;
}

const isChunkError = (error: Error | null) =>
  !!error &&
  (/Failed to fetch dynamically imported module/i.test(error.message) ||
    /error loading dynamically imported module/i.test(error.message) ||
    /Importing a module script failed/i.test(error.message) ||
    /ChunkLoadError/i.test(error.message) ||
    /Loading chunk \d+ failed/i.test(error.message));

export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Route error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkError(error);

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {stale ? 'A new version is available' : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {stale
              ? 'This page was updated while you had the app open. Reload to continue.'
              : 'This page failed to load. Reloading usually clears it.'}
          </p>
          {!stale && (
            <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
              {error.message}
            </pre>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.assign('/dashboard');
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}

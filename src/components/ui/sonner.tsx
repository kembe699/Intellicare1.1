import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Toaster as SonnerToaster, toast } from "sonner";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

// `closeButtonAriaLabel` is a real runtime prop (it's what the close button's
// aria-label actually renders from), just missing from this sonner version's
// own .d.ts — patching the type here instead of reaching for `any`.
declare module "sonner" {
  interface ToasterProps {
    closeButtonAriaLabel?: string;
  }
}

// ─── Sonner Toaster – isolated root singleton ───────────────
// Sonner v1.x calls setState during its own render cycle, which
// triggers React's "Cannot update a component while rendering"
// warning.  To avoid this we boot Sonner in a completely separate
// React root that is created *once* – outside any component
// lifecycle – so StrictMode double-invoke, HMR, and parent
// re-renders are all irrelevant.

let _booted = false;

function bootSonner() {
  if (_booted) return;
  _booted = true;

  const host = document.createElement("div");
  host.id = "sonner-portal";
  document.body.appendChild(host);

  ReactDOM.createRoot(host).render(
    <SonnerToaster
      className="toaster group"
      position="top-right"
      closeButton
      closeButtonAriaLabel="Close message"
      icons={{
        success: <CheckCircle2 className="h-5 w-5 text-success" />,
        error: <AlertTriangle className="h-5 w-5 text-destructive" />,
        info: <Info className="h-5 w-5 text-info" />,
        close: <X className="h-4 w-4" />,
      }}
      toastOptions={{
        // Durations aren't set here — per-type durations aren't configurable
        // at the Toaster level. src/lib/notify.ts's `toast` wrapper sets
        // success to 4s and error to 6s (both auto-close; error just gets a
        // bit longer since there's usually more to read).
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:shadow-md group-[.toaster]:rounded-lg group-[.toaster]:p-4",
          title: "group-[.toast]:text-base group-[.toast]:font-semibold group-[.toast]:text-foreground",
          description: "group-[.toast]:text-sm group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md group-[.toast]:px-3 group-[.toast]:h-8 group-[.toast]:text-sm group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-md group-[.toast]:px-3 group-[.toast]:h-8 group-[.toast]:text-sm",
          closeButton:
            "group-[.toast]:border-border group-[.toast]:bg-card group-[.toast]:text-muted-foreground",
          // Success/info keep the plain white card — only error gets the
          // tinted background+border (it's the one that needs to read as
          // "this needs attention" even in a cluttered corner of the screen).
          error: "group-[.toaster]:border-destructive-border group-[.toaster]:bg-destructive-bg",
        },
      }}
    />
  );
}

// The <Toaster /> component triggers the one-time boot inside
// useEffect to avoid side-effects during the render phase.
// It renders nothing into the main React tree.
const Toaster = () => {
  useEffect(() => { bootSonner(); }, []);
  return null;
};

export { Toaster, toast };

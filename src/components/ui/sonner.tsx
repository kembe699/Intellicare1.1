import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Toaster as SonnerToaster, toast } from "sonner";

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
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
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

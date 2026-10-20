import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./index.css";
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import App from './App';

// Global fetch interceptor: prepend Render backend URL for all relative /api/ calls in production
const _hostname = window.location.hostname;
const _isLocal = _hostname === 'localhost' || _hostname === '127.0.0.1';
if (!_isLocal) {
  const _backendBase = (import.meta.env.VITE_API_URL as string) || window.location.origin;
  const _origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && (input.startsWith('/api') || input.startsWith('/health'))) {
      input = `${_backendBase}${input}`;
    }
    return _origFetch(input, init);
  };
}

// Service worker cleanup in development mode
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
    .then(() => {
      if (!("caches" in window)) return;
      return caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    })
    .catch(() => {
      // ignore
    });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}
    >
      <App />
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>
);

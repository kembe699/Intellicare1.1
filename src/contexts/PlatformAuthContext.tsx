import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// Platform Admin handles client credentials, quotations, and invoice
// payments — sensitive enough to warrant its own idle timeout, unlike the
// tenant-facing app (no such timeout exists there; changing that would be a
// much bigger, more disruptive change to daily clinical workflows). This is
// activity-based (mouse/keyboard/touch/scroll), not just a fixed token
// lifetime — the JWT itself is still valid for 24h server-side, so a still-
// active admin is never interrupted, but a tab left open and unattended
// signs itself out.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const IDLE_CHECK_INTERVAL_MS = 15 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;

// Deliberately separate from AuthContext (the tenant-user auth) — different
// localStorage key, different token shape (isPlatformAdmin, no schemaName), and
// never shares state with it, so a platform admin session and a tenant
// session can't be confused with one another.
interface PlatformAdmin {
  id: number;
  email: string;
  name: string;
}

interface PlatformAuthContextType {
  admin: PlatformAdmin | null;
  loading: boolean;
  token: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const PlatformAuthContext = createContext<PlatformAuthContextType | null>(null);

export const usePlatformAuth = () => {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used within a PlatformAuthProvider');
  return ctx;
};

function apiBase() {
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal) return `${window.location.origin}/api/platform`;
  const apiUrl = (import.meta as any).env?.VITE_API_URL || window.location.origin;
  return `${apiUrl}/api/platform`;
}

export const PlatformAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('platform_admin_token');
    const savedAdmin = localStorage.getItem('platform_admin');
    if (savedToken && savedAdmin) {
      setToken(savedToken);
      setAdmin(JSON.parse(savedAdmin));
    }
    setLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('platform_admin_token', data.token);
    localStorage.setItem('platform_admin', JSON.stringify(data.admin));
    setToken(data.token);
    setAdmin(data.admin);
  };

  const signOut = () => {
    localStorage.removeItem('platform_admin_token');
    localStorage.removeItem('platform_admin');
    setToken(null);
    setAdmin(null);
  };

  // Idle timeout — only armed while actually signed in. lastActivityRef is a
  // ref rather than state so a mousemove doesn't trigger a re-render on
  // every pixel; only the periodic check reads it.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    if (!token) return;

    lastActivityRef.current = Date.now();
    const markActive = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS) {
        toast.error('Signed out due to inactivity');
        signOut();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <PlatformAuthContext.Provider value={{ admin, loading, token, signIn, signOut }}>
      {children}
    </PlatformAuthContext.Provider>
  );
};

export { apiBase as platformApiBase };

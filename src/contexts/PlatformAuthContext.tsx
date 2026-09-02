import React, { createContext, useContext, useEffect, useState } from 'react';

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
  const apiUrl = (import.meta as any).env?.VITE_API_URL || 'https://api.nilehc.tech';
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

  return (
    <PlatformAuthContext.Provider value={{ admin, loading, token, signIn, signOut }}>
      {children}
    </PlatformAuthContext.Provider>
  );
};

export { apiBase as platformApiBase };

import { platformApiBase } from '@/contexts/PlatformAuthContext';

// Authenticated fetch wrapper for the platform admin panel — mirrors
// authFetch's shape (in apiClient.ts) but reads the separate
// platform_admin_token, never the tenant auth_token.
export async function platformFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('platform_admin_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  return fetch(`${platformApiBase()}${path}`, { ...options, headers });
}

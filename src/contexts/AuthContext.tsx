import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@/types';
import { toast } from 'sonner';
import { authFetch } from '@/api/apiClient';
import { getFacilityInfo, refreshFacilityInfo } from '@/hooks/useFacilityInfo';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (code: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  token: string | null;
  currentBranchId: number | null;
  switchBranch: (branchId: number) => void;
  updateCurrentRoom: (roomId: string | null) => Promise<void>;
  /**
   * Merge changes into the signed-in user without a page reload.
   *
   * Saving a profile updated the server but left this context holding the old
   * values, so the name in the header and on the profile card only caught up
   * after a refresh — which reads as the save not having worked.
   */
  updateUser: (changes: Partial<User>) => void;
  /**
   * Whether the signed-in user can do something gated by one or more
   * privilege keys from src/server/config/permissionsCatalog.js — the same
   * keys the backend's authorize() checks. Pass an array for "any of these"
   * (e.g. a section header that should show if the role has any privilege
   * relevant to that module). admin always passes, without needing an
   * explicit grant for every key.
   */
  hasPrivilege: (required: string | string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Browser-safe auth API client that uses HTTP calls to MySQL backend
class AuthApiClient {
  private getBaseUrl() {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocalhost) return `${window.location.origin}/api/auth`;
    // Private/LAN IP — route to local backend on same host/port
    const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname);
    if (isPrivateIP) return `${window.location.origin}/api/auth`;
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    return `${apiUrl}/api/auth`;
  }
  
  private get baseUrl() {
    return this.getBaseUrl();
  }

  async login(code: string, email: string, password: string): Promise<{ token: string; user: User }> {
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, email, password }),
    });

    if (!response.ok) {
      let error;
      try {
        error = await response.json();
      } catch {
        error = { error: 'Login failed' };
      }
      throw new Error(error.error || 'Login failed');
    }

    return await response.json();
  }

  async verifyToken(token: string): Promise<{ user: User; token?: string }> {
    const response = await fetch(`${this.baseUrl}/verify`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
    });

    if (!response.ok) {
      throw new Error('Token verification failed');
    }

    return await response.json();
  }

  async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

const authApi = new AuthApiClient();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [currentBranchId, setCurrentBranchId] = useState<number | null>(null);

  const normalizeUser = (userData: any): User => ({
    uid: userData.id,
    email: userData.email,
    displayName: userData.displayName,
    role: userData.role,
    clinic: userData.clinic?.toString() || userData.clinicId?.toString() || '1',
    branchId: userData.branchId || null,
    primaryBranchId: userData.primaryBranchId || userData.branchId || null,
    primaryBranchName: userData.primaryBranchName || null,
    accessibleBranches: userData.accessibleBranches || [],
    isAdmin: !!userData.isAdmin,
    id: userData.id,
    currentRoomId: userData.currentRoomId || null,
    privileges: Array.isArray(userData.privileges) ? userData.privileges : [],
  });

  // Check for existing token on mount
  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        const savedToken = localStorage.getItem('auth_token');
        const savedBranchId = localStorage.getItem('current_branch_id');
        if (savedToken) {
          const { user: userData, token: freshToken } = await authApi.verifyToken(savedToken);
          const activeToken = freshToken || savedToken;
          if (freshToken) {
            localStorage.setItem('auth_token', freshToken);
          }
          const normalizedUser = normalizeUser(userData);
          setToken(activeToken);
          console.log('Setting user from token verification, userData:', userData);
          setUser(normalizedUser);
          // Warm the facility identity now rather than when a document is
          // first printed, so a receipt can never go out branded with the
          // IntelliCare placeholder just because it was printed quickly.
          void getFacilityInfo(normalizedUser.primaryBranchId || normalizedUser.branchId);
          setCurrentBranchId(savedBranchId ? parseInt(savedBranchId, 10) : (normalizedUser.primaryBranchId || normalizedUser.branchId || null));
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('current_branch_id');
      } finally {
        setLoading(false);
      }
    };

    checkExistingAuth();
  }, []);

  const signIn = async (code: string, email: string, password: string) => {
    try {
      setLoading(true);
      const { token: authToken, user: userData } = await authApi.login(code, email, password);
      const normalizedUser = normalizeUser(userData);
      
      // Save token to localStorage
      localStorage.setItem('auth_token', authToken);
      setToken(authToken);
      
      // Set user data
      console.log('Setting user from login, userData:', userData);
      setUser(normalizedUser);
      // A different account can mean a different facility, so this is
      // re-read rather than reused from the previous session.
      void refreshFacilityInfo(normalizedUser.primaryBranchId || normalizedUser.branchId);
      const nextBranchId = normalizedUser.primaryBranchId || normalizedUser.branchId || null;
      setCurrentBranchId(nextBranchId);
      if (nextBranchId) {
        localStorage.setItem('current_branch_id', nextBranchId.toString());
      }

      // Don't call toast here to avoid render warnings
    } catch (error: unknown) {
      console.error('Sign-in error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Always clear local state
      localStorage.removeItem('auth_token');
      localStorage.removeItem('current_branch_id');
      setToken(null);
      setUser(null);
      setCurrentBranchId(null);
      // Don't call toast here to avoid render warnings
    }
  };

  const switchBranch = (branchId: number) => {
    setCurrentBranchId(branchId);
    localStorage.setItem('current_branch_id', branchId.toString());
  };

  const updateUser = (changes: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...changes } : prev));
  };

  const hasPrivilege = (required: string | string[]): boolean => {
    if (!user) return false;
    if (user.isAdmin) return true;
    const granted = user.privileges || [];
    return Array.isArray(required) ? required.some((k) => granted.includes(k)) : granted.includes(required);
  };

  const updateCurrentRoom = async (roomId: string | null) => {
    if (!user?.uid) return;
    const res = await authFetch(`/api/users/${user.uid}/current-room`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId }),
    });
    if (!res.ok) {
      throw new Error('Failed to update current room');
    }
    setUser(prev => (prev ? { ...prev, currentRoomId: roomId } : prev));
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, token, currentBranchId, switchBranch, updateCurrentRoom, updateUser, hasPrivilege }}>
      {children}
    </AuthContext.Provider>
  );
};

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { publicFetch, staffFetch } from '@/api/apiClient';

interface StaffEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  department?: string | null;
}

interface StaffAuthContextValue {
  employee: StaffEmployee | null;
  mustSetPin: boolean;
  isDepartmentHead: boolean;
  loading: boolean;
  login: (code: string, employeeNumber: string, credential: string) => Promise<{ ok: boolean; error?: string }>;
  setPin: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const StaffAuthContext = createContext<StaffAuthContextValue | undefined>(undefined);

export function StaffAuthProvider({ children }: { children: React.ReactNode }) {
  const [employee, setEmployee] = useState<StaffEmployee | null>(null);
  const [mustSetPin, setMustSetPin] = useState(false);
  const [isDepartmentHead, setIsDepartmentHead] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('staff_portal_token');
    if (!token) { setEmployee(null); setLoading(false); return; }
    try {
      const res = await staffFetch('/api/employee-portal/me');
      if (res.ok) {
        const data = await res.json();
        setEmployee({
          id: data.employee.id,
          employeeNumber: data.employee.employeeNumber,
          firstName: data.employee.firstName,
          lastName: data.employee.lastName,
          department: data.employee.department,
        });
        setMustSetPin(data.mustSetPin);
        setIsDepartmentHead(data.isDepartmentHead);
      } else {
        setEmployee(null);
      }
    } catch (e) {
      setEmployee(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (code: string, employeeNumber: string, credential: string) => {
    try {
      const res = await publicFetch('/api/employee-portal/login', {
        method: 'POST',
        body: JSON.stringify({ code, employee_number: employeeNumber, credential }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Login failed.' };
      localStorage.setItem('staff_portal_token', data.token);
      localStorage.setItem('staff_portal_code', code);
      setEmployee({ id: data.employee.id, employeeNumber: data.employee.employeeNumber, firstName: data.employee.firstName, lastName: data.employee.lastName });
      setMustSetPin(data.mustSetPin);
      await refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not reach the server. Check your connection.' };
    }
  };

  const setPin = async (pin: string) => {
    const res = await staffFetch('/api/employee-portal/auth/set-pin', { method: 'POST', body: JSON.stringify({ pin }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Could not set PIN.' };
    setMustSetPin(false);
    return { ok: true };
  };

  const logout = () => {
    localStorage.removeItem('staff_portal_token');
    setEmployee(null);
  };

  return (
    <StaffAuthContext.Provider value={{ employee, mustSetPin, isDepartmentHead, loading, login, setPin, logout, refresh }}>
      {children}
    </StaffAuthContext.Provider>
  );
}

export function useStaffAuth() {
  const ctx = useContext(StaffAuthContext);
  if (!ctx) throw new Error('useStaffAuth must be used within StaffAuthProvider');
  return ctx;
}

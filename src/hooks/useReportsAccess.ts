import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '@/api/apiClient';

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// This gate used to trust a bare sessionStorage flag with no server
// involvement at all — anyone could grant themselves access via devtools
// with `sessionStorage.setItem('reports_verified', 'true')`, no password
// required. It now verifies the server-signed step-up token issued by
// POST /api/auth/verify-password against POST /api/auth/verify-step-up, so
// possession of a valid, unexpired, user-matched token is what's actually
// checked. The underlying report data itself was always separately protected
// by role-based route access regardless of this gate.
export function useReportsAccess() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const clearAndRedirect = () => {
      sessionStorage.removeItem('reports_verified');
      sessionStorage.removeItem('reports_verified_at');
      sessionStorage.removeItem('reports_step_up_token');
      navigate('/reports');
    };

    const verify = async () => {
      const verifiedAt = sessionStorage.getItem('reports_verified_at');
      const stepUpToken = sessionStorage.getItem('reports_step_up_token');

      if (!stepUpToken || !verifiedAt) { clearAndRedirect(); return; }

      const elapsed = Date.now() - new Date(verifiedAt).getTime();
      if (elapsed > SESSION_TIMEOUT) { clearAndRedirect(); return; }

      try {
        const res = await authFetch('/api/auth/verify-step-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepUpToken }),
        });
        if (!cancelled && !res.ok) clearAndRedirect();
      } catch {
        if (!cancelled) clearAndRedirect();
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [navigate]);

  const exitReports = () => {
    sessionStorage.removeItem('reports_verified');
    sessionStorage.removeItem('reports_verified_at');
    sessionStorage.removeItem('reports_step_up_token');
    navigate('/dashboard');
  };

  return { exitReports };
}

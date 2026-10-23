import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { useStaffAuth } from '@/contexts/StaffAuthContext';
import { staffFetch } from '@/api/apiClient';
import { formatDateTime } from '@/lib/format';
import { Clock, CalendarDays, HandCoins, ClipboardCheck, Loader2, Bell, Wallet, CalendarRange } from 'lucide-react';

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = async () => {
    try {
      const res = await staffFetch('/api/employee-portal/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (e) { /* non-blocking */ }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const markRead = async (id: string) => {
    await staffFetch(`/api/employee-portal/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative p-2"
        style={{ minWidth: 44, minHeight: 44 }}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" style={{ color: '#14363C' }} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-destructive text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-72 max-h-96 overflow-y-auto bg-white border rounded-lg shadow-lg z-30">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.is_read && markRead(n.id)}
                  className="w-full text-left p-3 border-b last:border-b-0 block"
                  style={{ backgroundColor: n.is_read ? 'white' : '#F0FDFA' }}
                >
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.message && <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{formatDateTime(n.created_at)}</p>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The Employee Portal's own shell — deliberately NOT AppLayout. No HMIS
 * sidebar/topbar, mobile-first, bottom tab bar. Swaps the page's manifest
 * link to the portal's own scoped one and registers its own scoped service
 * worker while mounted, restoring the main app's manifest on unmount so a
 * browser tab that navigates back into the HMIS app isn't left thinking
 * it's still the Staff Portal.
 */
export default function StaffLayout() {
  const { employee, mustSetPin, isDepartmentHead, loading, logout } = useStaffAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const previousHref = link?.getAttribute('href');
    if (link) link.setAttribute('href', '/staff-manifest.webmanifest');

    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw-staff.js', { scope: '/staff' }).catch(() => {});
    }

    return () => {
      if (link && previousHref) link.setAttribute('href', previousHref);
    };
  }, []);

  useEffect(() => {
    if (!loading && !employee) navigate('/staff/login', { replace: true });
    else if (!loading && employee && mustSetPin) navigate('/staff/set-pin', { replace: true });
  }, [loading, employee, mustSetPin, navigate]);

  if (loading || !employee || mustSetPin) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs = [
    { to: '/staff', label: 'Home', icon: Clock, end: true },
    { to: '/staff/roster', label: 'Roster', icon: CalendarRange },
    { to: '/staff/leave', label: 'Leave', icon: CalendarDays },
    { to: '/staff/advances', label: 'Advances', icon: HandCoins },
    { to: '/staff/payroll', label: 'Payroll', icon: Wallet },
    ...(isDepartmentHead ? [{ to: '/staff/approvals', label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-3">
        <img src="/hjd-icon.png" alt="" className="w-8 h-8 rounded-lg" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate" style={{ color: '#14363C' }}>{employee.firstName} {employee.lastName}</p>
          <p className="text-xs text-muted-foreground truncate">{employee.employeeNumber}</p>
        </div>
        <NotificationBell />
        <button
          type="button"
          className="text-sm text-muted-foreground px-2 py-1"
          onClick={() => { logout(); navigate('/staff/login', { replace: true }); }}
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 pb-20 overflow-y-auto">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.end ? location.pathname === tab.to : location.pathname.startsWith(tab.to);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5"
              style={{ minHeight: 56, color: active ? '#077A84' : '#6b7280' }}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{tab.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePlatformAuth } from '@/contexts/PlatformAuthContext';
import { LayoutDashboard, Building2, Tag, Users, LogOut, Menu, X, UserPlus, FileText, Briefcase, CreditCard, CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

// Sibling to Sidebar.tsx, not a reuse of it — that component is tightly
// coupled to the tenant useAuth()/UserRole nav tree. This mirrors its exact
// visual spec (gradient, width, active/inactive classes, footer pattern) for
// the platform admin's much smaller nav.
interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/platform-admin', icon: LayoutDashboard },
  { label: 'Clients', href: '/platform-admin/clients', icon: Building2 },
  { label: 'Customers', href: '/platform-admin/customers', icon: UserPlus },
  { label: 'Quotations', href: '/platform-admin/quotations', icon: FileText },
  { label: 'Invoices', href: '/platform-admin/invoices', icon: CreditCard },
  { label: 'Demo Bookings', href: '/platform-admin/demo-bookings', icon: CalendarCheck },
  { label: 'Plans', href: '/platform-admin/plans', icon: Tag },
  { label: 'Users', href: '/platform-admin/users', icon: Users },
  { label: 'Company Profile', href: '/platform-admin/company-profile', icon: Briefcase },
];

interface PlatformSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const PlatformSidebar: React.FC<PlatformSidebarProps> = ({ isOpen, onToggle }) => {
  const { admin, signOut } = usePlatformAuth();
  const location = useLocation();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-64 bg-gradient-to-b from-[#3D8A97] via-[#2d6a75] to-[#1e4d57] text-sidebar-foreground transition-transform duration-300 lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-3 py-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <img src="/hjd.png" alt="IntelliCare Logo" className="h-20 w-auto object-contain" />
            </div>
            <button onClick={onToggle} className="lg:hidden p-2 rounded-sm hover:bg-sidebar-accent">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-3 py-3 border-b border-sidebar-border bg-sidebar-accent/30">
            <span className="text-xs uppercase tracking-wide text-sidebar-foreground/60">Platform Admin</span>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              // Exact match for the dashboard root — otherwise every other
              // platform-admin route would also satisfy startsWith('/platform-admin/').
              const isActive = item.href === '/platform-admin'
                ? location.pathname === item.href
                : location.pathname === item.href || location.pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => window.innerWidth < 1024 && onToggle()}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-sm",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="px-3 py-3 border-t border-sidebar-border">
            <div className="flex items-center gap-3 mb-4 p-2 rounded-sm">
              <div className="w-9 h-9 rounded-sm bg-sidebar-accent flex items-center justify-center">
                <span className="font-semibold text-sm">
                  {admin?.name?.charAt(0).toUpperCase() || 'A'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate leading-tight">{admin?.name}</p>
                <p className="text-xs text-sidebar-foreground/60 truncate leading-tight">{admin?.email}</p>
              </div>
            </div>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export const PlatformMobileHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { admin } = usePlatformAuth();
  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b border-border h-16 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="p-2 hover:bg-accent rounded-md">
          <Menu className="w-6 h-6" />
        </button>
        <span className="font-semibold">Platform Admin</span>
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-xs font-semibold text-primary">
            {admin?.name?.charAt(0).toUpperCase() || 'A'}
          </span>
        </div>
      </div>
    </header>
  );
};

export const PlatformTopBar: React.FC = () => {
  const { admin } = usePlatformAuth();
  if (!admin) return null;
  return (
    <header className="hidden lg:flex fixed top-0 left-64 right-0 z-30 h-14 items-center justify-between px-4 bg-background border-b border-border">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Signed in as</span>
        <span className="text-sm font-semibold text-foreground">{admin.name}</span>
        <span className="text-xs text-muted-foreground">{admin.email}</span>
      </div>
    </header>
  );
};

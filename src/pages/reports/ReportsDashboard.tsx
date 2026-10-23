import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useReportsAccess } from '@/hooks/useReportsAccess';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import {
  Package, Stethoscope, Truck, Landmark, Scissors, Users,
  LogOut, ChevronRight, Search, PanelLeftClose, PanelLeft, Shield,
  TrendingUp, LayoutDashboard, ShieldCheck, FileSpreadsheet,
} from 'lucide-react';

// Patient Report (and the Patients & Billing group it was alone in) removed
// per request. Clinical/Inventory/Financial/Administration keep their
// entries but lose their section header (hideLabel) — only Ministry of
// Health still shows a label.
const REPORT_GROUPS = [
  { label: 'Overview', color: 'text-white' },
  { label: 'Clinical', color: 'text-white', hideLabel: true },
  { label: 'Inventory', color: 'text-white', hideLabel: true },
  { label: 'Financial', color: 'text-white', hideLabel: true },
  { label: 'Human Resources', color: 'text-white' },
  { label: 'Ministry of Health', color: 'text-white' },
  { label: 'Administration', color: 'text-white', hideLabel: true },
];

const REPORT_CATEGORIES = [
  { id: 'overview', label: 'Dashboard Overview', icon: LayoutDashboard, desc: 'Hospital-wide analytics at a glance', group: 'Overview' },
  { id: 'clinical', label: 'Clinical Reports', icon: Stethoscope, desc: 'Registers, workload, morbidity, inpatient/outpatient', group: 'Clinical' },
  { id: 'theatre', label: 'Theatre Report', icon: Scissors, desc: 'Operations, outcomes, and team fee payouts', group: 'Clinical' },
  { id: 'inventory', label: 'Inventory Report', icon: Package, desc: 'Full stock & valuation', group: 'Inventory' },
  { id: 'revenue', label: 'Revenue Report', icon: TrendingUp, desc: 'Collections by user, department, scheme, or branch', group: 'Financial' },
  { id: 'procurement', label: 'Procurement Report', icon: Truck, desc: 'Supplier bills, A/P aging, consultant bills, purchases', group: 'Financial' },
  { id: 'accounting', label: 'Accounting Reports', icon: Landmark, desc: 'Trial balance, income statement, balance sheet, GL, expenses', group: 'Financial' },
  { id: 'workforce', label: 'Workforce Reports', icon: Users, desc: 'Attendance, leave, salary advances, and payroll', group: 'Human Resources' },
  { id: 'dhis2', label: 'DHIS2 Report', icon: FileSpreadsheet, desc: 'Monthly HMIS facility report', group: 'Ministry of Health' },
  { id: 'audit-summary', label: 'Staff Activity / Audit Log', icon: ShieldCheck, desc: 'Who did what, and when', group: 'Administration' },
];

export default function ReportsDashboard() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const { exitReports } = useReportsAccess();
  const [searchTerm, setSearchTerm] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const filteredCategories = REPORT_CATEGORIES.filter(cat =>
    cat.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const currentCategory = REPORT_CATEGORIES.find(cat =>
    location.pathname.includes(cat.id)
  );

  const handleLogoutReports = async () => {
    if (await confirm({ description: 'Exit reports section?' })) {
      exitReports();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 print:block">
      {confirmDialog}
      {/* Sidebar */}
      <div className={`print:hidden ${sidebarOpen ? 'w-64' : 'w-[68px]'} bg-gradient-to-b from-[#3D8A97] via-[#2d6a75] to-[#1e4d57] text-white transition-all duration-300 flex flex-col flex-shrink-0`}>
        {/* Logo/Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/hjd.png" alt="IntelliCare Logo" className="h-9 w-auto object-contain flex-shrink-0" />
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="font-bold text-sm text-white truncate">IntelliCare</p>
                <p className="text-xs text-white/80 uppercase tracking-widest">Reports Center</p>
              </div>
            )}
          </div>
        </div>

        {/* Search */}
        {sidebarOpen && (
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-white/60" />
              <Input
                placeholder="Search reports..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:bg-white/10 focus:border-white/50"
              />
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2">
          {REPORT_GROUPS.map(group => {
            const cats = filteredCategories.filter(c => c.group === group.label);
            if (cats.length === 0) return null;
            return (
              <div key={group.label} className="mb-2">
                {sidebarOpen && !(group as any).hideLabel && (
                  <p className={`text-xs uppercase tracking-widest font-semibold px-3 pt-3 pb-1 ${group.color}`}>
                    {group.label}
                  </p>
                )}
                {cats.map(category => {
                  const Icon = category.icon;
                  const isActive = location.pathname.includes(category.id);
                  return (
                    <button
                      key={category.id}
                      onClick={() => navigate((category as any).external || `/reports/dashboard/${category.id}`)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 group ${
                        isActive
                          ? 'bg-white/10 text-white border border-white/20'
                          : 'text-white hover:bg-white/10 border border-transparent'
                      }`}
                      title={category.label}
                    >
                      <Icon className={`h-4 w-4 flex-shrink-0 text-white`} />
                      {sidebarOpen && (
                        <>
                          <span className="flex-1 text-left text-sm truncate">{category.label}</span>
                          {isActive && <ChevronRight className="h-3.5 w-3.5 text-white/60 flex-shrink-0" />}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-white/10 space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Shield className="h-3.5 w-3.5 text-white" />
            {sidebarOpen && <span className="text-xs text-white">Secure Session Active</span>}
          </div>
          <Button
            variant="ghost"
            onClick={handleLogoutReports}
            className="w-full gap-2 text-white hover:bg-white/10 h-9 text-xs justify-start"
          >
            <LogOut className="h-4 w-4" />
            {sidebarOpen && 'Exit Reports'}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Bar */}
        <div className="print:hidden bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600"
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
            <div>
              <h1 className="text-lg font-bold text-heading">
                {currentCategory?.label || 'Reports Dashboard'}
              </h1>
              <p className="text-xs text-gray-500">
                {currentCategory?.desc || 'Comprehensive analytics and reporting'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 hidden sm:inline">IntelliCare Reports</span>
          </div>
        </div>

        {/* Report Content */}
        <div className="flex-1 overflow-auto p-6 bg-primary/20 print:overflow-visible print:p-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

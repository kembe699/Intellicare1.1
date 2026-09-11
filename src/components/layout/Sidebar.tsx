import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Stethoscope,
  Pill,
  FlaskConical,
  BarChart3,
  Settings,
  LogOut,
  Activity,
  Menu,
  X,
  ChevronDown,
  TestTube,
  Shield,
  ShieldCheck,
  Wrench,
  Receipt,
  FileSignature,
  FileText,
  Wallet,
  BookOpen,
  Clock,
  ShoppingCart,
  Building2,
  Package,
  Hospital,
  Calculator,
  FileSpreadsheet,
  ClipboardList,
  PiggyBank,
  TrendingUp,
  ArrowRightLeft,
  Truck,
  DollarSign,
  Warehouse,
  MapPin,
  Briefcase,
  ClipboardCheck,
  FileBarChart,
  Tag,
  BedDouble,
  DoorOpen,
  LogIn,
  Key
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { authFetch } from '@/api/apiClient';
import { Combobox } from '@/components/ui/combobox';

// privilege keys are from src/server/config/permissionsCatalog.js — the same
// keys the backend's authorize() checks (src/server/middleware/authorize.js),
// via useAuth().hasPrivilege(). A section's own visibility is no longer a
// separate role list (that's what let it drift from its children — e.g. a
// section shown to a role none of whose children were ever visible to) — it's
// derived below as "does at least one of this dropdown's items pass".
interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  privilege: string | string[];
}

interface NavDropdown {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, privilege: 'pages.dashboard.view' },
  { label: 'Patient Registry', href: '/lis/registration', icon: Users, privilege: 'pages.lis_registration.view' },
  { label: 'Clinical', href: '/lis/orders', icon: Stethoscope, privilege: 'lis.clinical.read' },
  { label: 'Queue Display', href: '/lis/queue', icon: Users, privilege: 'lis.queue.write' },
  { label: 'Triage', href: '/triage', icon: Activity, privilege: 'lis.triage.write' },
  // "Laboratory" (legacy /laboratory page) intentionally removed — it's a
  // disconnected, effectively-unused parallel system (lab_requests/lab_results
  // are nearly empty and stuck in pending/partial; the LIS Module dropdown
  // below is where real specimen/result activity happens). Redirected at the
  // route level in App.tsx rather than deleted, so old links still resolve.
  { label: 'Reports', href: '/reports', icon: BarChart3, privilege: 'pages.reports.view' },
];


const pharmacyDropdown: NavDropdown = {
  label: 'Pharmacy',
  icon: Pill,
  items: [
    { label: 'Prescriptions', href: '/pharmacy-prescriptions', icon: ClipboardList, privilege: 'pharmacy.prescribe' },
    { label: 'Dispensing', href: '/pharmacy-dispensing', icon: Pill, privilege: 'pharmacy.write' },
    { label: 'Returns', href: '/pharmacy-returns', icon: ArrowRightLeft, privilege: 'pharmacy.write' },
  ]
};

const procurementDropdown: NavDropdown = {
  label: 'Procurement',
  icon: ShoppingCart,
  items: [
    { label: 'Suppliers', href: '/procurement/suppliers-mgmt', icon: Building2, privilege: 'procurement.read' },
    { label: 'Requisitions', href: '/procurement/requisitions', icon: ClipboardList, privilege: 'pages.procurement_requisitions.view' },
    { label: 'Purchase Orders', href: '/procurement/purchase-orders', icon: ShoppingCart, privilege: 'procurement.purchase_orders.write' },
    { label: 'Goods Receipt', href: '/procurement/goods-receipt', icon: Truck, privilege: ['procurement.write', 'pharmacy.write'] },
    { label: 'Daily Expenses', href: '/procurement/daily-expenses', icon: DollarSign, privilege: 'expenses.write' },
    { label: 'Reports', href: '/procurement/reports', icon: BarChart3, privilege: 'procurement.read' },
  ]
};

const patientsBillDropdown: NavDropdown = {
  label: 'Patients Bill',
  icon: Receipt,
  items: [
    { label: 'Patient Bills', href: '/patients-bill', icon: Receipt, privilege: 'pages.patients_bill.view' },
    { label: 'Proforma Invoice', href: '/proforma-invoices', icon: FileSignature, privilege: 'proforma.write' },
    { label: 'Receipts', href: '/receipts', icon: FileText, privilege: 'receipts.write' },
    { label: 'Invoices', href: '/invoices', icon: FileBarChart, privilege: 'invoices.write' },
  ]
};

const accountingDropdown: NavDropdown = {
  label: 'Accounting',
  icon: Calculator,
  items: [
    { label: 'Chart of Accounts', href: '/accounting/chart-of-accounts', icon: FileSpreadsheet, privilege: 'accounting.write' },
    { label: 'General Ledger', href: '/accounting/general-ledger', icon: BookOpen, privilege: 'accounting.read' },
    { label: 'Journal Entries', href: '/accounting/journal-entries', icon: ClipboardList, privilege: 'accounting.write' },
    { label: 'Receivables', href: '/accounting/receivables', icon: PiggyBank, privilege: 'accounting.read' },
    { label: 'Financial Reports', href: '/accounting/reports', icon: TrendingUp, privilege: 'accounting.read' },
    { label: 'Exchange Rates', href: '/accounting/exchange-rates', icon: ArrowRightLeft, privilege: 'accounting.rates.write' },
    { label: 'Cash Transfer', href: '/accounting/cash-transfer', icon: Wallet, privilege: 'cash_transfers.write' },
    { label: 'Billing Management', href: '/billing-management', icon: FileSpreadsheet, privilege: 'billing.write' },
    { label: 'Schemes & Pricing', href: '/scheme-management', icon: Tag, privilege: 'schemes.write' },
    { label: 'Cashier Shift', href: '/cashier/shift', icon: Clock, privilege: 'cashier.write' },
  ]
};

const inventoryDropdown: NavDropdown = {
  label: 'Inventory',
  icon: Warehouse,
  items: [
    { label: 'Item Master', href: '/inventory/items', icon: Package, privilege: 'inventory.read' },
    { label: 'Stock Locations', href: '/inventory/locations', icon: MapPin, privilege: 'inventory.read' },
    { label: 'Transactions', href: '/inventory/transactions', icon: ArrowRightLeft, privilege: 'inventory.read' },
    { label: 'Batch Tracking', href: '/inventory/batches', icon: Clock, privilege: 'inventory.write' },
    { label: 'Physical Counts', href: '/inventory/physical-counts', icon: ClipboardCheck, privilege: 'inventory.read' },
    { label: 'Valuation & COGS', href: '/inventory/valuation', icon: DollarSign, privilege: ['inventory.adjustments.approve', 'inventory.read'] },
  ]
};

const lisDropdown: NavDropdown = {
  label: 'LIS Module',
  icon: FlaskConical,
  items: [
    { label: 'Specimen Collection', href: '/lis/collection', icon: Activity, privilege: 'lis.results.read' },
    { label: 'Results Entry', href: '/lis/results-entry', icon: FileSpreadsheet, privilege: 'lis.specimen.write' },
    { label: 'Manager Review', href: '/lis/review', icon: ClipboardCheck, privilege: 'lis.results.review' },
  ]
};

const inpatientDropdown: NavDropdown = {
  label: 'Inpatient',
  icon: BedDouble,
  items: [
    { label: 'Admissions', href: '/inpatient/admissions', icon: LogIn, privilege: 'inpatient.admissions.write' },
    { label: 'Admitted Patients', href: '/inpatient/patients', icon: Users, privilege: 'inpatient.admissions.write' },
  ]
};

const setupDropdown: NavDropdown = {
  label: 'Setup',
  icon: Settings,
  items: [
    { label: 'Lab Tests', href: '/setup/lab-tests', icon: TestTube, privilege: 'pages.setup_lab_tests.view' },
    { label: 'Services', href: '/setup/services', icon: Wrench, privilege: 'clinical.services.manage' },
    { label: 'Departments', href: '/setup/departments', icon: Briefcase, privilege: 'pages.setup_departments.view' },
    { label: 'Clinics', href: '/setup/clinics', icon: Stethoscope, privilege: 'pages.setup_clinics.view' },
    { label: 'Facility', href: '/setup/facility', icon: Hospital, privilege: 'pages.setup_facility.view' },
    { label: 'Wards', href: '/setup/wards', icon: Building2, privilege: 'pages.setup_wards.view' },
    { label: 'Rooms', href: '/setup/rooms', icon: DoorOpen, privilege: 'pages.setup_rooms.view' },
    { label: 'API Configurations', href: '/setup/api-configurations', icon: Key, privilege: 'setup.api_configurations.manage' },
    { label: 'Security', href: '/setup/security', icon: Shield, privilege: 'pages.security.access' },
    { label: 'Approvals', href: '/setup/approvals', icon: ShieldCheck, privilege: 'approvals.manage' },
  ]
};

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const location = useLocation();
  const { user, signOut, updateCurrentRoom, hasPrivilege } = useAuth();
  const [consultationRooms, setConsultationRooms] = useState<{ id: string; room_number: string }[]>([]);
  const [savingRoom, setSavingRoom] = useState(false);
  const [setupOpen, setSetupOpen] = useState(location.pathname.startsWith('/setup'));
  const [patientsBillOpen, setPatientsBillOpen] = useState(
    location.pathname.startsWith('/patients-bill') ||
    location.pathname.startsWith('/receipts') ||
    location.pathname.startsWith('/invoices') ||
    location.pathname.startsWith('/proforma-invoices')
  );
  const [pharmacyOpen, setPharmacyOpen] = useState(location.pathname.startsWith('/pharmacy'));
  const [procurementOpen, setProcurementOpen] = useState(location.pathname.startsWith('/procurement'));
  const [accountingOpen, setAccountingOpen] = useState(location.pathname.startsWith('/accounting') || location.pathname.startsWith('/scheme-management') || location.pathname.startsWith('/cashier/shift'));
  const [inventoryOpen, setInventoryOpen] = useState(location.pathname.startsWith('/inventory'));
  const [lisOpen, setLisOpen] = useState(lisDropdown.items.some(item => location.pathname.startsWith(item.href)));
  const [inpatientOpen, setInpatientOpen] = useState(location.pathname.startsWith('/inpatient'));
  const [pendingRxCount, setPendingRxCount] = useState(0);

  // Fetch pending prescription count for pharmacy badge
  useEffect(() => {
    const fetchPendingRx = async () => {
      try {
        const clinicId = user?.clinic || 1;
        const [clinicalRes, pharmacyRes] = await Promise.all([
          authFetch(`/api/pharmacy-module/clinical-prescriptions?clinic_id=${clinicId}&status=active`),
          authFetch(`/api/pharmacy-module/prescriptions?clinic_id=${clinicId}&status=pending,partial_dispensed`)
        ]);
        let count = 0;
        if (clinicalRes.ok) { const data = await clinicalRes.json(); count += Array.isArray(data) ? data.length : 0; }
        if (pharmacyRes.ok) { const data = await pharmacyRes.json(); count += Array.isArray(data) ? data.length : 0; }
        setPendingRxCount(count);
      } catch (e) { /* silent */ }
    };
    if (hasPrivilege('pharmacy.prescribe')) {
      fetchPendingRx();
      const interval = setInterval(fetchPendingRx, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.clinic, user?.role]);

  // Fetch consultation rooms for the doctor's "current room" picker
  useEffect(() => {
    const fetchConsultationRooms = async () => {
      try {
        const clinicId = user?.clinic || 1;
        const res = await authFetch(`/api/inpatient/rooms?clinic_id=${clinicId}`);
        if (res.ok) {
          const rooms = await res.json();
          setConsultationRooms(rooms.filter((r: any) => r.room_type === 'consultation'));
        }
      } catch (e) { /* silent */ }
    };
    if (user?.role === 'doctor') {
      fetchConsultationRooms();
    }
  }, [user?.clinic, user?.role]);

  const handleRoomChange = async (roomId: string) => {
    setSavingRoom(true);
    try {
      await updateCurrentRoom(roomId || null);
    } catch (e) {
      console.error('Failed to update current room', e);
    } finally {
      setSavingRoom(false);
    }
  };

  const filteredNavItems = navItems.filter(item => hasPrivilege(item.privilege));

  // A dropdown section shows if the user can actually use at least one of its
  // items — derived from the same per-item privilege checks used to filter
  // them below, rather than a separate section-level role list that could
  // (and did) drift from what its children actually allow.
  const dropdownVisible = (dropdown: NavDropdown) => dropdown.items.some(item => hasPrivilege(item.privilege));

  const showSetup = dropdownVisible(setupDropdown);
  const showPatientsBill = dropdownVisible(patientsBillDropdown);
  const showPharmacy = dropdownVisible(pharmacyDropdown);
  const showLIS = dropdownVisible(lisDropdown);
  const showProcurement = dropdownVisible(procurementDropdown);
  const showAccounting = dropdownVisible(accountingDropdown);
  const showInventory = dropdownVisible(inventoryDropdown);
  const showInpatient = dropdownVisible(inpatientDropdown);
  const hasNavLink = (href: string) => filteredNavItems.some(i => i.href === href);

  // A section label (e.g. "CLINICAL WORKFLOW") should never render on its own with nothing
  // visible underneath it — that reads as "you almost have access" to a role that has none.
  // Each flag mirrors exactly the set of items rendered under that heading below.
  const showClinicalWorkflowSection = !!(hasNavLink('/lis/registration') || hasNavLink('/lis/queue') || hasNavLink('/lis/orders') || hasNavLink('/triage') || showInpatient || showLIS || showPharmacy);
  const showBillingFinanceSection = !!(showPatientsBill || showAccounting);
  const showSupplyChainSection = !!(showInventory || showProcurement);
  const showAnalyticsAdminSection = !!(hasNavLink('/reports') || showSetup);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-foreground/20 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <aside className={cn(
        "fixed top-0 left-0 z-50 h-full w-64 bg-gradient-to-b from-[#3D8A97] via-[#2d6a75] to-[#1e4d57] text-sidebar-foreground transition-transform duration-300 lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Header — the logo's own white ground carried across the full width of
              the panel, and sitting flush with the top of it. Padded and centred
              on the teal gradient, the artwork read as a pale card floating on the
              sidebar rather than as the header of it. */}
          <div className="relative flex items-center justify-center px-3 pt-0 pb-2 border-b border-sidebar-border bg-white">
            <img src="/hjd.png" alt="IntelliCare Logo" className="h-20 w-auto object-contain" />
            <button
              onClick={onToggle}
              aria-label="Close menu"
              className="lg:hidden absolute right-2 top-2 p-2 rounded-sm text-[#1e4d57] hover:bg-black/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {user && (
            <div className="px-3 py-3 border-b border-sidebar-border bg-sidebar-accent/30">
              {user.role === 'doctor' && (
                <div className="rounded-sm border border-sidebar-border px-3 py-2 bg-sidebar/60 mt-2">
                  <div className="text-[10px] uppercase tracking-wide text-sidebar-foreground/60">Current Room</div>
                  <Combobox
                    options={consultationRooms.map((room) => ({ value: room.id, label: room.room_number }))}
                    value={user.currentRoomId || ''}
                    onChange={handleRoomChange}
                    disabled={savingRoom}
                    placeholder="-- Select room --"
                    searchPlaceholder="Search rooms..."
                    className="mt-2 w-full h-8 text-[12px]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {/* ── Helper to render a single flat nav link ── */}
            {(() => {
              const renderNavLink = (href: string) => {
                const item = filteredNavItems.find(i => i.href === href);
                if (!item) return null;
                const Icon = item.icon;
                const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => window.innerWidth < 1024 && onToggle()}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[13px]",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="font-medium leading-none">{item.label}</span>
                  </Link>
                );
              };

              const sectionLabel = (label: string) => (
                <p key={label} className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">
                  {label}
                </p>
              );

              return (
                <>
                  {/* ── 1. Dashboard ── */}
                  {renderNavLink('/dashboard')}

                  {/* ══ CLINICAL WORKFLOW SECTION — mirrors the patient journey: register → queue → see doctor → admit/diagnose/dispense ══ */}
                  {showClinicalWorkflowSection && sectionLabel('Clinical Workflow')}

                  {/* 2. Patient Registry (flat link) */}
                  {renderNavLink('/lis/registration')}

                  {/* 2.1 Queue Display (flat link) — patient waits here after registration, before being seen */}
                  {renderNavLink('/lis/queue')}

                  {/* 2.2 Triage (flat link) — nurse records vitals on a queued patient before the doctor sees them */}
                  {renderNavLink('/triage')}

                  {/* 3. Clinical (flat link) — the doctor's encounter */}
                  {renderNavLink('/lis/orders')}

                  {/* 4. Inpatient */}
                  {showInpatient && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setInpatientOpen(!inpatientOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          location.pathname.startsWith('/inpatient')
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <BedDouble className="w-4 h-4" />
                          <span className="font-medium leading-none">Inpatient</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", inpatientOpen && "rotate-180")} />
                      </button>
                      {inpatientOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {inpatientDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 5. Laboratory — hidden from sidebar; page/route still live */}

                  {/* 5.1 LIS Module */}
                  {showLIS && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setLisOpen(!lisOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          lisDropdown.items.some(item => location.pathname.startsWith(item.href))
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <FlaskConical className="w-4 h-4" />
                          <span className="font-medium leading-none">{lisDropdown.label}</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", lisOpen && "rotate-180")} />
                      </button>
                      {lisOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {lisDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname.startsWith(item.href);
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 5.2 Pharmacy — dispensing follows on from a Clinical prescription, so it stays in the patient-journey section */}
                  {showPharmacy && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setPharmacyOpen(!pharmacyOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          location.pathname.startsWith('/pharmacy')
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Pill className="w-4 h-4" />
                          <span className="font-medium leading-none">Pharmacy</span>
                          {pendingRxCount > 0 && (
                            <span className="ml-auto mr-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                              {pendingRxCount}
                            </span>
                          )}
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", pharmacyOpen && "rotate-180")} />
                      </button>
                      {pharmacyOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {pharmacyDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                                {item.href === '/pharmacy-prescriptions' && pendingRxCount > 0 && (
                                  <span className="ml-auto flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{pendingRxCount}</span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══ BILLING & FINANCE SECTION ══ */}
                  {showBillingFinanceSection && sectionLabel('Billing & Finance')}

                  {/* 6. Patients Bill */}
                  {showPatientsBill && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setPatientsBillOpen(!patientsBillOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          (location.pathname.startsWith('/patients-bill') || location.pathname.startsWith('/receipts') || location.pathname.startsWith('/invoices') || location.pathname.startsWith('/proforma-invoices'))
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Receipt className="w-4 h-4" />
                          <span className="font-medium leading-none">Patients Bill</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", patientsBillOpen && "rotate-180")} />
                      </button>
                      {patientsBillOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {patientsBillDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 7. Accounting */}
                  {showAccounting && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setAccountingOpen(!accountingOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          (location.pathname.startsWith('/accounting') || location.pathname.startsWith('/billing-management') || location.pathname.startsWith('/scheme-management') || location.pathname.startsWith('/accounts') || location.pathname.startsWith('/cashier'))
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Calculator className="w-4 h-4" />
                          <span className="font-medium leading-none">Accounting</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", accountingOpen && "rotate-180")} />
                      </button>
                      {accountingOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {accountingDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══ SUPPLY CHAIN SECTION ══ */}
                  {showSupplyChainSection && sectionLabel('Supply Chain')}

                  {/* 8. Inventory */}
                  {showInventory && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setInventoryOpen(!inventoryOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          location.pathname.startsWith('/inventory')
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Warehouse className="w-4 h-4" />
                          <span className="font-medium leading-none">Inventory</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", inventoryOpen && "rotate-180")} />
                      </button>
                      {inventoryOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {inventoryDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 9. Procurement */}
                  {showProcurement && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setProcurementOpen(!procurementOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          location.pathname.startsWith('/procurement')
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <ShoppingCart className="w-4 h-4" />
                          <span className="font-medium leading-none">Procurement</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", procurementOpen && "rotate-180")} />
                      </button>
                      {procurementOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {procurementDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══ ANALYTICS & ADMIN ══ */}
                  {showAnalyticsAdminSection && sectionLabel('Analytics & Admin')}

                  {/* 10. Reports */}
                  {renderNavLink('/reports')}

                  {/* 11. Setup */}
                  {showSetup && (
                    <div className="pt-0.5">
                      <button
                        onClick={() => setSetupOpen(!setupOpen)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 rounded-sm transition-colors text-[13px]",
                          location.pathname.startsWith('/setup')
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Settings className="w-4 h-4" />
                          <span className="font-medium leading-none">Setup</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 transition-transform", setupOpen && "rotate-180")} />
                      </button>
                      {setupOpen && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                          {setupDropdown.items.filter(item => hasPrivilege(item.privilege)).map((item) => {
                            const Icon = item.icon;
                            const isActive = location.pathname === item.href;
                            return (
                              <Link key={item.href} to={item.href} onClick={() => window.innerWidth < 1024 && onToggle()}
                                className={cn("flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-[12px]",
                                  isActive ? "bg-sidebar-accent text-sidebar-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className="w-4 h-4" /><span>{item.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </nav>

          {/* User section */}
          <div className="px-3 py-3 border-t border-sidebar-border">
            <Link
              to="/profile"
              onClick={() => window.innerWidth < 1024 && onToggle()}
              className="flex items-center gap-3 mb-4 p-2 rounded-sm hover:bg-sidebar-accent transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-sm bg-sidebar-accent flex items-center justify-center">
                <span className="font-semibold text-[13px]">
                  {user?.displayName?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[13px] truncate leading-tight">{user?.displayName}</p>
                {/* user.clinic is the clinic's id, so this read "admin • 6" —
                    a bare number with no meaning to the person reading it. The
                    branch is the context that actually matters here, and it is
                    already named at the top of the page, so the role stands on
                    its own. */}
                <p className="text-[11px] text-sidebar-foreground/60 capitalize leading-tight">{user?.role}</p>
              </div>
            </Link>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors text-[13px]"
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

export const MobileHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { user } = useAuth();
  
  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b border-border h-16 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <button onClick={onMenuClick} className="p-2 hover:bg-accent rounded-md">
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-semibold">IntelliCare</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-xs font-semibold text-primary">
            {user?.displayName?.charAt(0).toUpperCase() || 'U'}
          </span>
        </div>
      </div>
    </header>
  );
};

// Desktop top bar — shows the current branch + admin/role status that used to live in the
// sidebar, and the branch switcher for multi-branch users. Sits above the main content area,
// to the right of the fixed sidebar.
export const TopBar: React.FC = () => {
  const { user, currentBranchId, switchBranch } = useAuth();

  if (!user) return null;

  const currentBranch = user.accessibleBranches?.find(branch => branch.id === currentBranchId)
    || user.accessibleBranches?.find(branch => branch.isPrimary)
    || user.accessibleBranches?.[0]
    || null;

  return (
    <header className="hidden lg:flex fixed top-0 left-64 right-0 z-30 h-14 items-center justify-between px-4 bg-background border-b border-border">
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Current Branch</span>
        <span className="text-sm font-semibold text-foreground">
          {currentBranch?.name || user.primaryBranchName || 'All Branches'}
        </span>
        <span className="text-xs text-muted-foreground">
          {user.isAdmin ? 'Admin access enabled' : `Role: ${user.role}`}
        </span>
      </div>
      {user.accessibleBranches && user.accessibleBranches.length > 1 && (
        <Combobox
          options={user.accessibleBranches.map((branch) => ({ value: String(branch.id), label: `${branch.name}${branch.isPrimary ? ' (Primary)' : ''}` }))}
          value={String(currentBranchId || '')}
          onChange={(v) => switchBranch(parseInt(v, 10))}
          searchPlaceholder="Search branches..."
          className="w-48 h-8 text-xs"
        />
      )}
    </header>
  );
};

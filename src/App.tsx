import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PlatformAuthProvider, usePlatformAuth } from "@/contexts/PlatformAuthContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { DatabaseProvider } from "@/contexts/DatabaseContext.browser";
import { UserRole } from "@/types";
import { Loader2 } from "lucide-react";

const PlatformLogin = lazy(() => import('./pages/platform/PlatformLogin'));
const PlatformDashboard = lazy(() => import('./pages/platform/PlatformDashboard'));
const PlatformClients = lazy(() => import('./pages/platform/PlatformClients'));
const PlatformClientDetail = lazy(() => import('./pages/platform/PlatformClientDetail'));
const PlatformPlans = lazy(() => import('./pages/platform/PlatformPlans'));
const PlatformUsers = lazy(() => import('./pages/platform/PlatformUsers'));

const Login = lazy(() => import('./pages/Login'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PatientVisitsHistory = lazy(() => import('./pages/PatientVisitsHistory'));
const PatientsBill = lazy(() => import('./pages/PatientsBill'));
const ProformaInvoice = lazy(() => import('./pages/ProformaInvoice'));
const BillDetails = lazy(() => import('./pages/BillDetails'));
const BillingManagement = lazy(() => import('./pages/BillingManagement'));
const ClaimDetails = lazy(() => import('./pages/ClaimDetails'));
const SchemeManagement = lazy(() => import('./pages/SchemeManagement'));
const Receipts = lazy(() => import('./pages/Receipts'));
const LISRegistration = lazy(() => import('./pages/lis/LISRegistration'));
const LISTestOrders = lazy(() => import('./pages/lis/LISTestOrders'));
const LISQueue = lazy(() => import('./pages/lis/LISQueue'));
const Triage = lazy(() => import('./pages/lis/Triage'));
const LISCollection = lazy(() => import('./pages/lis/LISCollection'));
const LISResultsEntry = lazy(() => import('./pages/lis/LISResultsEntry'));
const LISManagerReview = lazy(() => import('./pages/lis/LISManagerReview'));
const LabTests = lazy(() => import('./pages/setup/LabTests'));
const Services = lazy(() => import('./pages/setup/Services'));
const Departments = lazy(() => import('./pages/setup/Departments'));
const Clinics = lazy(() => import('./pages/setup/Clinics'));
const ApiConfigurations = lazy(() => import('./pages/setup/ApiConfigurations'));
const Security = lazy(() => import('./pages/setup/Security'));
const Approvals = lazy(() => import('./pages/setup/Approvals'));
const FacilitySetup = lazy(() => import('./pages/setup/FacilitySetup'));
const AccountingCashTransfer = lazy(() => import('./pages/accounting/CashTransfer'));
const CashierShift = lazy(() => import('./pages/cashier/CashierShift'));
const PurchaseOrders = lazy(() => import('./pages/procurement/PurchaseOrders'));
const DailyExpenses = lazy(() => import('./pages/procurement/DailyExpenses'));
const ExpenseDetail = lazy(() => import('./pages/procurement/ExpenseDetail'));
const SuppliersManagement = lazy(() => import('./pages/procurement/SuppliersManagement'));
const PurchaseRequisitions = lazy(() => import('./pages/procurement/PurchaseRequisitions'));
const GoodsReceiptNotes = lazy(() => import('./pages/procurement/GoodsReceiptNotes'));
const ProcurementReports = lazy(() => import('./pages/procurement/ProcurementReports'));
const Profile = lazy(() => import('./pages/Profile'));
const ChartOfAccounts = lazy(() => import('./pages/accounting/ChartOfAccounts'));
const GeneralLedger = lazy(() => import('./pages/accounting/GeneralLedger'));
const JournalEntriesPage = lazy(() => import('./pages/accounting/JournalEntries'));
const ReceivablesPage = lazy(() => import('./pages/accounting/Receivables'));
const FinancialReports = lazy(() => import('./pages/accounting/FinancialReports'));
const ExchangeRatesPage = lazy(() => import('./pages/accounting/ExchangeRates'));
const SetupPassword = lazy(() => import('./pages/SetupPassword'));
const ItemMaster = lazy(() => import('./pages/inventory/ItemMaster'));
const StockLocations = lazy(() => import('./pages/inventory/StockLocations'));
const StockTransactions = lazy(() => import('./pages/inventory/StockTransactions'));
const BatchTracking = lazy(() => import('./pages/inventory/BatchTracking'));
const PhysicalCounts = lazy(() => import('./pages/inventory/PhysicalCounts'));
const ValuationCOGS = lazy(() => import('./pages/inventory/ValuationCOGS'));
const PrescriptionManagement = lazy(() => import('./pages/pharmacyModule/PrescriptionManagement'));
const DispensingWorkflow = lazy(() => import('./pages/pharmacyModule/DispensingWorkflow'));
const PharmacyReturns = lazy(() => import('./pages/pharmacyModule/PharmacyReturns'));
const Invoices = lazy(() => import('./pages/Invoices'));
const PasswordVerification = lazy(() => import('./pages/reports/PasswordVerification'));
const ReportsDashboard = lazy(() => import('./pages/reports/ReportsDashboard'));
const RptPatients = lazy(() => import('./pages/reports/PatientReport'));
const RptBillingByUser = lazy(() => import('./pages/reports/BillingByUserReport'));
const RptLaboratory = lazy(() => import('./pages/reports/LabReport'));
const RptPharmacy = lazy(() => import('./pages/reports/PharmacyReport'));
const RptInventory = lazy(() => import('./pages/reports/InventoryReport'));
const RptIncomeStatement = lazy(() => import('./pages/reports/IncomeStatementReport'));
const RptOverview = lazy(() => import('./pages/reports/DashboardOverview'));
const RptARAging = lazy(() => import('./pages/reports/ARAgingReport'));
const RptClinicPerformance = lazy(() => import('./pages/reports/ClinicPerformanceReport'));
const RptDoctorPerformance = lazy(() => import('./pages/reports/DoctorPerformanceReport'));
const RptOccupancy = lazy(() => import('./pages/reports/OccupancyReport'));
const RptCancelledTransactions = lazy(() => import('./pages/reports/CancelledTransactionsReport'));
const RptAuditSummary = lazy(() => import('./pages/reports/AuditSummaryReport'));
const WardsManagement = lazy(() => import('./pages/inpatient/WardsManagement'));
const RoomsManagement = lazy(() => import('./pages/inpatient/RoomsManagement'));
const Admissions = lazy(() => import('./pages/inpatient/Admissions'));
const AdmittedPatients = lazy(() => import('./pages/inpatient/AdmittedPatients'));
const PatientDetails = lazy(() => import('./pages/inpatient/PatientDetails'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,       // 30s before refetch
      gcTime: 5 * 60 * 1000,      // 5min cache retention
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Where a role goes when it hits a page it may not see.
//
// `currentPath` exists to break a redirect loop, and that loop was real: the
// fallback used to be /dashboard, but /dashboard itself excludes some roles —
// cashier among them. A cashier signing in was redirected to /dashboard, which
// rejected them and redirected to /dashboard again, forever. React rendered
// nothing, so login appeared to succeed (the welcome toast fired) and then left
// a blank screen. Any role missing from the list below and from /dashboard's
// allowlist would have hit exactly the same wall, so the guard is structural
// rather than one more special case.
const ROLE_LANDING: Record<string, string> = {
  reception: '/lis/registration',
  accountant: '/accounting/chart-of-accounts',
  finance_manager: '/accounting/chart-of-accounts',
  auditor: '/accounting/chart-of-accounts',
  procurement: '/procurement/suppliers-mgmt',
  nurse: '/triage',
  cashier: '/cashier/shift',
};

function landingPathForRole(role: string, currentPath: string): string {
  const target = ROLE_LANDING[role] || '/dashboard';
  // Never bounce a role back to the page that just rejected it.
  if (target === currentPath) return '/profile';
  return target;
}

const ProtectedRoute: React.FC<{ 
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}> = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  // Check role-based access
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={landingPathForRole(user.role, location.pathname)} replace />;
  }

  return <>{children}</>;
};

const ProtectedPlatformRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { admin, loading } = usePlatformAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/platform-admin/login" replace />;
  }

  return <>{children}</>;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (user) {
    // Redirect reception users to the patient registration page, procurement users to
    // the procurement dashboard (they have no /dashboard access), others to dashboard
    const redirectPath = user.role === 'reception' ? '/lis/registration'
      : user.role === 'procurement' ? '/procurement/suppliers-mgmt'
      : user.role === 'nurse' ? '/triage'
      : '/dashboard';
    return <Navigate to={redirectPath} replace />;
  }
  
  return <>{children}</>;
};

const AppRoutes = () => {
  const { user } = useAuth();
  
  // Dynamic root redirect based on user role
  const getRootRedirect = () => {
    if (!user) return "/login";
    if (user.role === 'reception') return '/lis/registration';
    if (user.role === 'procurement') return '/procurement/suppliers-mgmt';
    if (user.role === 'nurse') return '/triage';
    return '/dashboard';
  };

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
    <Routes>
      <Route path="/" element={<Navigate to={getRootRedirect()} replace />} />
      <Route path="/platform-admin/login" element={<PlatformLogin />} />
      <Route path="/platform-admin" element={
        <ProtectedPlatformRoute><PlatformDashboard /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/clients" element={
        <ProtectedPlatformRoute><PlatformClients /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/clients/:id" element={
        <ProtectedPlatformRoute><PlatformClientDetail /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/plans" element={
        <ProtectedPlatformRoute><PlatformPlans /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/users" element={
        <ProtectedPlatformRoute><PlatformUsers /></ProtectedPlatformRoute>
      } />
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />
      <Route path="/reset-password" element={
        <PublicRoute>
          <ResetPassword />
        </PublicRoute>
      } />
      <Route path="/setup-password" element={<SetupPassword />} />
      <Route path="/dashboard" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'doctor', 'lab', 'pharmacy', 'reports', 'accountant', 'finance_manager', 'auditor', 'nurse']}>
          <Dashboard />
        </ProtectedRoute>
      } />
      <Route path="/clinical/visits-history" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor']}>
          <PatientVisitsHistory />
        </ProtectedRoute>
      } />
      <Route path="/patients-bill" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'doctor']}>
          <PatientsBill />
        </ProtectedRoute>
      } />
      <Route path="/patients-bill/:billId" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'doctor']}>
          <BillDetails />
        </ProtectedRoute>
      } />
      <Route path="/proforma-invoices" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'doctor']}>
          <ProformaInvoice />
        </ProtectedRoute>
      } />
      <Route path="/billing-management" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'finance_manager', 'accountant']}>
          <BillingManagement />
        </ProtectedRoute>
      } />
      <Route path="/billing-management/claims/:claimId" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'finance_manager', 'accountant']}>
          <ClaimDetails />
        </ProtectedRoute>
      } />
      <Route path="/scheme-management" element={
        <ProtectedRoute allowedRoles={['admin', 'finance_manager', 'accountant']}>
          <SchemeManagement />
        </ProtectedRoute>
      } />
      <Route path="/receipts" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'doctor', 'pharmacy']}>
          <Receipts />
        </ProtectedRoute>
      } />
      <Route path="/invoices" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'finance_manager', 'accountant']}>
          <Invoices />
        </ProtectedRoute>
      } />
      {/* /laboratory is the legacy lab module — lab_requests/lab_results are
          nearly empty and permanently stuck in pending/partial in production;
          all real specimen/result activity happens through /lis/* below. */}
      <Route path="/laboratory" element={<Navigate to="/lis/collection" replace />} />
      <Route path="/lis" element={<Navigate to="/lis/registration" replace />} />
      <Route path="/lis/registration" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'lab']}>
          <LISRegistration />
        </ProtectedRoute>
      } />
      <Route path="/lis/queue" element={
        <ProtectedRoute>
          <LISQueue />
        </ProtectedRoute>
      } />
      <Route path="/triage" element={
        <ProtectedRoute allowedRoles={['admin', 'nurse']}>
          <Triage />
        </ProtectedRoute>
      } />
      <Route path="/lis/orders" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor', 'lab', 'reception']}>
          <LISTestOrders />
        </ProtectedRoute>
      } />
      <Route path="/lis/collection" element={
        <ProtectedRoute allowedRoles={['admin', 'lab', 'doctor']}>
          <LISCollection />
        </ProtectedRoute>
      } />
      <Route path="/lis/results-entry" element={
        <ProtectedRoute allowedRoles={['admin', 'lab']}>
          <LISResultsEntry />
        </ProtectedRoute>
      } />
      <Route path="/lis/review" element={
        <ProtectedRoute allowedRoles={['admin', 'lab']}>
          <LISManagerReview />
        </ProtectedRoute>
      } />
      {/* /pharmacy and /pharmacy/inventory are the legacy pharmacy module — its
          tables (drug_inventory, pharmacy_dispensing) are empty in production;
          all real dispensing/stock activity happens through the pharmacy-module
          pages below. Redirecting rather than deleting keeps old links/bookmarks
          working instead of 404ing. */}
      <Route path="/pharmacy" element={<Navigate to="/pharmacy-dispensing" replace />} />
      <Route path="/pharmacy/inventory" element={<Navigate to="/inventory/items" replace />} />
      <Route path="/reports" element={
        <ProtectedRoute allowedRoles={['admin', 'reports', 'finance_manager', 'accountant', 'auditor']}>
          <PasswordVerification />
        </ProtectedRoute>
      } />
      <Route path="/reports/dashboard" element={
        <ProtectedRoute allowedRoles={['admin', 'reports', 'finance_manager', 'accountant', 'auditor']}>
          <ReportsDashboard />
        </ProtectedRoute>
      }>
        <Route index element={<RptOverview />} />
        <Route path="overview" element={<RptOverview />} />
        <Route path="patients" element={<RptPatients />} />
        <Route path="billing-by-user" element={<RptBillingByUser />} />
        <Route path="laboratory" element={<RptLaboratory />} />
        <Route path="pharmacy" element={<RptPharmacy />} />
        <Route path="inventory" element={<RptInventory />} />
        <Route path="income-statement" element={<RptIncomeStatement />} />
        <Route path="ar-aging" element={<RptARAging />} />
        <Route path="clinic-performance" element={<RptClinicPerformance />} />
        <Route path="doctor-performance" element={<RptDoctorPerformance />} />
        <Route path="occupancy" element={<RptOccupancy />} />
        <Route path="cancelled-transactions" element={<RptCancelledTransactions />} />
        <Route path="audit-summary" element={<RptAuditSummary />} />
      </Route>
      {/* /reports/legacy (Reports.tsx) removed — unreachable from any nav link,
          and all 4 of its own destination cards 404'd (routes that never
          existed). Pure dead weight with nothing pointing to it and nothing
          it pointed to working. */}
      <Route path="/setup/lab-tests" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor', 'lab']}>
          <LabTests />
        </ProtectedRoute>
      } />
      <Route path="/setup/services" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor', 'lab']}>
          <Services />
        </ProtectedRoute>
      } />
      <Route path="/setup/departments" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor']}>
          <Departments />
        </ProtectedRoute>
      } />
      <Route path="/setup/clinics" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <Clinics />
        </ProtectedRoute>
      } />
      <Route path="/setup/api-configurations" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <ApiConfigurations />
        </ProtectedRoute>
      } />
      <Route path="/setup/facility" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <FacilitySetup />
        </ProtectedRoute>
      } />
      <Route path="/setup/security" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <Security />
        </ProtectedRoute>
      } />
      <Route path="/setup/approvals" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <Approvals />
        </ProtectedRoute>
      } />
      <Route path="/accounting/cash-transfer" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager', 'reception', 'pharmacy', 'cashier']}>
          <AccountingCashTransfer />
        </ProtectedRoute>
      } />
      <Route path="/cashier/shift" element={
        <ProtectedRoute allowedRoles={['admin', 'reception', 'pharmacy', 'cashier']}>
          <CashierShift />
        </ProtectedRoute>
      } />
      <Route path="/procurement" element={<Navigate to="/procurement/suppliers-mgmt" replace />} />
      <Route path="/procurement/suppliers-mgmt" element={
        <ProtectedRoute allowedRoles={['admin', 'finance_manager', 'accountant', 'procurement']}>
          <SuppliersManagement />
        </ProtectedRoute>
      } />
      <Route path="/procurement/requisitions" element={
        <ProtectedRoute allowedRoles={['admin', 'finance_manager', 'accountant', 'doctor', 'pharmacy', 'procurement']}>
          <PurchaseRequisitions />
        </ProtectedRoute>
      } />
      <Route path="/procurement/purchase-orders" element={
        <ProtectedRoute allowedRoles={['admin', 'procurement']}>
          <PurchaseOrders />
        </ProtectedRoute>
      } />
      <Route path="/procurement/goods-receipt" element={
        <ProtectedRoute allowedRoles={['admin', 'finance_manager', 'accountant', 'pharmacy', 'procurement']}>
          <GoodsReceiptNotes />
        </ProtectedRoute>
      } />
      <Route path="/procurement/daily-expenses" element={
        <ProtectedRoute allowedRoles={['admin', 'cashier', 'procurement']}>
          <DailyExpenses />
        </ProtectedRoute>
      } />
      <Route path="/procurement/daily-expenses/:id" element={
        <ProtectedRoute allowedRoles={['admin', 'cashier', 'finance_manager', 'accountant', 'procurement']}>
          <ExpenseDetail />
        </ProtectedRoute>
      } />
      <Route path="/procurement/reports" element={
        <ProtectedRoute allowedRoles={['admin', 'finance_manager', 'accountant', 'procurement']}>
          <ProcurementReports />
        </ProtectedRoute>
      } />
      <Route path="/accounting" element={<Navigate to="/accounting/chart-of-accounts" replace />} />
      <Route path="/accounting/chart-of-accounts" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager']}>
          <ChartOfAccounts />
        </ProtectedRoute>
      } />
      <Route path="/accounting/general-ledger" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager', 'auditor']}>
          <GeneralLedger />
        </ProtectedRoute>
      } />
      <Route path="/accounting/journal-entries" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager']}>
          <JournalEntriesPage />
        </ProtectedRoute>
      } />
      <Route path="/accounting/receivables" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager']}>
          <ReceivablesPage />
        </ProtectedRoute>
      } />
      <Route path="/accounting/reports" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager', 'auditor']}>
          <FinancialReports />
        </ProtectedRoute>
      } />
      <Route path="/accounting/exchange-rates" element={
        <ProtectedRoute allowedRoles={['admin', 'accountant', 'finance_manager']}>
          <ExchangeRatesPage />
        </ProtectedRoute>
      } />
      <Route path="/inventory" element={<Navigate to="/inventory/items" replace />} />
      <Route path="/inventory/items" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy', 'finance_manager', 'accountant', 'procurement']}>
          <ItemMaster />
        </ProtectedRoute>
      } />
      <Route path="/inventory/locations" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy', 'finance_manager', 'procurement']}>
          <StockLocations />
        </ProtectedRoute>
      } />
      <Route path="/inventory/transactions" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy', 'finance_manager', 'accountant', 'procurement']}>
          <StockTransactions />
        </ProtectedRoute>
      } />
      <Route path="/inventory/batches" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy', 'procurement']}>
          <BatchTracking />
        </ProtectedRoute>
      } />
      <Route path="/inventory/physical-counts" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy', 'finance_manager', 'procurement']}>
          <PhysicalCounts />
        </ProtectedRoute>
      } />
      <Route path="/inventory/valuation" element={
        <ProtectedRoute allowedRoles={['admin', 'finance_manager', 'accountant', 'procurement']}>
          <ValuationCOGS />
        </ProtectedRoute>
      } />
      <Route path="/pharmacy-prescriptions" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy', 'doctor']}>
          <PrescriptionManagement />
        </ProtectedRoute>
      } />
      <Route path="/pharmacy-dispensing" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy']}>
          <DispensingWorkflow />
        </ProtectedRoute>
      } />
      <Route path="/pharmacy-returns" element={
        <ProtectedRoute allowedRoles={['admin', 'pharmacy']}>
          <PharmacyReturns />
        </ProtectedRoute>
      } />
      <Route path="/setup/wards" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <WardsManagement />
        </ProtectedRoute>
      } />
      <Route path="/setup/rooms" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <RoomsManagement />
        </ProtectedRoute>
      } />
      <Route path="/inpatient/admissions" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor', 'reception']}>
          <Admissions />
        </ProtectedRoute>
      } />
      <Route path="/inpatient/patients" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor', 'reception']}>
          <AdmittedPatients />
        </ProtectedRoute>
      } />
      <Route path="/inpatient/patient/:id" element={
        <ProtectedRoute allowedRoles={['admin', 'doctor', 'reception', 'pharmacy', 'lab']}>
          <PatientDetails />
        </ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute>
          <Profile />
        </ProtectedRoute>
      } />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
};

const AppContent = () => {
  return (
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppRoutes />
    </TooltipProvider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    {/* Wrap entire app with DatabaseProvider to make repositories available everywhere */}
    <DatabaseProvider>
      <PlatformAuthProvider>
        <AuthProvider>
          <CurrencyProvider>
            <AppContent />
          </CurrencyProvider>
        </AuthProvider>
      </PlatformAuthProvider>
    </DatabaseProvider>
  </QueryClientProvider>
);

export default App;

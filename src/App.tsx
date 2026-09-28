import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { RouteErrorBoundary } from '@/components/common/RouteErrorBoundary';
import { LoadingState } from '@/components/common/LoadingState';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PlatformAuthProvider, usePlatformAuth } from "@/contexts/PlatformAuthContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { DatabaseProvider } from "@/contexts/DatabaseContext.browser";
import { Loader2 } from "lucide-react";

const PlatformLogin = lazyWithRetry(() => import('./pages/platform/PlatformLogin'));
const PlatformDashboard = lazyWithRetry(() => import('./pages/platform/PlatformDashboard'));
const PlatformClients = lazyWithRetry(() => import('./pages/platform/PlatformClients'));
const PlatformClientDetail = lazyWithRetry(() => import('./pages/platform/PlatformClientDetail'));
const PlatformPlans = lazyWithRetry(() => import('./pages/platform/PlatformPlans'));
const PlatformUsers = lazyWithRetry(() => import('./pages/platform/PlatformUsers'));
const PlatformCustomers = lazyWithRetry(() => import('./pages/platform/PlatformCustomers'));
const PlatformQuotations = lazyWithRetry(() => import('./pages/platform/PlatformQuotations'));
const PlatformQuotationDetail = lazyWithRetry(() => import('./pages/platform/PlatformQuotationDetail'));
const PlatformCompanyProfile = lazyWithRetry(() => import('./pages/platform/PlatformCompanyProfile'));
const PlatformInvoices = lazyWithRetry(() => import('./pages/platform/PlatformInvoices'));
const PlatformInvoiceDetail = lazyWithRetry(() => import('./pages/platform/PlatformInvoiceDetail'));

const Login = lazyWithRetry(() => import('./pages/Login'));
const ResetPassword = lazyWithRetry(() => import('./pages/ResetPassword'));
const PayrollSign = lazyWithRetry(() => import('./pages/public/PayrollSign'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const PatientVisitsHistory = lazyWithRetry(() => import('./pages/PatientVisitsHistory'));
const PatientsBill = lazyWithRetry(() => import('./pages/PatientsBill'));
const ProformaInvoice = lazyWithRetry(() => import('./pages/ProformaInvoice'));
const BillDetails = lazyWithRetry(() => import('./pages/BillDetails'));
const BillingManagement = lazyWithRetry(() => import('./pages/BillingManagement'));
const ClaimDetails = lazyWithRetry(() => import('./pages/ClaimDetails'));
const SchemeManagement = lazyWithRetry(() => import('./pages/SchemeManagement'));
const Receipts = lazyWithRetry(() => import('./pages/Receipts'));
const LISRegistration = lazyWithRetry(() => import('./pages/lis/LISRegistration'));
const PatientReferrals = lazyWithRetry(() => import('./pages/PatientReferrals'));
const PatientReferralDetail = lazyWithRetry(() => import('./pages/PatientReferralDetail'));
const LISTestOrders = lazyWithRetry(() => import('./pages/lis/LISTestOrders'));
const RadiologyQueue = lazyWithRetry(() => import('./pages/radiology/RadiologyQueue'));
const RadiologyRequestDetail = lazyWithRetry(() => import('./pages/radiology/RadiologyRequestDetail'));
const LISQueue = lazyWithRetry(() => import('./pages/lis/LISQueue'));
const Triage = lazyWithRetry(() => import('./pages/lis/Triage'));
const LISCollection = lazyWithRetry(() => import('./pages/lis/LISCollection'));
const LISResultsEntry = lazyWithRetry(() => import('./pages/lis/LISResultsEntry'));
const LISManagerReview = lazyWithRetry(() => import('./pages/lis/LISManagerReview'));
const LabTests = lazyWithRetry(() => import('./pages/setup/LabTests'));
const Services = lazyWithRetry(() => import('./pages/setup/Services'));
const Departments = lazyWithRetry(() => import('./pages/setup/Departments'));
const Clinics = lazyWithRetry(() => import('./pages/setup/Clinics'));
const ApiConfigurations = lazyWithRetry(() => import('./pages/setup/ApiConfigurations'));
const Security = lazyWithRetry(() => import('./pages/setup/Security'));
const Approvals = lazyWithRetry(() => import('./pages/setup/Approvals'));
const FacilitySetup = lazyWithRetry(() => import('./pages/setup/FacilitySetup'));
const AccountingCashTransfer = lazyWithRetry(() => import('./pages/accounting/CashTransfer'));
const CashierShift = lazyWithRetry(() => import('./pages/cashier/CashierShift'));
const PurchaseOrders = lazyWithRetry(() => import('./pages/procurement/PurchaseOrders'));
const DailyExpenses = lazyWithRetry(() => import('./pages/procurement/DailyExpenses'));
const ExpenseDetail = lazyWithRetry(() => import('./pages/procurement/ExpenseDetail'));
const SuppliersManagement = lazyWithRetry(() => import('./pages/procurement/SuppliersManagement'));
const SupplierProfile = lazyWithRetry(() => import('./pages/procurement/SupplierProfile'));
const EmployeesManagement = lazyWithRetry(() => import('./pages/hr/EmployeesManagement'));
const ConsultantsManagement = lazyWithRetry(() => import('./pages/hr/ConsultantsManagement'));
const EmployeeProfile = lazyWithRetry(() => import('./pages/hr/EmployeeProfile'));
const PayrollManagement = lazyWithRetry(() => import('./pages/hr/PayrollManagement'));
const PayrollRunDetail = lazyWithRetry(() => import('./pages/hr/PayrollRunDetail'));
const SalaryStructuresManagement = lazyWithRetry(() => import('./pages/hr/SalaryStructuresManagement'));
const SalaryAdvancesManagement = lazyWithRetry(() => import('./pages/hr/SalaryAdvancesManagement'));
const LeaveManagement = lazyWithRetry(() => import('./pages/hr/LeaveManagement'));
const PurchaseRequisitions = lazyWithRetry(() => import('./pages/procurement/PurchaseRequisitions'));
const GoodsReceiptNotes = lazyWithRetry(() => import('./pages/procurement/GoodsReceiptNotes'));
const ProcurementReports = lazyWithRetry(() => import('./pages/procurement/ProcurementReports'));
const Profile = lazyWithRetry(() => import('./pages/Profile'));
const HowTo = lazyWithRetry(() => import('./pages/HowTo'));
const ChartOfAccounts = lazyWithRetry(() => import('./pages/accounting/ChartOfAccounts'));
const GeneralLedger = lazyWithRetry(() => import('./pages/accounting/GeneralLedger'));
const JournalEntriesPage = lazyWithRetry(() => import('./pages/accounting/JournalEntries'));
const ReceivablesPage = lazyWithRetry(() => import('./pages/accounting/Receivables'));
const FinancialReports = lazyWithRetry(() => import('./pages/accounting/FinancialReports'));
const ExchangeRatesPage = lazyWithRetry(() => import('./pages/accounting/ExchangeRates'));
const ItemMaster = lazyWithRetry(() => import('./pages/inventory/ItemMaster'));
const StockLocations = lazyWithRetry(() => import('./pages/inventory/StockLocations'));
const StockTransactions = lazyWithRetry(() => import('./pages/inventory/StockTransactions'));
const BatchTracking = lazyWithRetry(() => import('./pages/inventory/BatchTracking'));
const PhysicalCounts = lazyWithRetry(() => import('./pages/inventory/PhysicalCounts'));
const ValuationCOGS = lazyWithRetry(() => import('./pages/inventory/ValuationCOGS'));
const PrescriptionManagement = lazyWithRetry(() => import('./pages/pharmacyModule/PrescriptionManagement'));
const DispensingWorkflow = lazyWithRetry(() => import('./pages/pharmacyModule/DispensingWorkflow'));
const PharmacyReturns = lazyWithRetry(() => import('./pages/pharmacyModule/PharmacyReturns'));
const Invoices = lazyWithRetry(() => import('./pages/Invoices'));
const PasswordVerification = lazyWithRetry(() => import('./pages/reports/PasswordVerification'));
const ReportsDashboard = lazyWithRetry(() => import('./pages/reports/ReportsDashboard'));
const RptPatients = lazyWithRetry(() => import('./pages/reports/PatientReport'));
const RptBillingByUser = lazyWithRetry(() => import('./pages/reports/BillingByUserReport'));
const RptLaboratory = lazyWithRetry(() => import('./pages/reports/LabReport'));
const RptPharmacy = lazyWithRetry(() => import('./pages/reports/PharmacyReport'));
const RptInventory = lazyWithRetry(() => import('./pages/reports/InventoryReport'));
const RptIncomeStatement = lazyWithRetry(() => import('./pages/reports/IncomeStatementReport'));
const RptOverview = lazyWithRetry(() => import('./pages/reports/DashboardOverview'));
const RptARAging = lazyWithRetry(() => import('./pages/reports/ARAgingReport'));
const RptClinicPerformance = lazyWithRetry(() => import('./pages/reports/ClinicPerformanceReport'));
const RptDoctorPerformance = lazyWithRetry(() => import('./pages/reports/DoctorPerformanceReport'));
const RptOccupancy = lazyWithRetry(() => import('./pages/reports/OccupancyReport'));
const RptDhis2 = lazyWithRetry(() => import('./pages/reports/Dhis2Report'));
const RptCancelledTransactions = lazyWithRetry(() => import('./pages/reports/CancelledTransactionsReport'));
const RptAuditSummary = lazyWithRetry(() => import('./pages/reports/AuditSummaryReport'));
const WardsManagement = lazyWithRetry(() => import('./pages/inpatient/WardsManagement'));
const RoomsManagement = lazyWithRetry(() => import('./pages/inpatient/RoomsManagement'));
const Admissions = lazyWithRetry(() => import('./pages/inpatient/Admissions'));
const AdmittedPatients = lazyWithRetry(() => import('./pages/inpatient/AdmittedPatients'));
const PatientDetails = lazyWithRetry(() => import('./pages/inpatient/PatientDetails'));
const NotFound = lazyWithRetry(() => import('./pages/NotFound'));

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

// Where a user goes when they hit a page they may not see, checked in order —
// first candidate they actually have the privilege for wins.
//
// `currentPath` exists to break a redirect loop, and that loop was real: a
// role rejected from every candidate (including /dashboard) used to fall back
// to /dashboard itself, which then rejected them again, forever — a custom
// role granted none of these specific privileges would hit exactly that wall.
// Checking privileges (not a fixed per-role table) instead of a hardcoded role
// string is also what makes a brand-new custom role land somewhere sane
// automatically, with no code change, once it's granted any one of these.
const LANDING_CANDIDATES: { path: string; privilege: string | string[] }[] = [
  { path: '/lis/registration', privilege: 'pages.lis_registration.view' },
  { path: '/procurement/suppliers-mgmt', privilege: 'procurement.read' },
  { path: '/triage', privilege: 'lis.triage.write' },
  { path: '/cashier/shift', privilege: 'cashier.write' },
  { path: '/dashboard', privilege: 'pages.dashboard.view' },
];

function landingPathFor(hasPrivilege: (p: string | string[]) => boolean, currentPath?: string): string {
  for (const c of LANDING_CANDIDATES) {
    if (c.path !== currentPath && hasPrivilege(c.privilege)) return c.path;
  }
  return '/profile';
}

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  requiredPrivilege?: string | string[];
}> = ({ children, requiredPrivilege }) => {
  const { user, loading, hasPrivilege } = useAuth();
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

  // Check privilege-based access
  if (requiredPrivilege && !hasPrivilege(requiredPrivilege)) {
    return <Navigate to={landingPathFor(hasPrivilege, location.pathname)} replace />;
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
  const { user, loading, hasPrivilege } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={landingPathFor(hasPrivilege)} replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  const { user, hasPrivilege } = useAuth();

  // Dynamic root redirect based on granted privileges
  const getRootRedirect = () => {
    if (!user) return "/login";
    return landingPathFor(hasPrivilege);
  };

  return (
    <RouteErrorBoundary>
    <Suspense fallback={<LoadingState variant="page" message="Loading..." />}>
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
      <Route path="/platform-admin/customers" element={
        <ProtectedPlatformRoute><PlatformCustomers /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/quotations" element={
        <ProtectedPlatformRoute><PlatformQuotations /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/quotations/:id" element={
        <ProtectedPlatformRoute><PlatformQuotationDetail /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/company-profile" element={
        <ProtectedPlatformRoute><PlatformCompanyProfile /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/invoices" element={
        <ProtectedPlatformRoute><PlatformInvoices /></ProtectedPlatformRoute>
      } />
      <Route path="/platform-admin/invoices/:id" element={
        <ProtectedPlatformRoute><PlatformInvoiceDetail /></ProtectedPlatformRoute>
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
      {/* Not wrapped in PublicRoute — that redirects away when a user IS
          logged in, which is wrong here: the admin who just generated this
          QR code, testing it or having an employee borrow their already
          -logged-in phone, must still see the actual signing page, not get
          bounced to the dashboard. No ProtectedRoute either — the whole
          point is an employee with no account can open this. */}
      <Route path="/payroll-sign/:code/:token" element={<PayrollSign />} />
      <Route path="/dashboard" element={
        <ProtectedRoute requiredPrivilege="pages.dashboard.view">
          <Dashboard />
        </ProtectedRoute>
      } />
      <Route path="/clinical/visits-history" element={
        <ProtectedRoute requiredPrivilege="pages.visits_history.view">
          <PatientVisitsHistory />
        </ProtectedRoute>
      } />
      <Route path="/patients-bill" element={
        <ProtectedRoute requiredPrivilege="pages.patients_bill.view">
          <PatientsBill />
        </ProtectedRoute>
      } />
      <Route path="/patients-bill/:billId" element={
        <ProtectedRoute requiredPrivilege="pages.patients_bill.view">
          <BillDetails />
        </ProtectedRoute>
      } />
      <Route path="/proforma-invoices" element={
        <ProtectedRoute requiredPrivilege="proforma.write">
          <ProformaInvoice />
        </ProtectedRoute>
      } />
      <Route path="/billing-management" element={
        <ProtectedRoute requiredPrivilege="billing.write">
          <BillingManagement />
        </ProtectedRoute>
      } />
      <Route path="/billing-management/claims/:claimId" element={
        <ProtectedRoute requiredPrivilege="claims.write">
          <ClaimDetails />
        </ProtectedRoute>
      } />
      <Route path="/scheme-management" element={
        <ProtectedRoute requiredPrivilege="schemes.write">
          <SchemeManagement />
        </ProtectedRoute>
      } />
      <Route path="/receipts" element={
        <ProtectedRoute requiredPrivilege="receipts.write">
          <Receipts />
        </ProtectedRoute>
      } />
      <Route path="/invoices" element={
        <ProtectedRoute requiredPrivilege="invoices.write">
          <Invoices />
        </ProtectedRoute>
      } />
      {/* /laboratory is the legacy lab module — lab_requests/lab_results are
          nearly empty and permanently stuck in pending/partial in production;
          all real specimen/result activity happens through /lis/* below. */}
      <Route path="/laboratory" element={<Navigate to="/lis/collection" replace />} />
      <Route path="/lis" element={<Navigate to="/lis/registration" replace />} />
      <Route path="/lis/registration" element={
        <ProtectedRoute requiredPrivilege="pages.lis_registration.view">
          <LISRegistration />
        </ProtectedRoute>
      } />
      <Route path="/patient-referrals" element={
        <ProtectedRoute requiredPrivilege="pages.patient_referral.view">
          <PatientReferrals />
        </ProtectedRoute>
      } />
      <Route path="/patient-referrals/:id" element={
        <ProtectedRoute requiredPrivilege="pages.patient_referral.view">
          <PatientReferralDetail />
        </ProtectedRoute>
      } />
      <Route path="/lis/queue" element={
        <ProtectedRoute>
          <LISQueue />
        </ProtectedRoute>
      } />
      <Route path="/triage" element={
        <ProtectedRoute requiredPrivilege="lis.triage.write">
          <Triage />
        </ProtectedRoute>
      } />
      <Route path="/lis/orders" element={
        <ProtectedRoute requiredPrivilege="lis.clinical.read">
          <LISTestOrders />
        </ProtectedRoute>
      } />
      <Route path="/radiology" element={
        <ProtectedRoute requiredPrivilege="radiology.read">
          <RadiologyQueue />
        </ProtectedRoute>
      } />
      <Route path="/radiology/requests/:id" element={
        <ProtectedRoute requiredPrivilege="radiology.read">
          <RadiologyRequestDetail />
        </ProtectedRoute>
      } />
      <Route path="/lis/collection" element={
        <ProtectedRoute requiredPrivilege="lis.results.read">
          <LISCollection />
        </ProtectedRoute>
      } />
      <Route path="/lis/results-entry" element={
        <ProtectedRoute requiredPrivilege="lis.specimen.write">
          <LISResultsEntry />
        </ProtectedRoute>
      } />
      <Route path="/lis/review" element={
        <ProtectedRoute requiredPrivilege="lis.results.review">
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
        <ProtectedRoute requiredPrivilege="pages.reports.view">
          <PasswordVerification />
        </ProtectedRoute>
      } />
      <Route path="/reports/dashboard" element={
        <ProtectedRoute requiredPrivilege="pages.reports.view">
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
        <Route path="dhis2" element={<RptDhis2 />} />
        <Route path="cancelled-transactions" element={<RptCancelledTransactions />} />
        <Route path="audit-summary" element={<RptAuditSummary />} />
      </Route>
      {/* /reports/legacy (Reports.tsx) removed — unreachable from any nav link,
          and all 4 of its own destination cards 404'd (routes that never
          existed). Pure dead weight with nothing pointing to it and nothing
          it pointed to working. */}
      <Route path="/setup/lab-tests" element={
        <ProtectedRoute requiredPrivilege="pages.setup_lab_tests.view">
          <LabTests />
        </ProtectedRoute>
      } />
      <Route path="/setup/services" element={
        <ProtectedRoute requiredPrivilege="clinical.services.manage">
          <Services />
        </ProtectedRoute>
      } />
      <Route path="/setup/departments" element={
        <ProtectedRoute requiredPrivilege="pages.setup_departments.view">
          <Departments />
        </ProtectedRoute>
      } />
      <Route path="/setup/clinics" element={
        <ProtectedRoute requiredPrivilege="pages.setup_clinics.view">
          <Clinics />
        </ProtectedRoute>
      } />
      <Route path="/setup/api-configurations" element={
        <ProtectedRoute requiredPrivilege="setup.api_configurations.manage">
          <ApiConfigurations />
        </ProtectedRoute>
      } />
      <Route path="/setup/facility" element={
        <ProtectedRoute requiredPrivilege="pages.setup_facility.view">
          <FacilitySetup />
        </ProtectedRoute>
      } />
      <Route path="/setup/security" element={
        <ProtectedRoute requiredPrivilege="pages.security.access">
          <Security />
        </ProtectedRoute>
      } />
      <Route path="/setup/approvals" element={
        <ProtectedRoute requiredPrivilege="approvals.manage">
          <Approvals />
        </ProtectedRoute>
      } />
      <Route path="/accounting/cash-transfer" element={
        <ProtectedRoute requiredPrivilege="cash_transfers.write">
          <AccountingCashTransfer />
        </ProtectedRoute>
      } />
      <Route path="/cashier/shift" element={
        <ProtectedRoute requiredPrivilege="cashier.write">
          <CashierShift />
        </ProtectedRoute>
      } />
      <Route path="/procurement" element={<Navigate to="/procurement/suppliers-mgmt" replace />} />
      <Route path="/procurement/suppliers-mgmt" element={
        <ProtectedRoute requiredPrivilege="procurement.read">
          <SuppliersManagement />
        </ProtectedRoute>
      } />
      <Route path="/procurement/suppliers-mgmt/:id" element={
        <ProtectedRoute requiredPrivilege="procurement.read">
          <SupplierProfile />
        </ProtectedRoute>
      } />
      <Route path="/hr/employees" element={
        <ProtectedRoute requiredPrivilege="hr.employees.read">
          <EmployeesManagement />
        </ProtectedRoute>
      } />
      <Route path="/hr/employees/:id" element={
        <ProtectedRoute requiredPrivilege="hr.employees.read">
          <EmployeeProfile />
        </ProtectedRoute>
      } />
      <Route path="/hr/consultants" element={
        <ProtectedRoute requiredPrivilege="hr.employees.read">
          <ConsultantsManagement />
        </ProtectedRoute>
      } />
      <Route path="/hr/consultants/:id" element={
        <ProtectedRoute requiredPrivilege="hr.employees.read">
          <EmployeeProfile />
        </ProtectedRoute>
      } />
      <Route path="/hr/payroll" element={
        <ProtectedRoute requiredPrivilege="hr.payroll.read">
          <PayrollManagement />
        </ProtectedRoute>
      } />
      <Route path="/hr/payroll/:id" element={
        <ProtectedRoute requiredPrivilege="hr.payroll.read">
          <PayrollRunDetail />
        </ProtectedRoute>
      } />
      <Route path="/hr/salary-structures" element={
        <ProtectedRoute requiredPrivilege="hr.employees.read">
          <SalaryStructuresManagement />
        </ProtectedRoute>
      } />
      <Route path="/hr/salary-advances" element={
        <ProtectedRoute requiredPrivilege="hr.salary_advances.read">
          <SalaryAdvancesManagement />
        </ProtectedRoute>
      } />
      <Route path="/hr/leave" element={
        <ProtectedRoute requiredPrivilege="hr.leave.read">
          <LeaveManagement />
        </ProtectedRoute>
      } />
      <Route path="/procurement/requisitions" element={
        <ProtectedRoute requiredPrivilege="pages.procurement_requisitions.view">
          <PurchaseRequisitions />
        </ProtectedRoute>
      } />
      <Route path="/procurement/purchase-orders" element={
        <ProtectedRoute requiredPrivilege="procurement.purchase_orders.write">
          <PurchaseOrders />
        </ProtectedRoute>
      } />
      <Route path="/procurement/goods-receipt" element={
        <ProtectedRoute requiredPrivilege={['procurement.write', 'pharmacy.write']}>
          <GoodsReceiptNotes />
        </ProtectedRoute>
      } />
      <Route path="/procurement/daily-expenses" element={
        <ProtectedRoute requiredPrivilege="expenses.write">
          <DailyExpenses />
        </ProtectedRoute>
      } />
      <Route path="/procurement/daily-expenses/:id" element={
        <ProtectedRoute requiredPrivilege="expenses.read">
          <ExpenseDetail />
        </ProtectedRoute>
      } />
      <Route path="/procurement/reports" element={
        <ProtectedRoute requiredPrivilege="procurement.read">
          <ProcurementReports />
        </ProtectedRoute>
      } />
      <Route path="/accounting" element={<Navigate to="/accounting/chart-of-accounts" replace />} />
      <Route path="/accounting/chart-of-accounts" element={
        <ProtectedRoute requiredPrivilege="accounting.write">
          <ChartOfAccounts />
        </ProtectedRoute>
      } />
      <Route path="/accounting/general-ledger" element={
        <ProtectedRoute requiredPrivilege="accounting.read">
          <GeneralLedger />
        </ProtectedRoute>
      } />
      <Route path="/accounting/journal-entries" element={
        <ProtectedRoute requiredPrivilege="accounting.write">
          <JournalEntriesPage />
        </ProtectedRoute>
      } />
      <Route path="/accounting/receivables" element={
        <ProtectedRoute requiredPrivilege="accounting.read">
          <ReceivablesPage />
        </ProtectedRoute>
      } />
      <Route path="/accounting/reports" element={
        <ProtectedRoute requiredPrivilege="accounting.read">
          <FinancialReports />
        </ProtectedRoute>
      } />
      <Route path="/accounting/exchange-rates" element={
        <ProtectedRoute requiredPrivilege="accounting.rates.write">
          <ExchangeRatesPage />
        </ProtectedRoute>
      } />
      <Route path="/inventory" element={<Navigate to="/inventory/items" replace />} />
      <Route path="/inventory/items" element={
        <ProtectedRoute requiredPrivilege="inventory.read">
          <ItemMaster />
        </ProtectedRoute>
      } />
      <Route path="/inventory/locations" element={
        <ProtectedRoute requiredPrivilege="inventory.read">
          <StockLocations />
        </ProtectedRoute>
      } />
      <Route path="/inventory/transactions" element={
        <ProtectedRoute requiredPrivilege="inventory.read">
          <StockTransactions />
        </ProtectedRoute>
      } />
      <Route path="/inventory/batches" element={
        <ProtectedRoute requiredPrivilege="inventory.write">
          <BatchTracking />
        </ProtectedRoute>
      } />
      <Route path="/inventory/physical-counts" element={
        <ProtectedRoute requiredPrivilege="inventory.read">
          <PhysicalCounts />
        </ProtectedRoute>
      } />
      <Route path="/inventory/valuation" element={
        <ProtectedRoute requiredPrivilege={['inventory.adjustments.approve', 'inventory.read']}>
          <ValuationCOGS />
        </ProtectedRoute>
      } />
      <Route path="/pharmacy-prescriptions" element={
        <ProtectedRoute requiredPrivilege="pharmacy.prescribe">
          <PrescriptionManagement />
        </ProtectedRoute>
      } />
      <Route path="/pharmacy-dispensing" element={
        <ProtectedRoute requiredPrivilege="pharmacy.write">
          <DispensingWorkflow />
        </ProtectedRoute>
      } />
      <Route path="/pharmacy-returns" element={
        <ProtectedRoute requiredPrivilege="pharmacy.write">
          <PharmacyReturns />
        </ProtectedRoute>
      } />
      <Route path="/setup/wards" element={
        <ProtectedRoute requiredPrivilege="pages.setup_wards.view">
          <WardsManagement />
        </ProtectedRoute>
      } />
      <Route path="/setup/rooms" element={
        <ProtectedRoute requiredPrivilege="pages.setup_rooms.view">
          <RoomsManagement />
        </ProtectedRoute>
      } />
      <Route path="/inpatient/admissions" element={
        <ProtectedRoute requiredPrivilege="inpatient.admissions.write">
          <Admissions />
        </ProtectedRoute>
      } />
      <Route path="/inpatient/patients" element={
        <ProtectedRoute requiredPrivilege="inpatient.admissions.write">
          <AdmittedPatients />
        </ProtectedRoute>
      } />
      <Route path="/inpatient/patient/:id" element={
        <ProtectedRoute requiredPrivilege={['inpatient.admissions.write', 'inpatient.medications.manage', 'inpatient.ancillary.write']}>
          <PatientDetails />
        </ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute>
          <Profile />
        </ProtectedRoute>
      } />
      <Route path="/help" element={
        <ProtectedRoute>
          <HowTo />
        </ProtectedRoute>
      } />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </RouteErrorBoundary>
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

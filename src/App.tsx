import { lazy, Suspense, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, useI18n } from "./i18n";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ModulesProvider, useModules } from "./context/ModulesContext";
import AppLayout from "./components/AppLayout";
import { ModuleGate } from "./components/ModuleGate";
import { ToastProvider, useToast } from "./components/Toast";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import AcceptInvitePage from "./pages/auth/AcceptInvitePage";
import { LoadingState } from "./components/ui";
import VehiclesPage from "./pages/vehicles/VehiclesPage";
import VehicleDetailPage from "./pages/vehicles/VehicleDetailPage";
import DriversPage from "./pages/drivers/DriversPage";
import MaintenancePage from "./pages/maintenance/MaintenancePage";
import WorkOrderDetailPage from "./pages/maintenance/WorkOrderDetailPage";
import FuelPage from "./pages/fuel/FuelPage";
import InspectionsPage from "./pages/inspections/InspectionsPage";
import NewInspectionPage from "./pages/inspections/NewInspectionPage";
import IssuesPage from "./pages/issues/IssuesPage";
import RenewalsPage from "./pages/renewals/RenewalsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import VerifyPage from "./pages/verify/VerifyPage";

// recharts is heavy — split the chart pages into their own chunks
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage"));
// The speed limiter hub carries its own sub-routes, so it gets its own chunk
const SpeedLimitersHub = lazy(() => import("./pages/speed-limiters/SpeedLimitersHub"));
// Customers is global master data with its own module + chunk
// Sales carries its own sub-routes (quotes/orders/invoices), so it gets its own chunk
const SalesHub = lazy(() => import("./pages/sales/SalesHub"));
// Customer-facing quote page — public, like /verify
const PublicQuotePage = lazy(() => import("./pages/sales/PublicQuotePage"));
const CustomersPage = lazy(() => import("./pages/customers/CustomersPage"));
const CustomerDetailPage = lazy(() => import("./pages/customers/CustomerDetailPage"));
// Module hubs: each owns its sub-routes and ships as its own chunk.
const GpsTrackingHub = lazy(() => import("./pages/gps-tracking/GpsTrackingHub"));
const DriverBehaviorHub = lazy(() => import("./pages/driver-behavior/DriverBehaviorHub"));
const TripsHub = lazy(() => import("./pages/trips/TripsHub"));
const DispatchHub = lazy(() => import("./pages/dispatch/DispatchHub"));
const WorkshopHub = lazy(() => import("./pages/workshop/WorkshopHub"));
const PredictiveHub = lazy(() => import("./pages/predictive/PredictiveHub"));
const InsuranceHub = lazy(() => import("./pages/insurance/InsuranceHub"));
const IncidentsHub = lazy(() => import("./pages/incidents/IncidentsHub"));
const RegulatoryHub = lazy(() => import("./pages/regulatory/RegulatoryHub"));
const TmsHub = lazy(() => import("./pages/tms/TmsHub"));
const DeliveriesHub = lazy(() => import("./pages/deliveries/DeliveriesHub"));
const AssetsHub = lazy(() => import("./pages/assets/AssetsHub"));
const InventoryHub = lazy(() => import("./pages/inventory/InventoryHub"));
const PurchasingHub = lazy(() => import("./pages/purchasing/PurchasingHub"));
const PosHub = lazy(() => import("./pages/pos/PosHub"));
const CrmHub = lazy(() => import("./pages/crm/CrmHub"));
const FinanceHub = lazy(() => import("./pages/finance/FinanceHub"));
const ContractsHub = lazy(() => import("./pages/contracts/ContractsHub"));
const HrHub = lazy(() => import("./pages/hr/HrHub"));
const FieldHub = lazy(() => import("./pages/field/FieldHub"));
const EmployeesHub = lazy(() => import("./pages/employees/EmployeesHub"));
const SuppliersHub = lazy(() => import("./pages/suppliers/SuppliersHub"));
const CustomerPortalHub = lazy(() => import("./pages/customer-portal/CustomerPortalHub"));
const VendorPortalHub = lazy(() => import("./pages/vendor-portal/VendorPortalHub"));
const AnalyticsHub = lazy(() => import("./pages/analytics/AnalyticsHub"));
const DocumentsHub = lazy(() => import("./pages/documents/DocumentsHub"));
const AutomationHub = lazy(() => import("./pages/automation/AutomationHub"));
const IntegrationsHub = lazy(() => import("./pages/integrations/IntegrationsHub"));
const IotHub = lazy(() => import("./pages/iot/IotHub"));
const NotificationsHub = lazy(() => import("./pages/notifications/NotificationsHub"));
const SecurityHub = lazy(() => import("./pages/security/SecurityHub"));
const CompaniesHub = lazy(() => import("./pages/companies/CompaniesHub"));
const PublicPortalPage = lazy(() => import("./pages/customer-portal/PublicPortalPage"));
const PublicVendorPage = lazy(() => import("./pages/vendor-portal/PublicVendorPage"));
const PublicTrackingPage = lazy(() => import("./pages/deliveries/PublicTrackingPage"));

/**
 * The query client is built inside the tree so it can reach the toast API.
 *
 * Its one job beyond configuration: a mutation that does NOT handle its own
 * error gets a toast. That is the whole site-wide safety net — it catches the
 * silent failures without double-reporting on the forms that already render an
 * inline <ErrorState>, because those declare an `onError` of their own.
 */
function QueryHost({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
        },
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (mutation.options.onError) return;
            toast.error(error instanceof Error ? error : String(error));
          },
        }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Protected() {
  const { session, tenant, loading } = useAuth();
  const { loading: modulesLoading } = useModules();
  const { t } = useI18n();
  if (loading || modulesLoading) return <LoadingState label={t("common.loadingWorkspace")} />;
  if (!session) return <Navigate to="/login" replace />;
  if (!tenant) return <LoadingState label={t("common.preparingOrg")} />;
  return <Outlet />;
}

/** Customers moved out of the speed-limiter hub — keep pre-extraction deep
 *  links (bookmarks, printed docs) alive regardless of module enablement. */
function LegacyCustomerRedirect() {
  const { customerId } = useParams();
  return <Navigate to={`/customers/${customerId}`} replace />;
}

function PublicOnly() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
      {/* Above the router so the public quote and verify pages can report
          failures too, and so a toast survives a route change. */}
      <ToastProvider>
      <QueryHost>
        <AuthProvider>
          <ModulesProvider>
          <BrowserRouter>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
            </Route>
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            {/* Public certificate verification (QR code target) — no auth. */}
            <Route path="/verify" element={<VerifyPage />} />
            {/* Public quote review + acceptance (shared link) — no auth. */}
            <Route
              path="/q/:token"
              element={
                <Suspense fallback={<LoadingState />}>
                  <PublicQuotePage />
                </Suspense>
              }
            />

            {/* Public capability links (portal, vendor portal, delivery tracking) — no auth. */}
            <Route
              path="/portal/:token"
              element={
                <Suspense fallback={<LoadingState />}>
                  <PublicPortalPage />
                </Suspense>
              }
            />
            <Route
              path="/vendor/:token"
              element={
                <Suspense fallback={<LoadingState />}>
                  <PublicVendorPage />
                </Suspense>
              }
            />
            <Route
              path="/track/:token"
              element={
                <Suspense fallback={<LoadingState />}>
                  <PublicTrackingPage />
                </Suspense>
              }
            />
            <Route element={<Protected />}>
              <Route element={<AppLayout />}>
                <Route
                  path="/"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <DashboardPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/vehicles"
                  element={<ModuleGate module="fleet"><VehiclesPage /></ModuleGate>}
                />
                <Route
                  path="/vehicles/:id"
                  element={<ModuleGate module="fleet"><VehicleDetailPage /></ModuleGate>}
                />
                <Route
                  path="/drivers"
                  element={<ModuleGate module="drivers"><DriversPage /></ModuleGate>}
                />
                <Route
                  path="/customers"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="customers"><CustomersPage /></ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/customers/:customerId"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="customers"><CustomerDetailPage /></ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/maintenance"
                  element={<ModuleGate module="maintenance"><MaintenancePage /></ModuleGate>}
                />
                <Route
                  path="/maintenance/work-orders/:id"
                  element={<ModuleGate module="maintenance"><WorkOrderDetailPage /></ModuleGate>}
                />
                <Route
                  path="/fuel"
                  element={<ModuleGate module="fuel"><FuelPage /></ModuleGate>}
                />
                <Route
                  path="/inspections"
                  element={<ModuleGate module="inspections"><InspectionsPage /></ModuleGate>}
                />
                <Route
                  path="/inspections/new"
                  element={<ModuleGate module="inspections"><NewInspectionPage /></ModuleGate>}
                />
                <Route
                  path="/issues"
                  element={<ModuleGate module="issues"><IssuesPage /></ModuleGate>}
                />
                <Route
                  path="/renewals"
                  element={<ModuleGate module="renewals"><RenewalsPage /></ModuleGate>}
                />
                <Route
                  path="/speed-limiters/customers"
                  element={<Navigate to="/customers" replace />}
                />
                <Route
                  path="/speed-limiters/customers/:customerId"
                  element={<LegacyCustomerRedirect />}
                />
                <Route
                  path="/speed-limiters/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="speed_limiters">
                        <SpeedLimitersHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/sales/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="sales">
                        <SalesHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="reports">
                        <ReportsPage />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/gps/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="gps_tracking">
                        <GpsTrackingHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/driver-behavior/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="driver_behavior">
                        <DriverBehaviorHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/trips/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="trip_planning">
                        <TripsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/dispatch/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="dispatch">
                        <DispatchHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/workshop/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="workshop">
                        <WorkshopHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/predictive/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="predictive_ai">
                        <PredictiveHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/insurance/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="insurance_mgmt">
                        <InsuranceHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/incidents/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="incidents">
                        <IncidentsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/regulatory/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="regulatory">
                        <RegulatoryHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/tms/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="tms">
                        <TmsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/deliveries/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="logistics_delivery">
                        <DeliveriesHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/assets/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="assets">
                        <AssetsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/inventory/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="inventory">
                        <InventoryHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/purchasing/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="purchasing">
                        <PurchasingHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/pos/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="pos">
                        <PosHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/crm/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="crm">
                        <CrmHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/finance/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="finance">
                        <FinanceHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/contracts/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="contracts">
                        <ContractsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/hr/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="payroll_hr">
                        <HrHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/field/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="mobile_workforce">
                        <FieldHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/employees/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="employees">
                        <EmployeesHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/suppliers/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="suppliers">
                        <SuppliersHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/customer-portal/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="customer_portal">
                        <CustomerPortalHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/vendor-portal/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="vendor_portal">
                        <VendorPortalHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/analytics/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="bi_analytics">
                        <AnalyticsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/documents/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="documents">
                        <DocumentsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/automation/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="workflow_automation">
                        <AutomationHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/integrations/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="integrations">
                        <IntegrationsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/iot/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="iot_devices">
                        <IotHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/notifications/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="notifications">
                        <NotificationsHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/security/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="audit_security">
                        <SecurityHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route
                  path="/companies/*"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="multi_company">
                        <CompaniesHub />
                      </ModuleGate>
                    </Suspense>
                  }
                />
                <Route path="/settings/*" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </BrowserRouter>
          </ModulesProvider>
        </AuthProvider>
      </QueryHost>
      </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

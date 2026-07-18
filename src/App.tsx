import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider, useI18n } from "./i18n";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ModulesProvider, useModules } from "./context/ModulesContext";
import AppLayout from "./components/AppLayout";
import { ModuleGate } from "./components/ModuleGate";
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
const CustomersPage = lazy(() => import("./pages/customers/CustomersPage"));
const CustomerDetailPage = lazy(() => import("./pages/customers/CustomerDetailPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

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
      <QueryClientProvider client={queryClient}>
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
                  path="/reports"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ModuleGate module="reports">
                        <ReportsPage />
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
      </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AppLayout from "./components/AppLayout";
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

// recharts is heavy — split the chart pages into their own chunks
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

function Protected() {
  const { session, tenant, loading } = useAuth();
  if (loading) return <LoadingState label="Loading your workspace…" />;
  if (!session) return <Navigate to="/login" replace />;
  if (!tenant) return <LoadingState label="Preparing your organization…" />;
  return <Outlet />;
}

function PublicOnly() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
            </Route>
            <Route path="/accept-invite" element={<AcceptInvitePage />} />

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
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/maintenance" element={<MaintenancePage />} />
                <Route path="/maintenance/work-orders/:id" element={<WorkOrderDetailPage />} />
                <Route path="/fuel" element={<FuelPage />} />
                <Route path="/inspections" element={<InspectionsPage />} />
                <Route path="/inspections/new" element={<NewInspectionPage />} />
                <Route path="/issues" element={<IssuesPage />} />
                <Route path="/renewals" element={<RenewalsPage />} />
                <Route
                  path="/reports"
                  element={
                    <Suspense fallback={<LoadingState />}>
                      <ReportsPage />
                    </Suspense>
                  }
                />
                <Route path="/settings/*" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

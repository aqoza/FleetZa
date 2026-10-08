/**
 * HR & payroll — module `payroll_hr`. Leave, attendance, payroll runs and
 * payslips on top of the employees directory. Managers run everything;
 * other members see their own leave and released payslips.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const LeavePage = lazy(() => import("./LeavePage"));
const AttendancePage = lazy(() => import("./AttendancePage"));
const PayrollRunsPage = lazy(() => import("./PayrollRunsPage"));
const PayrollRunPage = lazy(() => import("./PayrollRunPage"));
const MyPayslipsPage = lazy(() => import("./MyPayslipsPage"));
const PayslipPage = lazy(() => import("./PayslipPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));

export default function HrHub() {
  const t = useT();
  const { isManager } = useAuth();
  const { pathname } = useLocation();
  // A run and a payslip carry their own headers; the hub chrome is for the tabs.
  const onTab = !/^\/hr\/(payroll|payslips)\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("hr.title")} description={t("hr.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/hr", labelKey: "hr.tab.overview", end: true, hidden: !isManager },
            { to: "/hr/leave", labelKey: "hr.tab.leave" },
            { to: "/hr/attendance", labelKey: "hr.tab.attendance", hidden: !isManager },
            { to: "/hr/payroll", labelKey: "hr.tab.payroll", hidden: !isManager },
            { to: "/hr/payslips", labelKey: "hr.tab.myPayslips", hidden: isManager },
            { to: "/hr/settings", labelKey: "hr.tab.settings", hidden: !isManager },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={isManager ? <OverviewPage /> : <Navigate to="/hr/leave" replace />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="payslips" element={<MyPayslipsPage />} />
          <Route path="payslips/:payslipId" element={<PayslipPage />} />
          {isManager && <Route path="attendance" element={<AttendancePage />} />}
          {isManager && <Route path="payroll" element={<PayrollRunsPage />} />}
          {isManager && <Route path="payroll/:runId" element={<PayrollRunPage />} />}
          {isManager && <Route path="settings" element={<SettingsPage />} />}
          <Route path="*" element={<Navigate to="/hr" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

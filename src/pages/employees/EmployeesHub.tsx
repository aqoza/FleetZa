/**
 * Employees — module `employees`. Master data for the people who work for the
 * tenant; HR & payroll, field workforce and the workshop build on it.
 *
 * Row-level security shows managers the whole directory and everyone else
 * only their own record, so the manager-only tabs are hidden for the rest.
 */
import { Suspense, lazy } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const EmployeesPage = lazy(() => import("./EmployeesPage"));
const EmployeeDetailPage = lazy(() => import("./EmployeeDetailPage"));
const DepartmentsPage = lazy(() => import("./DepartmentsPage"));
const OrgChartPage = lazy(() => import("./OrgChartPage"));
const ExpiringDocumentsPage = lazy(() => import("./ExpiringDocumentsPage"));

export default function EmployeesHub() {
  const t = useT();
  const { isManager } = useAuth();
  const { pathname } = useLocation();
  // An employee page carries its own header; the hub chrome is for the tabs.
  const onTab = /^\/employees\/?(departments|org|documents)?\/?$/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("employees.title")} description={t("employees.subtitle")} />}
      {onTab && isManager && (
        <HubNav
          tabs={[
            { to: "/employees", labelKey: "employees.tab.directory", end: true },
            { to: "/employees/departments", labelKey: "employees.tab.departments" },
            { to: "/employees/org", labelKey: "employees.tab.org" },
            { to: "/employees/documents", labelKey: "employees.tab.documents" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<EmployeesPage />} />
          {isManager && <Route path="departments" element={<DepartmentsPage />} />}
          {isManager && <Route path="org" element={<OrgChartPage />} />}
          {isManager && <Route path="documents" element={<ExpiringDocumentsPage />} />}
          <Route path=":employeeId" element={<EmployeeDetailPage />} />
        </Routes>
      </Suspense>
    </>
  );
}

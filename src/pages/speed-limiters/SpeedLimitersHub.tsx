import { Suspense, lazy } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useModules } from "../../context/ModulesContext";
import { ModuleGate } from "../../components/ModuleGate";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";
import OverviewPage from "./OverviewPage";

const CustomersPage = lazy(() => import("./CustomersPage"));
const CustomerDetailPage = lazy(() => import("./CustomerDetailPage"));
const DevicesPage = lazy(() => import("./DevicesPage"));
const JobsPage = lazy(() => import("./JobsPage"));
const JobDetailPage = lazy(() => import("./JobDetailPage"));
const CertificatesPage = lazy(() => import("./CertificatesPage"));
const CertificatePrintPage = lazy(() => import("./CertificatePrintPage"));

const TABS: Array<{ to: string; labelKey: MessageKey; end?: boolean; certOnly?: boolean }> = [
  { to: "/speed-limiters", labelKey: "speedLimiters.tab.overview", end: true },
  { to: "/speed-limiters/customers", labelKey: "speedLimiters.tab.customers" },
  { to: "/speed-limiters/devices", labelKey: "speedLimiters.tab.devices" },
  { to: "/speed-limiters/jobs", labelKey: "speedLimiters.tab.jobs" },
  { to: "/speed-limiters/certificates", labelKey: "speedLimiters.tab.certificates", certOnly: true },
];

export default function SpeedLimitersHub() {
  const t = useT();
  const { isEnabled } = useModules();
  const certificatesEnabled = isEnabled("sl_certificates");

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={t("speedLimiters.title")} description={t("speedLimiters.subtitle")} />
      </div>

      <nav className="mb-4 flex flex-wrap gap-2 print:hidden">
        {TABS.filter((tab) => !tab.certOnly || certificatesEnabled).map(({ to, labelKey, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive
                ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:customerId" element={<CustomerDetailPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobId" element={<JobDetailPage />} />
          <Route
            path="certificates"
            element={
              <ModuleGate module="sl_certificates">
                <CertificatesPage />
              </ModuleGate>
            }
          />
          <Route
            path="certificates/:certId/print"
            element={
              <ModuleGate module="sl_certificates">
                <CertificatePrintPage />
              </ModuleGate>
            }
          />
        </Routes>
      </Suspense>
    </>
  );
}

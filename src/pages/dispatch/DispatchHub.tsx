/**
 * Dispatch — module `dispatch`. Jobs with a time window, assigned to a vehicle
 * (and driver) through dispatch_assign() and moved along
 * new → assigned → en_route → on_site → completed. Rules live in
 * migration 20261008000019_dispatch.sql; shared/dispatch.ts mirrors them.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const BoardPage = lazy(() => import("./BoardPage"));
const JobsPage = lazy(() => import("./JobsPage"));
const JobDetailPage = lazy(() => import("./JobDetailPage"));
const TodayPage = lazy(() => import("./TodayPage"));
const SlaPage = lazy(() => import("./SlaPage"));

export default function DispatchHub() {
  const t = useT();
  const { pathname } = useLocation();
  // A job page carries its own header; the hub chrome is for the tabs.
  const onTab = !/^\/dispatch\/jobs\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("dispatch.title")} description={t("dispatch.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/dispatch", labelKey: "dispatch.tab.board", end: true },
            { to: "/dispatch/jobs", labelKey: "dispatch.tab.jobs" },
            { to: "/dispatch/today", labelKey: "dispatch.tab.today" },
            { to: "/dispatch/sla", labelKey: "dispatch.tab.sla" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<BoardPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:id" element={<JobDetailPage />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="sla" element={<SlaPage />} />
          <Route path="*" element={<Navigate to="/dispatch" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

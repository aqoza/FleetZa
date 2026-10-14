/**
 * Workshop — module `workshop`. Service bays and their bookings for work
 * orders, a technician time clock, parts issued from stock and a
 * productivity report. Rules live in migration 20261008000022_workshop.sql;
 * shared/workshop.ts mirrors the booking rules. The work order page shows
 * WorkOrderWorkshopPanel when the module is on.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const BoardPage = lazy(() => import("./BoardPage"));
const ClockPage = lazy(() => import("./ClockPage"));
const BaysPage = lazy(() => import("./BaysPage"));
const ProductivityPage = lazy(() => import("./ProductivityPage"));

export default function WorkshopHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("workshop.title")} description={t("workshop.subtitle")} />
      <HubNav
        tabs={[
          { to: "/workshop", labelKey: "workshop.tab.board", end: true },
          { to: "/workshop/clock", labelKey: "workshop.tab.clock" },
          { to: "/workshop/bays", labelKey: "workshop.tab.bays" },
          { to: "/workshop/productivity", labelKey: "workshop.tab.productivity" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<BoardPage />} />
          <Route path="clock" element={<ClockPage />} />
          <Route path="bays" element={<BaysPage />} />
          <Route path="productivity" element={<ProductivityPage />} />
          <Route path="*" element={<Navigate to="/workshop" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

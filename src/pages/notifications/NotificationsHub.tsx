/**
 * Notifications — module `notifications`. The inbox and per-user mutes; the
 * header bell (NotificationBell) is mounted by the app shell. Rows come from
 * app.notify, called by triggers and by the app.scan_due_* scanners that
 * public.refresh_notifications() runs.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const NotificationsPage = lazy(() => import("./NotificationsPage"));
const PreferencesPage = lazy(() => import("./PreferencesPage"));

export default function NotificationsHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("notifications.title")} description={t("notifications.subtitle")} />
      <HubNav
        tabs={[
          { to: "/notifications", labelKey: "notifications.tab.inbox", end: true },
          { to: "/notifications/preferences", labelKey: "notifications.tab.preferences" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<NotificationsPage />} />
          <Route path="preferences" element={<PreferencesPage />} />
          <Route path="*" element={<Navigate to="/notifications" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

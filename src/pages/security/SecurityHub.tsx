/**
 * Audit & security — module `audit_security`. Security checklist and
 * settings, the audit log viewer over audit_events, and member access review
 * with "sign out everywhere". Admin-only (the RPCs and audit_events RLS
 * enforce it); the idle sign-out it configures runs for every member
 * (IdleGuard in AppLayout).
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { HubNav } from "../../components/HubNav";
import { EmptyState, LoadingState, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const AuditLogPage = lazy(() => import("./AuditLogPage"));
const MembersPage = lazy(() => import("./MembersPage"));

export default function SecurityHub() {
  const t = useT();
  const { isAdmin } = useAuth();

  return (
    <>
      <PageHeader title={t("security.title")} description={t("security.subtitle")} />
      {!isAdmin ? (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title={t("security.adminsOnlyTitle")}
          description={t("security.adminsOnlyDesc")}
        />
      ) : (
        <>
          <HubNav
            tabs={[
              { to: "/security", labelKey: "security.tab.overview", end: true },
              { to: "/security/audit", labelKey: "security.tab.audit" },
              { to: "/security/members", labelKey: "security.tab.members" },
            ]}
          />
          <Suspense fallback={<LoadingState />}>
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="audit" element={<AuditLogPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="*" element={<Navigate to="/security" replace />} />
            </Routes>
          </Suspense>
        </>
      )}
    </>
  );
}

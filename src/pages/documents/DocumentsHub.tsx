/**
 * Documents — module `documents`. Files in the private `documents` bucket
 * with metadata in public.documents; RLS keeps HR files to managers and the
 * employee they belong to. Other pages attach files through EntityDocuments.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const DocumentsPage = lazy(() => import("./DocumentsPage"));

export default function DocumentsHub() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("documents.title")} description={t("documents.subtitle")} />
      <HubNav
        tabs={[
          { to: "/documents", labelKey: "documents.tab.all", end: true },
          { to: "/documents/expiring", labelKey: "documents.tab.expiring" },
        ]}
      />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<DocumentsPage key="all" mode="all" />} />
          <Route path="expiring" element={<DocumentsPage key="expiring" mode="expiring" />} />
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

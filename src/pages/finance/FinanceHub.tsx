/**
 * Finance — module `finance`. Double-entry bookkeeping: chart of accounts,
 * journal entries, expenses, and automatic posting of invoices, payments,
 * vendor bills and payroll. Rules live in migration 20261008000029_finance.sql.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";
import { SetupNotice } from "./SetupNotice";

const OverviewPage = lazy(() => import("./OverviewPage"));
const AccountsPage = lazy(() => import("./AccountsPage"));
const JournalPage = lazy(() => import("./JournalPage"));
const EntryDetailPage = lazy(() => import("./EntryDetailPage"));
const ExpensesPage = lazy(() => import("./ExpensesPage"));
const ReportsPage = lazy(() => import("./ReportsPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));

export default function FinanceHub() {
  const t = useT();
  const { pathname } = useLocation();
  // The entry page carries its own header.
  const onTab = !/^\/finance\/journal\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("finance.title")} description={t("finance.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/finance", labelKey: "finance.tab.overview", end: true },
            { to: "/finance/accounts", labelKey: "finance.tab.accounts" },
            { to: "/finance/journal", labelKey: "finance.tab.journal" },
            { to: "/finance/expenses", labelKey: "finance.tab.expenses" },
            { to: "/finance/reports", labelKey: "finance.tab.reports" },
            { to: "/finance/settings", labelKey: "finance.tab.settings" },
          ]}
        />
      )}
      <SetupNotice />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="journal/:id" element={<EntryDetailPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/finance" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

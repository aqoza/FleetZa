/**
 * The sales workspace. Quotes and orders come from the `sales` module;
 * invoices and payments from `billing`, whose tab appears only when that
 * module is enabled — the same hub-plus-sub-module shape the speed limiter
 * suite uses for certificates.
 */
import { Suspense, lazy } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useModules } from "../../context/ModulesContext";
import { ModuleGate } from "../../components/ModuleGate";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";
import OverviewPage from "./OverviewPage";

const QuotesPage = lazy(() => import("./QuotesPage"));
const QuoteDetailPage = lazy(() => import("./QuoteDetailPage"));
const OrdersPage = lazy(() => import("./OrdersPage"));
const OrderDetailPage = lazy(() => import("./OrderDetailPage"));
const InvoicesPage = lazy(() => import("./InvoicesPage"));
const InvoiceDetailPage = lazy(() => import("./InvoiceDetailPage"));
const CatalogPage = lazy(() => import("./CatalogPage"));
const SalesSettingsPage = lazy(() => import("./SalesSettingsPage"));
const ReportsPage = lazy(() => import("./ReportsPage"));
const DocumentPrintPage = lazy(() => import("./DocumentPrintPage"));

const TABS: Array<{
  to: string;
  labelKey: MessageKey;
  end?: boolean;
  billingOnly?: boolean;
}> = [
  { to: "/sales", labelKey: "sales.tab.overview", end: true },
  { to: "/sales/quotes", labelKey: "sales.tab.quotes" },
  { to: "/sales/orders", labelKey: "sales.tab.orders" },
  { to: "/sales/invoices", labelKey: "sales.tab.invoices", billingOnly: true },
  // Reporting is about money owed and collected, so it follows billing.
  { to: "/sales/reports", labelKey: "sales.tab.reports", billingOnly: true },
  { to: "/sales/catalog", labelKey: "sales.tab.catalog" },
  { to: "/sales/settings", labelKey: "sales.tab.settings" },
];

export default function SalesHub() {
  const t = useT();
  const { isEnabled } = useModules();
  const billingOn = isEnabled("billing");

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={t("sales.title")} description={t("sales.subtitle")} />
      </div>

      <nav className="mb-4 flex flex-wrap gap-2 print:hidden">
        {TABS.filter((tab) => !tab.billingOnly || billingOn).map(({ to, labelKey, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive
                ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ink-2 hover:bg-canvas"
            }
          >
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="quotes" element={<QuotesPage />} />
          <Route path="quotes/:quoteId" element={<QuoteDetailPage />} />
          <Route path="quotes/:quoteId/print" element={<DocumentPrintPage kind="quote" />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:orderId" element={<OrderDetailPage />} />
          <Route path="orders/:orderId/print" element={<DocumentPrintPage kind="order" />} />
          <Route
            path="invoices"
            element={
              <ModuleGate module="billing">
                <InvoicesPage />
              </ModuleGate>
            }
          />
          <Route
            path="invoices/:invoiceId"
            element={
              <ModuleGate module="billing">
                <InvoiceDetailPage />
              </ModuleGate>
            }
          />
          <Route
            path="invoices/:invoiceId/print"
            element={
              <ModuleGate module="billing">
                <DocumentPrintPage kind="invoice" />
              </ModuleGate>
            }
          />
          <Route
            path="reports"
            element={
              <ModuleGate module="billing">
                <ReportsPage />
              </ModuleGate>
            }
          />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="settings" element={<SalesSettingsPage />} />
        </Routes>
      </Suspense>
    </>
  );
}

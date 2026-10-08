/**
 * Inventory — module `inventory`. Items, warehouses and the stock ledger the
 * platform foundation shipped; stock only ever changes through the
 * stock_receive / stock_issue / stock_transfer / stock_adjust RPCs.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HubNav } from "../../components/HubNav";
import { LoadingState, PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

const OverviewPage = lazy(() => import("./OverviewPage"));
const ItemsPage = lazy(() => import("./ItemsPage"));
const ItemDetailPage = lazy(() => import("./ItemDetailPage"));
const MovesPage = lazy(() => import("./MovesPage"));
const WarehousesPage = lazy(() => import("./WarehousesPage"));
const ReorderPage = lazy(() => import("./ReorderPage"));
const ValuationPage = lazy(() => import("./ValuationPage"));

export default function InventoryHub() {
  const t = useT();
  const { pathname } = useLocation();
  // An item page carries its own header; the hub chrome is for the tabs.
  const onTab = !/^\/inventory\/items\/[^/]+/.test(pathname);

  return (
    <>
      {onTab && <PageHeader title={t("inventory.title")} description={t("inventory.subtitle")} />}
      {onTab && (
        <HubNav
          tabs={[
            { to: "/inventory", labelKey: "inventory.tab.overview", end: true },
            { to: "/inventory/items", labelKey: "inventory.tab.items" },
            { to: "/inventory/moves", labelKey: "inventory.tab.moves" },
            { to: "/inventory/warehouses", labelKey: "inventory.tab.warehouses" },
            { to: "/inventory/reorder", labelKey: "inventory.tab.reorder" },
            { to: "/inventory/valuation", labelKey: "inventory.tab.valuation" },
          ]}
        />
      )}
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="items/:itemId" element={<ItemDetailPage />} />
          <Route path="moves" element={<MovesPage />} />
          <Route path="warehouses" element={<WarehousesPage />} />
          <Route path="reorder" element={<ReorderPage />} />
          <Route path="valuation" element={<ValuationPage />} />
          <Route path="*" element={<Navigate to="/inventory" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

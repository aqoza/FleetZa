/**
 * Suppliers — module `suppliers`. Master data for the tenant's vendors,
 * carriers and insurers; purchasing, finance and insurance build on it.
 */
import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { LoadingState } from "../../components/ui";

const SuppliersPage = lazy(() => import("./SuppliersPage"));
const SupplierDetailPage = lazy(() => import("./SupplierDetailPage"));

export default function SuppliersHub() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route index element={<SuppliersPage />} />
        <Route path=":supplierId" element={<SupplierDetailPage />} />
      </Routes>
    </Suspense>
  );
}

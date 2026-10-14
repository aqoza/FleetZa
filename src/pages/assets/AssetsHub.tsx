/**
 * Assets — module `assets`. A register of equipment, tools, IT and other
 * assets: who or what holds each one, its history, and its depreciated book
 * value (computed in src/lib/depreciation.ts, nothing stored). Assignment,
 * return and disposal only happen through the asset_assign / asset_return /
 * asset_dispose RPCs.
 */
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LoadingState } from "../../components/ui";

const AssetsPage = lazy(() => import("./AssetsPage"));
const AssetDetailPage = lazy(() => import("./AssetDetailPage"));

export default function AssetsHub() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route index element={<AssetsPage />} />
        <Route path=":assetId" element={<AssetDetailPage />} />
        <Route path="*" element={<Navigate to="/assets" replace />} />
      </Routes>
    </Suspense>
  );
}

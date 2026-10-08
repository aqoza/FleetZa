import { Link } from "react-router-dom";
import { AlertTriangle, Boxes, PackageX, Warehouse as WarehouseIcon, Wallet } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { formatMoney } from "../../lib/format";
import { formatQty, valueByWarehouse } from "../../lib/inventory";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Bdi, Card, EmptyState, ErrorState, LoadingState, Ltr, StatCard } from "../../components/ui";
import { useInventorySummary, useLowStock, useValuation } from "./hooks";
import { itemLabel } from "./ItemsPage";

const PREVIEW = 5;

export default function OverviewPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const summaryQ = useInventorySummary();
  const lowQ = useLowStock(PREVIEW);
  const valuationQ = useValuation();

  if (summaryQ.isLoading) return <LoadingState />;
  if (summaryQ.error) return <ErrorState message={(summaryQ.error as Error).message} />;
  const s = summaryQ.data;
  if (!s) return null;

  if (s.item_count === 0 && s.warehouse_count === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-10 w-10" />}
        title={t("inventory.getStartedTitle")}
        description={t("inventory.getStartedDesc")}
      />
    );
  }

  const byWarehouse = valueByWarehouse(valuationQ.data ?? []);
  const chartHeight = Math.max(160, byWarehouse.length * 44);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={<Boxes className="h-5 w-5" />}
          tone="blue"
          label={t("inventory.kpiItems")}
          value={<Ltr>{s.item_count}</Ltr>}
          sub={tp("inventory.kpiItemsSub", s.tracked_item_count)}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          tone="green"
          label={t("inventory.kpiValue")}
          value={formatMoney(s.stock_value, tenant.currency)}
          sub={t("inventory.kpiValueSub")}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="amber"
          label={t("inventory.kpiLow")}
          value={<Ltr>{s.low_stock_count}</Ltr>}
        />
        <StatCard
          icon={<PackageX className="h-5 w-5" />}
          tone="red"
          label={t("inventory.kpiOut")}
          value={<Ltr>{s.out_of_stock_count}</Ltr>}
        />
        <StatCard
          icon={<WarehouseIcon className="h-5 w-5" />}
          tone="slate"
          label={t("inventory.kpiWarehouses")}
          value={<Ltr>{s.warehouse_count}</Ltr>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("inventory.valueByWarehouse")}</h2>
          {valuationQ.isLoading ? (
            <LoadingState />
          ) : byWarehouse.length === 0 ? (
            <p className="text-sm text-ink-3">{t("inventory.valuationEmptyDesc")}</p>
          ) : (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={byWarehouse} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                  <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={TICK_STYLE} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: CURSOR_FILL }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(value) => formatMoney(Number(value), tenant.currency)}
                  />
                  <Bar dataKey="value" name={t("inventory.value")} fill="#1d67f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{t("inventory.lowStockPreview")}</h2>
            <Link to="/inventory/reorder" className="text-sm font-medium text-brand-700 hover:underline">
              {t("inventory.seeAll")}
            </Link>
          </div>
          {lowQ.isLoading ? (
            <LoadingState />
          ) : (lowQ.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-3">{t("inventory.noLowStock")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(lowQ.data ?? []).map((r) => (
                <li key={r.item_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link to={`/inventory/items/${r.item_id}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                    <Bdi>{itemLabel(r, language)}</Bdi>
                  </Link>
                  <span className={Number(r.on_hand) <= 0 ? "text-serious tabular-nums" : "text-ink-2 tabular-nums"}>
                    <Ltr>{`${formatQty(r.on_hand)} / ${formatQty(r.reorder_point)} ${r.uom}`}</Ltr>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

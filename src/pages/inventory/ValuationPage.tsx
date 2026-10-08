import { Wallet } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { formatMoney } from "../../lib/format";
import { formatQty, sumOf, valueByWarehouse, type ValuationRow } from "../../lib/inventory";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, Card, EmptyState, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useValuation } from "./hooks";

export default function ValuationPage() {
  const t = useT();
  const tenant = useTenant();
  const { data, isLoading, error } = useValuation();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="h-10 w-10" />}
        title={t("inventory.valuationEmptyTitle")}
        description={t("inventory.valuationEmptyDesc")}
      />
    );
  }

  const byWarehouse = valueByWarehouse(rows);
  const total = sumOf(rows, (r) => r.stock_value);
  const chartHeight = Math.max(160, byWarehouse.length * 44);

  const columns: Array<DataTableColumn<ValuationRow>> = [
    {
      id: "warehouse",
      header: t("inventory.warehouse"),
      cell: (r) => <span className="font-medium text-ink"><Bdi>{r.warehouse_name}</Bdi></span>,
      sortValue: (r) => r.warehouse_name,
      exportValue: (r) => r.warehouse_name,
    },
    {
      id: "category",
      header: t("inventory.category"),
      cell: (r) => <span className="text-ink-2"><Bdi>{r.category ?? t("inventory.uncategorized")}</Bdi></span>,
      sortValue: (r) => r.category ?? "",
      exportValue: (r) => r.category ?? "",
    },
    {
      id: "items",
      header: t("inventory.itemCount"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2"><Ltr>{r.item_count}</Ltr></span>,
      sortValue: (r) => r.item_count,
      exportValue: (r) => r.item_count,
    },
    {
      id: "onHand",
      header: t("inventory.onHand"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2"><Ltr>{formatQty(r.on_hand)}</Ltr></span>,
      sortValue: (r) => Number(r.on_hand),
      exportValue: (r) => r.on_hand,
    },
    {
      id: "value",
      header: t("inventory.value"),
      align: "end",
      cell: (r) => <span className="font-medium tabular-nums text-ink">{formatMoney(r.stock_value, tenant.currency)}</span>,
      sortValue: (r) => Number(r.stock_value),
      exportValue: (r) => r.stock_value,
      dir: "ltr",
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">{t("inventory.valuationHint")}</p>
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{t("inventory.valueByWarehouse")}</h2>
          <span className="text-sm text-ink-3">
            {t("inventory.grandTotal")}:{" "}
            <span className="font-semibold tabular-nums text-ink">{formatMoney(total, tenant.currency)}</span>
          </span>
        </div>
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
              <Bar dataKey="value" name={t("inventory.value")} fill="#0d9488" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <DataTable<ValuationRow>
        tableId="inventory-valuation"
        exportName="stock-valuation"
        rows={rows}
        rowKey={(r) => `${r.warehouse_id}:${r.category ?? ""}`}
        columns={columns}
      />
    </div>
  );
}

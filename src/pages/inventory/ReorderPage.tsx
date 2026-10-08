import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { formatMoney } from "../../lib/format";
import { formatQty, sumOf } from "../../lib/inventory";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, EmptyState, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useLowStock, type LowStockRow } from "./hooks";
import { itemLabel } from "./ItemsPage";
import { stockStateMeta } from "./labels";

/** The server returns the most-short items first, capped at this many. */
const LIMIT = 200;

export default function ReorderPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { data, isLoading, error } = useLowStock(LIMIT);
  const rows = data ?? [];

  const cost = (r: LowStockRow) => Number(r.suggested_qty) * Number(r.cost_price);

  const columns: Array<DataTableColumn<LowStockRow>> = [
    {
      id: "item",
      header: t("inventory.item"),
      cell: (r) => (
        <>
          <Link to={`/inventory/items/${r.item_id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{itemLabel(r, language)}</Bdi>
          </Link>
          {r.sku && <div className="text-xs text-ink-3"><Ltr>{r.sku}</Ltr></div>}
        </>
      ),
      sortValue: (r) => itemLabel(r, language),
      exportValue: (r) => r.name,
    },
    {
      id: "onHand",
      header: t("inventory.onHand"),
      align: "end",
      cell: (r) => {
        const st = stockStateMeta[Number(r.on_hand) <= 0 ? "out" : "low"];
        return (
          <span className="inline-flex items-center gap-2">
            <span className="tabular-nums text-ink"><Ltr>{`${formatQty(r.on_hand)} ${r.uom}`}</Ltr></span>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
          </span>
        );
      },
      sortValue: (r) => Number(r.on_hand),
      exportValue: (r) => r.on_hand,
    },
    {
      id: "reorderPoint",
      header: t("inventory.reorderPoint"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2"><Ltr>{formatQty(r.reorder_point)}</Ltr></span>,
      sortValue: (r) => r.reorder_point,
      exportValue: (r) => r.reorder_point ?? "",
    },
    {
      id: "suggested",
      header: t("inventory.suggestedQty"),
      align: "end",
      cell: (r) => (
        <span className="font-medium tabular-nums text-ink"><Ltr>{`${formatQty(r.suggested_qty)} ${r.uom}`}</Ltr></span>
      ),
      sortValue: (r) => Number(r.suggested_qty),
      exportValue: (r) => r.suggested_qty,
    },
    {
      id: "cost",
      header: t("inventory.estimatedCost"),
      align: "end",
      minBreakpoint: "md",
      cell: (r) => <span className="tabular-nums text-ink-2">{formatMoney(cost(r), tenant.currency)}</span>,
      sortValue: cost,
      exportValue: cost,
      dir: "ltr",
    },
  ];

  return (
    <>
      <p className="mb-4 text-sm text-ink-3">{t("inventory.reorderHint")}</p>
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<LowStockRow>
          tableId="inventory-reorder"
          exportName="reorder-list"
          rows={rows}
          rowKey={(r) => r.item_id}
          onRowClick={(r) => navigate(`/inventory/items/${r.item_id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={<ShoppingCart className="h-10 w-10" />}
              title={t("inventory.reorderEmptyTitle")}
              description={t("inventory.reorderEmptyDesc")}
            />
          }
          footer={
            rows.length > 0 ? (
              <div className="flex justify-end gap-2 px-4 py-3 text-sm">
                <span className="text-ink-3">{t("inventory.estimatedCost")}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatMoney(sumOf(rows, cost), tenant.currency)}
                </span>
              </div>
            ) : undefined
          }
        />
      )}
    </>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { getRow, listPage, listRows } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { formatQty, stockState, sumOf } from "../../lib/inventory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Ltr, Modal, PageHeader, Pagination, Table,
} from "../../components/ui";
import { ItemForm } from "./ItemForm";
import { StockOpModal } from "./StockOpModal";
import { useWarehouses } from "./hooks";
import { itemLabel } from "./ItemsPage";
import { itemTypes, moveTypes, opLabels, stockStateMeta } from "./labels";
import type { InventoryItem, StockLevel, StockMove, StockOp } from "./types";

const PAGE_SIZE = 20;

export default function ItemDetailPage() {
  const { itemId = "" } = useParams();
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const [op, setOp] = useState<StockOp | null>(null);
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(0);
  const warehousesQ = useWarehouses();
  const warehouseName = useMemo(() => {
    const m = new Map((warehousesQ.data ?? []).map((w) => [w.id, w.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [warehousesQ.data]);

  const itemQ = useQuery({
    queryKey: ["inventory_items", "one", itemId],
    queryFn: () => getRow<InventoryItem>("inventory_items", itemId),
  });
  // One row per warehouse the item has touched: bounded by the warehouse count.
  const levelsQ = useQuery({
    queryKey: ["stock_levels", "item", itemId],
    queryFn: () => listRows<StockLevel>("stock_levels", (q) => q.eq("item_id", itemId).limit(500)),
  });
  const movesQ = useQuery({
    queryKey: ["stock_moves", "item", itemId, page],
    queryFn: () =>
      listPage<StockMove>("stock_moves", page, PAGE_SIZE, (q) =>
        q.eq("item_id", itemId).order("moved_at", { ascending: false }).order("created_at", { ascending: false }),
      ),
  });

  if (itemQ.isLoading) return <LoadingState />;
  if (itemQ.error) return <ErrorState message={(itemQ.error as Error).message} />;
  const item = itemQ.data;
  if (!item) return <ErrorState message={t("inventory.notFound")} />;

  const levels = levelsQ.data ?? [];
  const total = sumOf(levels, (l) => l.on_hand);
  const state = stockStateMeta[stockState(total, item.reorder_point, item.track_stock)];
  const ops: StockOp[] = ["receive", "issue", "transfer", "adjust"];

  const detail = (label: string, value: ReactNode) => (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );

  return (
    <>
      <Link to="/inventory/items" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("inventory.tab.items")}
      </Link>
      <PageHeader
        title={itemLabel(item, language)}
        description={[item.sku, t(itemTypes[item.item_type])].filter(Boolean).join(" · ")}
        actions={
          isManager ? (
            <div className="flex flex-wrap gap-2">
              {item.track_stock && item.active &&
                ops.map((o) => (
                  <Button key={o} variant={o === "receive" ? "primary" : "secondary"} onClick={() => setOp(o)}>
                    {t(opLabels[o].button)}
                  </Button>
                ))}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("inventory.details")}</h2>
          <dl className="grid grid-cols-2 gap-3">
            {detail(t("inventory.onHand"), item.track_stock ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Ltr>{`${formatQty(total)} ${item.uom}`}</Ltr>
                <Badge tone={state.tone}>{t(state.labelKey)}</Badge>
              </span>
            ) : t("inventory.untracked"))}
            {detail(t("inventory.costPrice"), formatMoney(item.cost_price, tenant.currency))}
            {detail(t("inventory.value"), item.track_stock ? formatMoney(total * Number(item.cost_price), tenant.currency) : "—")}
            {detail(t("inventory.salePrice"), item.sale_price != null ? formatMoney(item.sale_price, tenant.currency) : "—")}
            {detail(t("inventory.reorderPoint"), <Ltr>{formatQty(item.reorder_point)}</Ltr>)}
            {detail(t("inventory.reorderQty"), <Ltr>{formatQty(item.reorder_qty)}</Ltr>)}
            {detail(t("inventory.category"), item.category ? <Bdi>{item.category}</Bdi> : "—")}
            {detail(t("inventory.barcode"), item.barcode ? <Ltr>{item.barcode}</Ltr> : "—")}
            {isEnabled("suppliers") && item.preferred_supplier_id &&
              detail(t("inventory.preferredSupplier"), (
                <Link to={`/suppliers/${item.preferred_supplier_id}`} className="text-brand-700 hover:underline">
                  {t("action.view")}
                </Link>
              ))}
            {detail(t("common.status"), item.active
              ? <Badge tone="green">{t("inventory.active")}</Badge>
              : <Badge tone="slate">{t("inventory.inactive")}</Badge>)}
          </dl>
          {item.description && <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{item.description}</p>}
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t("inventory.stockByWarehouse")}</h2>
          {levelsQ.isLoading ? (
            <LoadingState />
          ) : levels.length === 0 ? (
            <p className="text-sm text-ink-3">{t("inventory.noStockYet")}</p>
          ) : (
            <Table headers={[t("inventory.warehouse"), t("inventory.onHand"), t("inventory.value")]}>
              {levels.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-3 py-2 text-sm text-ink"><Bdi>{warehouseName(l.warehouse_id)}</Bdi></td>
                  <td className="px-3 py-2 text-sm tabular-nums text-ink-2"><Ltr>{`${formatQty(l.on_hand)} ${item.uom}`}</Ltr></td>
                  <td className="px-3 py-2 text-sm tabular-nums text-ink-2">
                    {formatMoney(Number(l.on_hand) * Number(item.cost_price), tenant.currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="px-3 py-2 text-sm text-ink">{t("inventory.total")}</td>
                <td className="px-3 py-2 text-sm tabular-nums text-ink"><Ltr>{`${formatQty(total)} ${item.uom}`}</Ltr></td>
                <td className="px-3 py-2 text-sm tabular-nums text-ink">
                  {formatMoney(total * Number(item.cost_price), tenant.currency)}
                </td>
              </tr>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("inventory.history")}</h2>
        {movesQ.isLoading ? (
          <LoadingState />
        ) : movesQ.error ? (
          <ErrorState message={(movesQ.error as Error).message} />
        ) : (movesQ.data?.rows ?? []).length === 0 ? (
          <EmptyState title={t("inventory.noMoves")} />
        ) : (
          <>
            <Table
              headers={[
                t("inventory.movedAt"), t("inventory.moveType"), t("inventory.warehouse"),
                t("inventory.quantity"), t("inventory.onHandAfter"), t("inventory.notes"),
              ]}
            >
              {(movesQ.data?.rows ?? []).map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-3 py-2 text-sm text-ink-2 whitespace-nowrap">{formatDateTime(m.moved_at)}</td>
                  <td className="px-3 py-2 text-sm">
                    <Badge tone={moveTypes[m.move_type]?.tone ?? "slate"}>
                      {moveTypes[m.move_type] ? t(moveTypes[m.move_type].labelKey) : m.move_type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-sm text-ink-2"><Bdi>{warehouseName(m.warehouse_id)}</Bdi></td>
                  <td className="px-3 py-2 text-sm tabular-nums text-ink">
                    <Ltr>{`${Number(m.quantity) > 0 ? "+" : ""}${formatQty(m.quantity)}`}</Ltr>
                  </td>
                  <td className="px-3 py-2 text-sm tabular-nums text-ink-2"><Ltr>{formatQty(m.on_hand_after)}</Ltr></td>
                  <td className="px-3 py-2 text-sm text-ink-3"><Bdi>{m.notes ?? ""}</Bdi></td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={movesQ.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      <StockOpModal op={op} itemId={item.id} onClose={() => setOp(null)} />
      <Modal title={t("inventory.editItem")} open={editing} onClose={() => setEditing(false)} wide>
        {editing && <ItemForm item={item} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      </Modal>
    </>
  );
}

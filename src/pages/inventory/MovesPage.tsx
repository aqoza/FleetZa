import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Plus } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { formatQty } from "../../lib/inventory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Pagination, Select,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { StockOpModal } from "./StockOpModal";
import { useInventoryItemPicker, useWarehouses } from "./hooks";
import { itemLabel } from "./ItemsPage";
import { moveTypes, opLabels } from "./labels";
import type { InventoryItem, MoveType, StockMove, StockOp } from "./types";

const PAGE_SIZE = 50;

type MoveRow = StockMove & { inventory_items: Pick<InventoryItem, "name" | "name_ar" | "sku" | "uom"> | null };

export default function MovesPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const [item, setItem] = useState("");
  const [warehouse, setWarehouse] = useState("all");
  const [moveType, setMoveType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [op, setOp] = useState<StockOp | null>(null);
  const itemPicker = useInventoryItemPicker(item, { activeOnly: false });
  const warehousesQ = useWarehouses();
  const warehouseName = useMemo(() => {
    const m = new Map((warehousesQ.data ?? []).map((w) => [w.id, w.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [warehousesQ.data]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["stock_moves", "list", { page, item, warehouse, moveType, from, to }],
    queryFn: () =>
      listPage<MoveRow>("stock_moves", page, PAGE_SIZE, (q) => {
        let f = q.select("*, inventory_items(name, name_ar, sku, uom)");
        if (item) f = f.eq("item_id", item);
        if (warehouse !== "all") f = f.eq("warehouse_id", warehouse);
        if (moveType !== "all") f = f.eq("move_type", moveType);
        if (from) f = f.gte("moved_at", from);
        // Inclusive of the whole "to" day.
        if (to) f = f.lt("moved_at", new Date(new Date(to).getTime() + 86_400_000).toISOString().slice(0, 10));
        return f.order("moved_at", { ascending: false }).order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const reset = () => setPage(0);

  const columns: Array<DataTableColumn<MoveRow>> = [
    {
      id: "date",
      header: t("inventory.movedAt"),
      minBreakpoint: "md",
      cell: (m) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(m.moved_at)}</span>,
      sortValue: (m) => m.moved_at,
      exportValue: (m) => m.moved_at,
    },
    {
      id: "item",
      header: t("inventory.item"),
      cell: (m) => (
        <>
          <Link to={`/inventory/items/${m.item_id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{m.inventory_items ? itemLabel(m.inventory_items, language) : "—"}</Bdi>
          </Link>
          {/* The date column folds in here on phones. */}
          <div className="text-xs text-ink-3 md:hidden">{formatDateTime(m.moved_at)}</div>
        </>
      ),
      sortValue: (m) => (m.inventory_items ? itemLabel(m.inventory_items, language) : ""),
      exportValue: (m) => m.inventory_items?.name ?? "",
    },
    {
      id: "type",
      header: t("inventory.moveType"),
      cell: (m) => {
        const meta = moveTypes[m.move_type as MoveType];
        return <Badge tone={meta?.tone ?? "slate"}>{meta ? t(meta.labelKey) : m.move_type}</Badge>;
      },
      sortValue: (m) => m.move_type,
      exportValue: (m) => (moveTypes[m.move_type] ? t(moveTypes[m.move_type].labelKey) : m.move_type),
    },
    {
      id: "warehouse",
      header: t("inventory.warehouse"),
      minBreakpoint: "md",
      cell: (m) => <span className="text-ink-2"><Bdi>{warehouseName(m.warehouse_id)}</Bdi></span>,
      sortValue: (m) => warehouseName(m.warehouse_id),
      exportValue: (m) => warehouseName(m.warehouse_id),
    },
    {
      id: "qty",
      header: t("inventory.quantity"),
      align: "end",
      cell: (m) => (
        <span className="whitespace-nowrap tabular-nums text-ink">
          <Ltr>{`${Number(m.quantity) > 0 ? "+" : ""}${formatQty(m.quantity)} ${m.inventory_items?.uom ?? ""}`}</Ltr>
        </span>
      ),
      sortValue: (m) => Number(m.quantity),
      exportValue: (m) => m.quantity,
    },
    {
      id: "after",
      header: t("inventory.onHandAfter"),
      align: "end",
      minBreakpoint: "lg",
      cell: (m) => <span className="tabular-nums text-ink-2"><Ltr>{formatQty(m.on_hand_after)}</Ltr></span>,
      sortValue: (m) => m.on_hand_after,
      exportValue: (m) => m.on_hand_after ?? "",
    },
    {
      id: "cost",
      header: t("inventory.unitCost"),
      align: "end",
      minBreakpoint: "xl",
      defaultHidden: true,
      cell: (m) => (
        <span className="tabular-nums text-ink-2">
          {m.unit_cost != null ? formatMoney(m.unit_cost, tenant.currency) : "—"}
        </span>
      ),
      sortValue: (m) => m.unit_cost,
      exportValue: (m) => m.unit_cost ?? "",
      dir: "ltr",
    },
    {
      id: "notes",
      header: t("inventory.notes"),
      minBreakpoint: "lg",
      cell: (m) => <span className="text-ink-3"><Bdi>{m.notes ?? ""}</Bdi></span>,
      exportValue: (m) => m.notes ?? "",
    },
  ];

  const filtersOn = !!item || warehouse !== "all" || moveType !== "all" || !!from || !!to;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <Combobox
            {...itemPicker}
            value={item}
            onChange={(v) => {
              setItem(v);
              reset();
            }}
            placeholder={t("inventory.anyItem")}
          />
        </div>
        <Select value={warehouse} onChange={(e) => { setWarehouse(e.target.value); reset(); }} className="w-full sm:w-auto sm:max-w-48">
          <option value="all">{t("inventory.allWarehouses")}</option>
          {(warehousesQ.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </Select>
        <Select value={moveType} onChange={(e) => { setMoveType(e.target.value); reset(); }} className="w-full sm:w-auto sm:max-w-44">
          <option value="all">{t("inventory.allMoveTypes")}</option>
          {Object.entries(moveTypes).map(([v, m]) => (
            <option key={v} value={v}>{t(m.labelKey)}</option>
          ))}
        </Select>
        <label className="flex w-full items-center gap-2 text-sm text-ink-3 sm:w-auto">
          {t("inventory.from")}
          <Input type="date" dir="ltr" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} className="flex-1 sm:w-40 sm:flex-none" />
        </label>
        <label className="flex w-full items-center gap-2 text-sm text-ink-3 sm:w-auto">
          {t("inventory.to")}
          <Input type="date" dir="ltr" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} className="flex-1 sm:w-40 sm:flex-none" />
        </label>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {(["receive", "issue", "transfer"] as StockOp[]).map((o) => (
              <Button key={o} variant={o === "receive" ? "primary" : "secondary"} onClick={() => setOp(o)}>
                {o === "receive" && <Plus className="h-4 w-4" />} {t(opLabels[o].button)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<MoveRow>
          tableId="inventory-moves"
          exportName="stock-moves"
          rows={rows}
          rowKey={(m) => m.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<ArrowLeftRight className="h-10 w-10" />}
              title={filtersOn ? t("inventory.itemsEmptyFilteredTitle") : t("inventory.movesEmptyTitle")}
              description={filtersOn ? t("inventory.itemsEmptyFilteredDesc") : t("inventory.movesEmptyDesc")}
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}
      <StockOpModal op={op} onClose={() => setOp(null)} />
    </>
  );
}

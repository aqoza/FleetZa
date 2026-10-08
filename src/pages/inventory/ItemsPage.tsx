import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, listPage, listRows, sanitizeSearch } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { formatMoney } from "../../lib/format";
import { formatQty, stockState, totalsByItem } from "../../lib/inventory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { ItemForm } from "./ItemForm";
import { itemTypes, stockStateMeta } from "./labels";
import type { InventoryItem, StockLevel } from "./types";

const PAGE_SIZE = 25;

export function itemLabel(i: Pick<InventoryItem, "name" | "name_ar">, language: string): string {
  return language === "ar" && i.name_ar ? i.name_ar : i.name;
}

export default function ItemsPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [actionError, setActionError] = useState("");

  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory_items", "list", { page, term, type: typeFilter, active: activeFilter }],
    queryFn: () =>
      listPage<InventoryItem>("inventory_items", page, PAGE_SIZE, (q) => {
        let f = q;
        if (typeFilter !== "all") f = f.eq("item_type", typeFilter);
        if (activeFilter !== "all") f = f.eq("active", activeFilter === "active");
        if (term) {
          f = f.or(
            `name.ilike.%${term}%,name_ar.ilike.%${term}%,sku.ilike.%${term}%,` +
              `barcode.ilike.%${term}%,category.ilike.%${term}%`,
          );
        }
        return f.order("name");
      }),
  });
  const items = data?.rows ?? [];

  // Stock for the visible page only: items × warehouses, bounded by the page.
  const itemIds = useMemo(() => (data?.rows ?? []).map((i) => i.id), [data]);
  const levelsQ = useQuery({
    queryKey: ["stock_levels", "items", itemIds],
    queryFn: () =>
      listRows<StockLevel>("stock_levels", (q) => q.select("item_id, on_hand").in("item_id", itemIds)),
    enabled: itemIds.length > 0,
  });
  const totals = useMemo(() => totalsByItem(levelsQ.data ?? []), [levelsQ.data]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("inventory_items", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
      void qc.invalidateQueries({ queryKey: ["inventory_report"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("inventory.itemDeleteFailed"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || typeFilter !== "all" || activeFilter !== "active";

  const columns: Array<DataTableColumn<InventoryItem>> = [
    {
      id: "item",
      header: t("inventory.item"),
      cell: (i) => (
        <>
          <Link to={`/inventory/items/${i.id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{itemLabel(i, language)}</Bdi>
          </Link>
          <div className="text-xs text-ink-3">
            {i.sku && <Ltr>{i.sku}</Ltr>}
            {i.sku && i.category && " · "}
            {i.category && <Bdi>{i.category}</Bdi>}
          </div>
        </>
      ),
      sortValue: (i) => itemLabel(i, language),
      exportValue: (i) => i.name,
    },
    {
      id: "sku",
      header: t("inventory.sku"),
      defaultHidden: true,
      cell: (i) => <span className="text-ink-2"><Ltr>{i.sku ?? "—"}</Ltr></span>,
      sortValue: (i) => i.sku,
      exportValue: (i) => i.sku ?? "",
      dir: "ltr",
    },
    {
      id: "type",
      header: t("inventory.itemTypeLabel"),
      minBreakpoint: "lg",
      cell: (i) => <span className="text-ink-2">{t(itemTypes[i.item_type])}</span>,
      sortValue: (i) => t(itemTypes[i.item_type]),
      exportValue: (i) => t(itemTypes[i.item_type]),
    },
    {
      id: "onHand",
      header: t("inventory.onHand"),
      align: "end",
      cell: (i) => {
        if (!i.track_stock) return <span className="text-ink-3">{t("inventory.untracked")}</span>;
        const qty = totals.get(i.id) ?? 0;
        const st = stockStateMeta[stockState(qty, i.reorder_point, i.track_stock)];
        return (
          <span className="inline-flex items-center gap-2">
            <span className="text-ink tabular-nums"><Ltr>{`${formatQty(qty)} ${i.uom}`}</Ltr></span>
            {st.tone !== "green" && <Badge tone={st.tone}>{t(st.labelKey)}</Badge>}
          </span>
        );
      },
      sortValue: (i) => (i.track_stock ? totals.get(i.id) ?? 0 : null),
      exportValue: (i) => (i.track_stock ? totals.get(i.id) ?? 0 : ""),
    },
    {
      id: "cost",
      header: t("inventory.costPrice"),
      align: "end",
      minBreakpoint: "md",
      cell: (i) => <span className="text-ink-2 tabular-nums">{formatMoney(i.cost_price, tenant.currency)}</span>,
      sortValue: (i) => i.cost_price,
      exportValue: (i) => i.cost_price,
      dir: "ltr",
    },
    {
      id: "value",
      header: t("inventory.value"),
      align: "end",
      minBreakpoint: "xl",
      cell: (i) => (
        <span className="text-ink-2 tabular-nums">
          {i.track_stock ? formatMoney((totals.get(i.id) ?? 0) * Number(i.cost_price), tenant.currency) : "—"}
        </span>
      ),
      sortValue: (i) => (i.track_stock ? (totals.get(i.id) ?? 0) * Number(i.cost_price) : null),
      exportValue: (i) => (i.track_stock ? (totals.get(i.id) ?? 0) * Number(i.cost_price) : ""),
      dir: "ltr",
    },
    {
      id: "reorder",
      header: t("inventory.reorderPoint"),
      align: "end",
      minBreakpoint: "xl",
      defaultHidden: true,
      cell: (i) => <span className="text-ink-2 tabular-nums">{formatQty(i.reorder_point)}</span>,
      sortValue: (i) => i.reorder_point,
      exportValue: (i) => i.reorder_point ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      minBreakpoint: "md",
      cell: (i) =>
        i.active ? <Badge tone="green">{t("inventory.active")}</Badge> : <Badge tone="slate">{t("inventory.inactive")}</Badge>,
      sortValue: (i) => (i.active ? 1 : 0),
      exportValue: (i) => (i.active ? t("inventory.active") : t("inventory.inactive")),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (i) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(i);
                  }}
                  aria-label={t("inventory.editItem")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(i);
                  }}
                  aria-label={t("inventory.deleteItem")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<InventoryItem>,
        ]
      : []),
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("inventory.searchItems")}
          className="max-w-80"
        />
        <Select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("inventory.allTypes")}</option>
          {Object.entries(itemTypes).map(([v, k]) => (
            <option key={v} value={v}>{t(k)}</option>
          ))}
        </Select>
        <Select
          value={activeFilter}
          onChange={(e) => {
            setActiveFilter(e.target.value as typeof activeFilter);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="active">{t("inventory.activeOnly")}</option>
          <option value="inactive">{t("inventory.inactiveOnly")}</option>
          <option value="all">{t("inventory.allItems")}</option>
        </Select>
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("inventory.newItem")}
            </Button>
          </div>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!isLoading && !error && (
        <DataTable<InventoryItem>
          tableId="inventory-items"
          exportName="inventory-items"
          rows={items}
          rowKey={(i) => i.id}
          onRowClick={(i) => navigate(`/inventory/items/${i.id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={<Package className="h-10 w-10" />}
              title={filtersOn ? t("inventory.itemsEmptyFilteredTitle") : t("inventory.itemsEmptyTitle")}
              description={filtersOn ? t("inventory.itemsEmptyFilteredDesc") : t("inventory.itemsEmptyDesc")}
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("inventory.newItem")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
        />
      )}

      <Modal title={t("inventory.newItem")} open={adding} onClose={() => setAdding(false)} wide>
        <ItemForm
          onDone={(saved) => {
            setAdding(false);
            navigate(`/inventory/items/${saved.id}`);
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>
      <Modal title={t("inventory.editItem")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <ItemForm item={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("inventory.deleteItem")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("inventory.deleteItemConfirm", { name: bdiText(deleting.name) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("inventory.deleteItem")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

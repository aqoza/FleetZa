import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, listPage, sanitizeSearch } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { bookValue } from "../../lib/depreciation";
import { formatMoney } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Input, LoadingState, Ltr, Modal, PageHeader, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { AssetForm } from "./AssetForm";
import { WarrantyBadge } from "./shared";
import { categories, currencyDecimals, depreciationInput, holderLabel, statuses, todayIso } from "./labels";
import { ASSET_SELECT, type Asset } from "./types";

const PAGE_SIZE = 25;

export default function AssetsPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [actionError, setActionError] = useState("");

  const term = sanitizeSearch(search);
  const today = todayIso();
  const decimals = currencyDecimals(tenant.currency);

  const { data, isLoading, error } = useQuery({
    queryKey: ["assets", "list", { page, term, category, status }],
    queryFn: () =>
      listPage<Asset>("assets", page, PAGE_SIZE, (q) => {
        let f = q.select(ASSET_SELECT);
        if (category !== "all") f = f.eq("category", category);
        if (status === "active") f = f.neq("status", "disposed");
        else if (status !== "all") f = f.eq("status", status);
        if (term) {
          f = f.or(
            `name.ilike.%${term}%,doc_number.ilike.%${term}%,serial_number.ilike.%${term}%,` +
              `model.ilike.%${term}%,manufacturer.ilike.%${term}%,location.ilike.%${term}%`,
          );
        }
        return f.order("name");
      }),
  });
  const rows = data?.rows ?? [];
  const book = (a: Asset) =>
    a.status === "disposed" ? 0 : bookValue(depreciationInput(a), today, decimals);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("assets", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["assets"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || category !== "all" || status !== "active";
  const pageCost = rows.reduce((s, a) => s + Number(a.purchase_cost ?? 0), 0);
  const pageBook = rows.reduce((s, a) => s + book(a), 0);

  const columns: Array<DataTableColumn<Asset>> = [
    {
      id: "name",
      header: t("assets.col.name"),
      cell: (a) => (
        <>
          <Link to={`/assets/${a.id}`} className="font-medium text-brand-700 hover:underline">
            <Bdi>{a.name}</Bdi>
          </Link>
          <div className="text-xs text-ink-3">
            {a.doc_number && <Ltr>{a.doc_number}</Ltr>}
            {a.serial_number && (
              <span className="hidden sm:inline">
                {a.doc_number && " · "}
                <Ltr>{a.serial_number}</Ltr>
              </span>
            )}
          </div>
        </>
      ),
      sortValue: (a) => a.name,
      exportValue: (a) => a.name,
    },
    {
      id: "number",
      header: t("assets.col.number"),
      defaultHidden: true,
      cell: (a) => <span className="text-ink-2">{a.doc_number ?? "—"}</span>,
      sortValue: (a) => a.doc_number,
      exportValue: (a) => a.doc_number ?? "",
      dir: "ltr",
    },
    {
      id: "category",
      header: t("assets.col.category"),
      minBreakpoint: "lg",
      cell: (a) => <span className="text-ink-2">{t(categories[a.category])}</span>,
      sortValue: (a) => t(categories[a.category]),
      exportValue: (a) => t(categories[a.category]),
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (a) => (
        <span className="whitespace-nowrap">
          <Badge tone={statuses[a.status].tone}>{t(statuses[a.status].labelKey)}</Badge>
        </span>
      ),
      sortValue: (a) => t(statuses[a.status].labelKey),
      exportValue: (a) => t(statuses[a.status].labelKey),
    },
    {
      id: "assigned",
      header: t("assets.col.assigned"),
      minBreakpoint: "md",
      cell: (a) => {
        const h = holderLabel(a, language);
        return h ? <Bdi className="text-ink-2">{h}</Bdi> : <span className="text-ink-3">—</span>;
      },
      sortValue: (a) => holderLabel(a, language) || null,
      exportValue: (a) => holderLabel(a, language),
    },
    {
      id: "location",
      header: t("assets.col.location"),
      minBreakpoint: "xl",
      cell: (a) => (a.location ? <Bdi className="text-ink-2">{a.location}</Bdi> : <span className="text-ink-3">—</span>),
      sortValue: (a) => a.location,
      exportValue: (a) => a.location ?? "",
    },
    {
      id: "warranty",
      header: t("assets.col.warranty"),
      minBreakpoint: "xl",
      cell: (a) =>
        a.status === "disposed" ? null : (
          <span className="whitespace-nowrap">
            <WarrantyBadge expiry={a.warranty_expiry} />
          </span>
        ),
      sortValue: (a) => a.warranty_expiry,
      exportValue: (a) => a.warranty_expiry ?? "",
    },
    {
      id: "cost",
      header: t("assets.totalCost"),
      align: "end",
      minBreakpoint: "lg",
      defaultHidden: true,
      cell: (a) => (
        <span className="text-ink-2 tabular-nums">
          {a.purchase_cost != null ? formatMoney(a.purchase_cost, tenant.currency) : "—"}
        </span>
      ),
      sortValue: (a) => a.purchase_cost,
      exportValue: (a) => a.purchase_cost ?? "",
      dir: "ltr",
    },
    {
      id: "book",
      header: t("assets.col.bookValue"),
      align: "end",
      minBreakpoint: "sm",
      cell: (a) => (
        <span className="text-ink tabular-nums">
          {a.purchase_cost != null ? formatMoney(book(a), tenant.currency) : "—"}
        </span>
      ),
      sortValue: (a) => (a.purchase_cost != null ? book(a) : null),
      exportValue: (a) => (a.purchase_cost != null ? book(a) : ""),
      dir: "ltr",
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (a) =>
              a.status === "disposed" ? (
                <div className="flex justify-end">
                  <button
                    className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(a);
                    }}
                    aria-label={t("action.delete")}
                    title={t("action.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex justify-end gap-1">
                  <button
                    className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(a);
                    }}
                    aria-label={t("assets.edit")}
                    title={t("action.edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(a);
                    }}
                    aria-label={t("action.delete")}
                    title={t("action.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ),
          } satisfies DataTableColumn<Asset>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t("assets.title")} description={t("assets.subtitle")} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("assets.search")}
          className="max-w-80"
        />
        <Select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("assets.allCategories")}</option>
          {Object.entries(categories).map(([v, k]) => (
            <option key={v} value={v}>{t(k)}</option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="active">{t("assets.notDisposed")}</option>
          <option value="all">{t("assets.allStatuses")}</option>
          {Object.entries(statuses).map(([v, s]) => (
            <option key={v} value={v}>{t(s.labelKey)}</option>
          ))}
        </Select>
        {isManager && (
          <div className="ms-auto">
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("assets.newAsset")}
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
        <>
          {rows.length > 0 && (
            <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
              <span>{tp("assets.assetCount", data?.total ?? 0)}</span>
              <span>
                {t("assets.onPage")}: {t("assets.totalCost")}{" "}
                <span className="text-ink-2 tabular-nums"><Ltr>{formatMoney(pageCost, tenant.currency)}</Ltr></span>
                {" · "}
                {t("assets.totalBook")}{" "}
                <span className="text-ink-2 tabular-nums"><Ltr>{formatMoney(pageBook, tenant.currency)}</Ltr></span>
              </span>
            </p>
          )}
          <DataTable<Asset>
            tableId="assets"
            exportName="assets"
            rows={rows}
            rowKey={(a) => a.id}
            onRowClick={(a) => navigate(`/assets/${a.id}`)}
            columns={columns}
            empty={
              <EmptyState
                icon={<Boxes className="h-10 w-10" />}
                title={filtersOn ? t("common.noResults") : t("assets.emptyTitle")}
                description={filtersOn ? undefined : t("assets.emptyDesc")}
                action={
                  isManager && !filtersOn ? (
                    <Button onClick={() => setAdding(true)}>
                      <Plus className="h-4 w-4" /> {t("assets.newAsset")}
                    </Button>
                  ) : undefined
                }
              />
            }
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />}
          />
        </>
      )}

      <Modal title={t("assets.newAsset")} open={adding} onClose={() => setAdding(false)} wide>
        <AssetForm
          onDone={(saved) => {
            setAdding(false);
            navigate(`/assets/${saved.id}`);
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>
      <Modal title={t("assets.edit")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <AssetForm asset={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("action.delete")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("assets.confirmDelete", { name: bdiText(deleting.name) })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("action.delete")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

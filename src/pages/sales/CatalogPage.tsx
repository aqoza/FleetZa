import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteRow, insertRow, listPage, sanitizeSearch, updateRow,
} from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { productKinds } from "../../lib/labels";
import type { Product, ProductKind } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader,
  Pagination, Select, Textarea,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useDefaultTaxRate } from "./shared";

const PAGE_SIZE = 25;

function ProductForm({ product, onDone }: { product?: Product; onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const defaultTax = useDefaultTaxRate();
  const [form, setForm] = useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    kind: product?.kind ?? ("service" as ProductKind),
    unit: product?.unit ?? "unit",
    unit_price: product ? String(product.unit_price) : "",
    tax_rate: product ? String(product.tax_rate) : String(defaultTax),
    active: product?.active ?? true,
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const save = useMutation({
    mutationFn: () => {
      const values = {
        sku: form.sku.trim() || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        unit: form.unit.trim() || "unit",
        unit_price: Number(form.unit_price) || 0,
        tax_rate: Number(form.tax_rate) || 0,
        active: form.active,
      };
      return product
        ? updateRow<Product>("products", product.id, values)
        : insertRow<Product>("products", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("sales.catalog.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("sales.catalog.sku")}>
          <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} />
        </Field>
        <Field label={t("sales.catalog.kind")}>
          <Select
            value={form.kind}
            onChange={(e) => set("kind", e.target.value as ProductKind)}
          >
            {Object.entries(productKinds).map(([value, labelKey]) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("sales.catalog.unit")} hint={t("sales.catalog.unitHint")}>
          <Input value={form.unit} onChange={(e) => set("unit", e.target.value)} />
        </Field>
        <Field label={`${t("sales.catalog.unitPrice")} (${tenant.currency})`} required>
          <Input
            type="number" min={0} step="0.0001" required
            className="tabular-nums"
            value={form.unit_price}
            onChange={(e) => set("unit_price", e.target.value)}
          />
        </Field>
        <Field label={`${t("sales.catalog.taxRate")} (%)`}>
          <Input
            type="number" min={0} max={100} step="0.01"
            className="tabular-nums"
            value={form.tax_rate}
            onChange={(e) => set("tax_rate", e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("sales.lines.description")}>
        <Textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line"
          checked={form.active}
          onChange={(e) => set("active", e.target.checked)}
        />
        {t("sales.catalog.active")}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending}>
          {product ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}

export default function CatalogPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [actionError, setActionError] = useState("");

  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["products", { page, term, kind: kindFilter, activeOnly }],
    queryFn: () =>
      listPage<Product>("products", page, PAGE_SIZE, (q) => {
        let f = q;
        if (kindFilter !== "all") f = f.eq("kind", kindFilter);
        if (activeOnly) f = f.eq("active", true);
        if (term) f = f.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
        return f.order("name");
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("products", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["products"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("sales.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || kindFilter !== "all" || !activeOnly;

  const columns: Array<DataTableColumn<Product>> = [
    {
      id: "name",
      header: t("sales.catalog.name"),
      cell: (p) => (
        <>
          <span className="font-medium text-ink">{p.name}</span>
          {p.sku && <div className="text-xs text-ink-3">{p.sku}</div>}
        </>
      ),
      sortValue: (p) => p.name,
      exportValue: (p) => p.name,
    },
    {
      id: "kind",
      header: t("sales.catalog.kind"),
      cell: (p) => <span className="text-ink-2">{t(productKinds[p.kind])}</span>,
      sortValue: (p) => t(productKinds[p.kind]),
      exportValue: (p) => t(productKinds[p.kind]),
    },
    {
      id: "unit",
      header: t("sales.catalog.unit"),
      minBreakpoint: "md",
      cell: (p) => <span className="text-ink-2">{p.unit}</span>,
      sortValue: (p) => p.unit,
      exportValue: (p) => p.unit,
    },
    {
      id: "price",
      header: t("sales.catalog.unitPrice"),
      align: "end",
      cell: (p) => (
        <span className="font-medium text-ink">{formatMoney(p.unit_price, tenant.currency)}</span>
      ),
      sortValue: (p) => p.unit_price,
      exportValue: (p) => p.unit_price,
    },
    {
      id: "tax",
      header: t("sales.catalog.taxRate"),
      align: "end",
      minBreakpoint: "lg",
      cell: (p) => <span className="text-ink-2">{p.tax_rate}%</span>,
      sortValue: (p) => p.tax_rate,
      exportValue: (p) => p.tax_rate,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (p) =>
        p.active ? (
          <Badge tone="green">{t("sales.catalog.active")}</Badge>
        ) : (
          <Badge tone="slate">{t("enum.driverStatus.inactive")}</Badge>
        ),
      sortValue: (p) => String(p.active),
      exportValue: (p) => String(p.active),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (p) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(p);
                  }}
                  aria-label={t("sales.catalog.edit")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(p);
                  }}
                  aria-label={t("sales.catalog.delete")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<Product>,
        ]
      : []),
  ];

  const newButton = isManager ? (
    <Button onClick={() => setAdding(true)}>
      <Plus className="h-4 w-4" /> {t("sales.catalog.new")}
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={t("sales.catalog.title")}
        description={t("sales.catalog.subtitle")}
        actions={newButton}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("sales.catalog.searchPlaceholder")}
          className="max-w-80"
        />
        <Select
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("sales.catalog.allKinds")}</option>
          {Object.entries(productKinds).map(([value, labelKey]) => (
            <option key={value} value={value}>{t(labelKey)}</option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(0);
            }}
          />
          {t("sales.catalog.activeOnly")}
        </label>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!isLoading && !error && (
        <DataTable<Product>
          tableId="products"
          exportName="catalog"
          rows={data?.rows ?? []}
          rowKey={(p) => p.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<Package className="h-10 w-10" />}
              title={filtersOn ? t("sales.catalog.emptyFilteredTitle") : t("sales.catalog.emptyTitle")}
              description={
                filtersOn ? t("sales.catalog.emptyFilteredDesc") : t("sales.catalog.emptyDesc")
              }
              action={filtersOn ? undefined : newButton}
            />
          }
          footer={
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data?.total ?? 0}
              onPage={setPage}
            />
          }
        />
      )}

      <Modal title={t("sales.catalog.new")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && <ProductForm onDone={() => setAdding(false)} />}
      </Modal>

      <Modal title={t("sales.catalog.edit")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <ProductForm product={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal title={t("sales.catalog.delete")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("sales.catalog.deleteConfirm", { name: deleting.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
              >
                {t("sales.catalog.delete")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

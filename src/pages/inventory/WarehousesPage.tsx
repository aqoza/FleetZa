import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Warehouse as WarehouseIcon } from "lucide-react";
import { deleteRow, insertRow, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { useEntityPicker } from "../../lib/pickers";
import type { Tables } from "../../lib/database.types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useWarehouses } from "./hooks";
import type { Warehouse } from "./types";

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["warehouses", "inventory_report", "stock_levels"]) void qc.invalidateQueries({ queryKey: [key] });
}

/** A tenant has a handful of warehouses, so this list is the cached full set. */
export default function WarehousesPage() {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useWarehouses();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);
  const [actionError, setActionError] = useState("");

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("warehouses", id),
    onSuccess: () => {
      invalidate(qc);
      setDeleting(null);
      setActionError("");
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("inventory.warehouseSaveFailed"));
      setDeleting(null);
    },
  });

  const columns: Array<DataTableColumn<Warehouse>> = [
    {
      id: "name",
      header: t("inventory.name"),
      cell: (w) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink"><Bdi>{w.name}</Bdi></span>
          {w.is_default && <Badge tone="blue">{t("inventory.default")}</Badge>}
        </span>
      ),
      sortValue: (w) => w.name,
      exportValue: (w) => w.name,
    },
    {
      id: "code",
      header: t("inventory.code"),
      cell: (w) => <span className="text-ink-2"><Ltr>{w.code ?? "—"}</Ltr></span>,
      sortValue: (w) => w.code,
      exportValue: (w) => w.code ?? "",
    },
    {
      id: "address",
      header: t("inventory.address"),
      minBreakpoint: "md",
      cell: (w) => <span className="text-ink-2"><Bdi>{w.address ?? "—"}</Bdi></span>,
      exportValue: (w) => w.address ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (w) =>
        w.active ? <Badge tone="green">{t("inventory.active")}</Badge> : <Badge tone="slate">{t("inventory.inactive")}</Badge>,
      sortValue: (w) => (w.active ? 1 : 0),
      exportValue: (w) => (w.active ? t("inventory.active") : t("inventory.inactive")),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (w) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={() => setEditing(w)}
                  aria-label={t("inventory.editWarehouse")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={() => setDeleting(w)}
                  aria-label={t("inventory.deleteWarehouse")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<Warehouse>,
        ]
      : []),
  ];

  return (
    <>
      {isManager && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("inventory.newWarehouse")}
          </Button>
        </div>
      )}
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}
      {!isLoading && !error && (
        <DataTable<Warehouse>
          tableId="inventory-warehouses"
          exportName="warehouses"
          rows={data ?? []}
          rowKey={(w) => w.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<WarehouseIcon className="h-10 w-10" />}
              title={t("inventory.warehousesEmptyTitle")}
              description={t("inventory.warehousesEmptyDesc")}
              action={
                isManager ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("inventory.newWarehouse")}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <Modal title={t("inventory.newWarehouse")} open={adding} onClose={() => setAdding(false)}>
        {adding && <WarehouseForm onDone={() => setAdding(false)} />}
      </Modal>
      <Modal title={t("inventory.editWarehouse")} open={!!editing} onClose={() => setEditing(null)}>
        {editing && <WarehouseForm warehouse={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("inventory.deleteWarehouse")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("inventory.deleteWarehouseConfirm", { name: bdiText(deleting.name) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("inventory.deleteWarehouse")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function WarehouseForm({ warehouse, onDone }: { warehouse?: Warehouse; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const branchesOn = isEnabled("multi_company");
  const [form, setForm] = useState({
    name: warehouse?.name ?? "",
    name_ar: warehouse?.name_ar ?? "",
    code: warehouse?.code ?? "",
    address: warehouse?.address ?? "",
    branch_id: warehouse?.branch_id ?? "",
    is_default: warehouse?.is_default ?? false,
    active: warehouse?.active ?? true,
  });
  const [error, setError] = useState("");
  const branchPicker = useEntityPicker<Tables<"branches">>({
    table: "branches",
    selectedId: form.branch_id,
    searchColumns: ["name", "name_ar", "code"],
    orderBy: "name",
    toOption: (b) => ({ value: b.id, label: b.name, meta: b.code ?? undefined }),
    filter: (q) => q.eq("active", true),
    scope: ["branches", "active"],
    enabled: branchesOn,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        code: form.code.trim() || null,
        address: form.address.trim() || null,
        is_default: form.is_default,
        active: form.active,
      };
      // Never clear a branch link the form could not show.
      if (branchesOn) values.branch_id = form.branch_id || null;
      return warehouse ? updateRow("warehouses", warehouse.id, values) : insertRow("warehouses", values);
    },
    onSuccess: () => {
      invalidate(qc);
      toast.success(warehouse ? t("toast.saved") : t("toast.created"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("inventory.warehouseSaveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("inventory.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("inventory.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("inventory.code")}>
          <Input dir="ltr" value={form.code} onChange={(e) => set("code", e.target.value)} />
        </Field>
        {branchesOn && (
          <Field label={t("inventory.branch")}>
            <Combobox {...branchPicker} value={form.branch_id} onChange={(v) => set("branch_id", v)} />
          </Field>
        )}
      </div>
      <Field label={t("inventory.address")}>
        <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line"
            checked={form.is_default}
            onChange={(e) => set("is_default", e.target.checked)}
          />
          <span>
            <span className="font-medium">{t("inventory.isDefault")}</span>
            <span className="block text-xs text-ink-3">{t("inventory.isDefaultHint")}</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          {t("inventory.active")}
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {warehouse ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}

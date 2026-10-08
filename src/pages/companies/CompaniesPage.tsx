import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Textarea,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useCompanies } from "./hooks";
import type { Company } from "./types";

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["companies"] });
  void qc.invalidateQueries({ queryKey: ["picker", "companies"] });
}

/** Legal entities: a tenant has a handful, so this is the cached full list. */
export default function CompaniesPage() {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useCompanies();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [actionError, setActionError] = useState("");

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("companies", id),
    onSuccess: () => {
      invalidate(qc);
      setDeleting(null);
      setActionError("");
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("companies.companySaveFailed"));
      setDeleting(null);
    },
  });

  const columns: Array<DataTableColumn<Company>> = [
    {
      id: "name",
      header: t("companies.legalName"),
      cell: (c) => (
        <div>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink"><Bdi>{c.legal_name}</Bdi></span>
            {c.is_default && <Badge tone="blue">{t("companies.default")}</Badge>}
          </span>
          {(c.trade_name || c.name_ar) && (
            <div className="text-xs text-ink-3"><Bdi>{c.trade_name ?? c.name_ar}</Bdi></div>
          )}
        </div>
      ),
      sortValue: (c) => c.legal_name,
      exportValue: (c) => c.legal_name,
    },
    {
      id: "cr",
      header: t("companies.crNumber"),
      minBreakpoint: "md",
      cell: (c) => <span className="text-ink-2"><Ltr>{c.cr_number ?? "—"}</Ltr></span>,
      sortValue: (c) => c.cr_number,
      exportValue: (c) => c.cr_number ?? "",
    },
    {
      id: "tax",
      header: t("companies.taxNumber"),
      minBreakpoint: "lg",
      cell: (c) => <span className="text-ink-2"><Ltr>{c.tax_number ?? "—"}</Ltr></span>,
      sortValue: (c) => c.tax_number,
      exportValue: (c) => c.tax_number ?? "",
    },
    {
      id: "city",
      header: t("companies.city"),
      minBreakpoint: "lg",
      cell: (c) => <span className="text-ink-2"><Bdi>{[c.city, c.country].filter(Boolean).join(", ") || "—"}</Bdi></span>,
      sortValue: (c) => c.city,
      exportValue: (c) => c.city ?? "",
    },
    {
      id: "currency",
      header: t("companies.currency"),
      minBreakpoint: "md",
      cell: (c) => <span className="text-ink-2"><Ltr>{c.currency ?? "—"}</Ltr></span>,
      exportValue: (c) => c.currency ?? "",
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (c) =>
        c.active ? <Badge tone="green">{t("companies.active")}</Badge> : <Badge tone="slate">{t("companies.inactive")}</Badge>,
      sortValue: (c) => (c.active ? 1 : 0),
      exportValue: (c) => (c.active ? t("companies.active") : t("companies.inactive")),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (c) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={() => setEditing(c)}
                  aria-label={t("companies.editCompany")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={() => setDeleting(c)}
                  aria-label={t("companies.deleteCompany")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<Company>,
        ]
      : []),
  ];

  return (
    <>
      {isManager && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("companies.newCompany")}
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
        <DataTable<Company>
          tableId="companies"
          exportName="companies"
          rows={data ?? []}
          rowKey={(c) => c.id}
          columns={columns}
          empty={
            <EmptyState
              icon={<Building2 className="h-10 w-10" />}
              title={t("companies.companiesEmptyTitle")}
              description={t("companies.companiesEmptyDesc")}
              action={
                isManager ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("companies.newCompany")}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <Modal title={t("companies.newCompany")} open={adding} onClose={() => setAdding(false)} wide>
        {adding && <CompanyForm onDone={() => setAdding(false)} />}
      </Modal>
      <Modal title={t("companies.editCompany")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <CompanyForm company={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal title={t("companies.deleteCompany")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("companies.deleteCompanyConfirm", { name: bdiText(deleting.legal_name) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("companies.deleteCompany")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function CompanyForm({ company, onDone }: { company?: Company; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    legal_name: company?.legal_name ?? "",
    trade_name: company?.trade_name ?? "",
    name_ar: company?.name_ar ?? "",
    cr_number: company?.cr_number ?? "",
    tax_number: company?.tax_number ?? "",
    email: company?.email ?? "",
    phone: company?.phone ?? "",
    address: company?.address ?? "",
    city: company?.city ?? "",
    country: company?.country ?? "",
    currency: company?.currency ?? "",
    is_default: company?.is_default ?? false,
    active: company?.active ?? true,
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  const text = (v: string) => v.trim() || null;

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        legal_name: form.legal_name.trim(),
        trade_name: text(form.trade_name),
        name_ar: text(form.name_ar),
        cr_number: text(form.cr_number),
        tax_number: text(form.tax_number),
        email: text(form.email),
        phone: text(form.phone),
        address: text(form.address),
        city: text(form.city),
        country: text(form.country),
        currency: text(form.currency.toUpperCase()),
        is_default: form.is_default,
        active: form.active,
      };
      return company ? updateRow("companies", company.id, values) : insertRow("companies", values);
    },
    onSuccess: () => {
      invalidate(qc);
      toast.success(company ? t("toast.saved") : t("toast.created"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("companies.companySaveFailed")),
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
        <Field label={t("companies.legalName")} required>
          <Input value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("companies.tradeName")}>
          <Input value={form.trade_name} onChange={(e) => set("trade_name", e.target.value)} />
        </Field>
        <Field label={t("companies.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("companies.crNumber")}>
          <Input dir="ltr" value={form.cr_number} onChange={(e) => set("cr_number", e.target.value)} />
        </Field>
        <Field label={t("companies.taxNumber")}>
          <Input dir="ltr" value={form.tax_number} onChange={(e) => set("tax_number", e.target.value)} />
        </Field>
        <Field label={t("companies.currency")} hint={t("companies.currencyHint")}>
          <Input dir="ltr" maxLength={3} value={form.currency} onChange={(e) => set("currency", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input type="tel" dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("companies.city")}>
          <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={t("companies.country")}>
          <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
      </div>
      <Field label={t("companies.address")}>
        <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} />
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
            <span className="font-medium">{t("companies.isDefault")}</span>
            <span className="block text-xs text-ink-3">{t("companies.isDefaultHint")}</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          {t("companies.active")}
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {company ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}

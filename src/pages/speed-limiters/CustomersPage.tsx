import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import type { SlContact, SlCustomer } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select,
  Table, Textarea, type BadgeTone,
} from "../../components/ui";

export const customerStatusMeta: Record<
  SlCustomer["status"],
  { labelKey: MessageKey; tone: BadgeTone }
> = {
  active: { labelKey: "slCustomers.status.active", tone: "green" },
  inactive: { labelKey: "slCustomers.status.inactive", tone: "slate" },
};

export function CustomerForm({
  customer,
  onDone,
}: {
  customer?: SlCustomer;
  onDone: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    cr_number: customer?.cr_number ?? "",
    tax_number: customer?.tax_number ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    website: customer?.website ?? "",
    address: customer?.address ?? "",
    city: customer?.city ?? "",
    country: customer?.country ?? "",
    billing_terms: customer?.billing_terms ?? "",
    credit_limit: customer?.credit_limit != null ? String(customer.credit_limit) : "",
    status: customer?.status ?? "active",
    notes: customer?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        name: form.name.trim(),
        cr_number: form.cr_number.trim() || null,
        tax_number: form.tax_number.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        billing_terms: form.billing_terms.trim() || null,
        credit_limit: form.credit_limit === "" ? null : Number(form.credit_limit),
        status: form.status,
        notes: form.notes.trim() || null,
      };
      return customer
        ? updateRow<SlCustomer>("sl_customers", customer.id, values)
        : insertRow<SlCustomer>("sl_customers", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sl_customers"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("slCustomers.saveFailed")),
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
        <Field label={t("slCustomers.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("slCustomers.crNumber")}>
          <Input value={form.cr_number} onChange={(e) => set("cr_number", e.target.value)} />
        </Field>
        <Field label={t("slCustomers.taxNumber")}>
          <Input value={form.tax_number} onChange={(e) => set("tax_number", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("slCustomers.website")}>
          <Input value={form.website} onChange={(e) => set("website", e.target.value)} />
        </Field>
        <Field label={t("slCustomers.address")}>
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label={t("slCustomers.city")}>
          <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={t("slCustomers.country")}>
          <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
        <Field label={t("slCustomers.billingTerms")}>
          <Input
            value={form.billing_terms}
            onChange={(e) => set("billing_terms", e.target.value)}
          />
        </Field>
        <Field label={t("slCustomers.creditLimitUnit", { currency: tenant.currency })}>
          <Input
            type="number" min={0} step="0.01"
            value={form.credit_limit}
            onChange={(e) => set("credit_limit", e.target.value)}
          />
        </Field>
        {customer && (
          <Field label={t("field.status")}>
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {Object.entries(customerStatusMeta).map(([v, m]) => (
                <option key={v} value={v}>{t(m.labelKey)}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {customer ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}

export default function CustomersPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SlCustomer | null>(null);
  const [deleting, setDeleting] = useState<SlCustomer | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: customers, isLoading, error } = useQuery({
    queryKey: ["sl_customers"],
    queryFn: () => listRows<SlCustomer>("sl_customers", (q) => q.order("name")),
  });

  const { data: contacts } = useQuery({
    queryKey: ["sl_contacts"],
    queryFn: () => listRows<SlContact>("sl_contacts"),
  });

  // Client-side join: preferred contact (primary if one exists) per customer.
  const contactByCustomer = useMemo(() => {
    const map = new Map<string, SlContact>();
    for (const c of contacts ?? []) {
      const existing = map.get(c.customer_id);
      if (!existing || (c.is_primary && !existing.is_primary)) map.set(c.customer_id, c);
    }
    return map;
  }, [contacts]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("sl_customers", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["sl_customers"] });
      void qc.invalidateQueries({ queryKey: ["sl_contacts"] });
      // Deleting a customer unlinks its vehicles.
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("slCustomers.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (customers ?? []).filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!needle) return true;
      return [c.name, c.cr_number, c.phone, c.email].some((v) =>
        v?.toLowerCase().includes(needle),
      );
    });
  }, [customers, search, statusFilter]);

  return (
    <>
      <PageHeader
        title={t("slCustomers.title")}
        description={t("slCustomers.subtitle")}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("slCustomers.newCustomer")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("slCustomers.searchPlaceholder")}
          className="max-w-80"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="max-w-44"
        >
          <option value="all">{t("slCustomers.allStatuses")}</option>
          {Object.entries(customerStatusMeta).map(([v, m]) => (
            <option key={v} value={v}>{t(m.labelKey)}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title={
            customers?.length ? t("slCustomers.emptyFilteredTitle") : t("slCustomers.emptyTitle")
          }
          description={
            customers?.length ? t("slCustomers.emptyFilteredDesc") : t("slCustomers.emptyDesc")
          }
          action={
            isManager && !customers?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("slCustomers.newCustomer")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            t("slCustomers.company"),
            t("slCustomers.cityCountry"),
            t("slCustomers.contact"),
            t("slCustomers.billingTerms"),
            t("slCustomers.creditLimit"),
            t("common.status"),
            "",
          ]}
        >
          {filtered.map((c) => {
            const contact = contactByCustomer.get(c.id);
            const st = customerStatusMeta[c.status];
            return (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/speed-limiters/customers/${c.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.cr_number && <div className="text-xs text-slate-500">{c.cr_number}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  {contact ? (
                    <>
                      <div className="text-slate-700">{contact.name}</div>
                      {contact.phone && (
                        <div className="text-xs text-slate-500">{contact.phone}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-600">{c.phone ?? "—"}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.billing_terms ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatMoney(c.credit_limit, tenant.currency)}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
                </td>
                <td className="px-4 py-3 text-end">
                  {isManager && (
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => setEditing(c)}
                        aria-label={t("slCustomers.editCustomer")}
                        title={t("action.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(c)}
                        aria-label={t("slCustomers.deleteCustomer")}
                        title={t("action.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      <Modal title={t("slCustomers.newCustomer")} open={adding} onClose={() => setAdding(false)} wide>
        <CustomerForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal
        title={t("slCustomers.editCustomer")}
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
      >
        {editing && <CustomerForm customer={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal
        title={t("slCustomers.deleteCustomer")}
        open={!!deleting}
        onClose={() => setDeleting(null)}
      >
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("slCustomers.deleteConfirm", { name: deleting.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                {t("slCustomers.deleteCustomer")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

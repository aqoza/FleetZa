import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listPage, listRows, updateRow, sanitizeSearch } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import type { Contact, Customer } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader,
  Pagination, Select, Textarea, type BadgeTone,
} from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";

const PAGE_SIZE = 25;

export const customerStatusMeta: Record<
  Customer["status"],
  { labelKey: MessageKey; tone: BadgeTone }
> = {
  active: { labelKey: "customers.status.active", tone: "green" },
  inactive: { labelKey: "customers.status.inactive", tone: "slate" },
};

export function CustomerForm({
  customer,
  onDone,
}: {
  customer?: Customer;
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
        ? updateRow<Customer>("customers", customer.id, values)
        : insertRow<Customer>("customers", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("customers.saveFailed")),
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
        <Field label={t("customers.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("customers.crNumber")}>
          <Input value={form.cr_number} onChange={(e) => set("cr_number", e.target.value)} />
        </Field>
        <Field label={t("customers.taxNumber")}>
          <Input value={form.tax_number} onChange={(e) => set("tax_number", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("customers.website")}>
          <Input value={form.website} onChange={(e) => set("website", e.target.value)} />
        </Field>
        <Field label={t("customers.address")}>
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label={t("customers.city")}>
          <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={t("customers.country")}>
          <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
        <Field label={t("customers.billingTerms")}>
          <Input
            value={form.billing_terms}
            onChange={(e) => set("billing_terms", e.target.value)}
          />
        </Field>
        <Field label={t("customers.creditLimitUnit", { currency: tenant.currency })}>
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
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [actionError, setActionError] = useState("");

  // Server-side search term; % and , would break the .or(...) ilike pattern.
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["customers", { page, term, status: statusFilter }],
    queryFn: () =>
      listPage<Customer>("customers", page, PAGE_SIZE, (q) => {
        let f = q;
        if (statusFilter !== "all") f = f.eq("status", statusFilter);
        if (term) {
          f = f.or(
            `name.ilike.%${term}%,cr_number.ilike.%${term}%,` +
              `email.ilike.%${term}%,phone.ilike.%${term}%`,
          );
        }
        return f.order("name");
      }),
  });
  const customers = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Contact preview only needs the customers on the current page.
  const customerIds = useMemo(() => (data?.rows ?? []).map((c) => c.id), [data]);

  const { data: contacts } = useQuery({
    queryKey: ["contacts", { customerIds }],
    queryFn: () => listRows<Contact>("contacts", (q) => q.in("customer_id", customerIds)),
    enabled: customerIds.length > 0,
  });

  // Client-side join: preferred contact (primary if one exists) per customer.
  const contactByCustomer = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts ?? []) {
      const existing = map.get(c.customer_id);
      if (!existing || (c.is_primary && !existing.is_primary)) map.set(c.customer_id, c);
    }
    return map;
  }, [contacts]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("customers", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      // Deleting a customer unlinks its vehicles.
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("customers.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || statusFilter !== "all";

  const columns: Array<DataTableColumn<Customer>> = [
    {
      id: "company",
      header: t("customers.company"),
      cell: (c) => (
        <>
          <Link
            to={`/customers/${c.id}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {c.name}
          </Link>
          {c.cr_number && <div className="text-xs text-slate-500">{c.cr_number}</div>}
        </>
      ),
      sortValue: (c) => c.name,
      exportValue: (c) => c.name,
    },
    {
      id: "cityCountry",
      header: t("customers.cityCountry"),
      minBreakpoint: "md",
      cell: (c) => (
        <span className="text-slate-600">
          {[c.city, c.country].filter(Boolean).join(", ") || "—"}
        </span>
      ),
      sortValue: (c) => [c.city, c.country].filter(Boolean).join(", ") || null,
      exportValue: (c) => [c.city, c.country].filter(Boolean).join(", "),
    },
    {
      id: "contact",
      header: t("customers.contact"),
      minBreakpoint: "lg",
      cell: (c) => {
        const contact = contactByCustomer.get(c.id);
        return contact ? (
          <>
            <div className="text-slate-700">{contact.name}</div>
            {contact.phone && <div className="text-xs text-slate-500">{contact.phone}</div>}
          </>
        ) : (
          <span className="text-slate-600">{c.phone ?? "—"}</span>
        );
      },
      sortValue: (c) => contactByCustomer.get(c.id)?.name ?? c.phone ?? null,
      exportValue: (c) => {
        const contact = contactByCustomer.get(c.id);
        return contact
          ? [contact.name, contact.phone].filter(Boolean).join(" ")
          : (c.phone ?? "");
      },
    },
    {
      id: "billingTerms",
      header: t("customers.billingTerms"),
      minBreakpoint: "xl",
      defaultHidden: true,
      cell: (c) => <span className="text-slate-600">{c.billing_terms ?? "—"}</span>,
      sortValue: (c) => c.billing_terms,
      exportValue: (c) => c.billing_terms ?? "",
    },
    {
      id: "creditLimit",
      header: t("customers.creditLimit"),
      align: "end",
      minBreakpoint: "xl",
      defaultHidden: true,
      cell: (c) => (
        <span className="text-slate-600">{formatMoney(c.credit_limit, tenant.currency)}</span>
      ),
      sortValue: (c) => c.credit_limit,
      exportValue: (c) => c.credit_limit,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (c) => {
        const st = customerStatusMeta[c.status];
        return <Badge tone={st.tone}>{t(st.labelKey)}</Badge>;
      },
      sortValue: (c) => t(customerStatusMeta[c.status].labelKey),
      exportValue: (c) => t(customerStatusMeta[c.status].labelKey),
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
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(c);
                  }}
                  aria-label={t("customers.editCustomer")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(c);
                  }}
                  aria-label={t("customers.deleteCustomer")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<Customer>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        description={t("customers.subtitle")}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("customers.newCustomer")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t("customers.searchPlaceholder")}
          className="max-w-80"
        />
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("customers.allStatuses")}</option>
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

      {!isLoading && !error && (
        <DataTable<Customer>
          tableId="customers"
          exportName="customers"
          rows={customers}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/customers/${c.id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={<Building2 className="h-10 w-10" />}
              title={filtersOn ? t("customers.emptyFilteredTitle") : t("customers.emptyTitle")}
              description={
                filtersOn ? t("customers.emptyFilteredDesc") : t("customers.emptyDesc")
              }
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("customers.newCustomer")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("customers.newCustomer")} open={adding} onClose={() => setAdding(false)} wide>
        <CustomerForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal
        title={t("customers.editCustomer")}
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
      >
        {editing && <CustomerForm customer={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal
        title={t("customers.deleteCustomer")}
        open={!!deleting}
        onClose={() => setDeleting(null)}
      >
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("customers.deleteConfirm", { name: deleting.name })}
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
                {t("customers.deleteCustomer")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

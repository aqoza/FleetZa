import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listPage, listRows, sanitizeSearch, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import type { Supplier, SupplierContact, SupplierStatus, SupplierType } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, PageHeader,
  Pagination, Select, Textarea,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { supplierNames, supplierStatus, supplierTypes } from "./labels";

const PAGE_SIZE = 25;

/** Five stars, filled up to the rating; "not rated" when there is none. */
export function RatingStars({ rating }: { rating: number | null }) {
  const t = useT();
  if (!rating) return <span className="text-xs text-ink-3">{t("suppliers.ratingNone")}</span>;
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={t("suppliers.ratingValue", { rating })}
      title={t("suppliers.ratingValue", { rating })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={
            n <= rating ? "h-3.5 w-3.5 fill-amber-400 text-amber-400" : "h-3.5 w-3.5 text-line"
          }
          aria-hidden
        />
      ))}
    </span>
  );
}

/** "30 days", or "Due on receipt" for zero; a dash when unset. */
export function usePaymentTermsLabel(): (days: number | null) => string {
  const t = useT();
  const tp = useTp();
  return (days) =>
    days == null
      ? t("common.dash")
      : days === 0
        ? t("suppliers.paymentTermsImmediate")
        : tp("suppliers.paymentTermsValue", days);
}

export function SupplierForm({
  supplier,
  onDone,
  onCancel,
}: {
  supplier?: Supplier;
  onDone: (saved: Supplier) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    name_ar: supplier?.name_ar ?? "",
    supplier_type: supplier?.supplier_type ?? ("other" as SupplierType),
    cr_number: supplier?.cr_number ?? "",
    tax_number: supplier?.tax_number ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    website: supplier?.website ?? "",
    address: supplier?.address ?? "",
    city: supplier?.city ?? "",
    country: supplier?.country ?? "",
    payment_terms_days:
      supplier ? (supplier.payment_terms_days != null ? String(supplier.payment_terms_days) : "") : "30",
    currency: supplier?.currency ?? "",
    bank_name: supplier?.bank_name ?? "",
    iban: supplier?.iban ?? "",
    rating: supplier?.rating != null ? String(supplier.rating) : "",
    status: supplier?.status ?? ("active" as SupplierStatus),
    notes: supplier?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        supplier_type: form.supplier_type,
        cr_number: form.cr_number.trim() || null,
        tax_number: form.tax_number.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        payment_terms_days:
          form.payment_terms_days === "" ? null : Math.round(Number(form.payment_terms_days)),
        currency: form.currency.trim().toUpperCase() || null,
        // IBANs are read in groups but stored without spaces.
        bank_name: form.bank_name.trim() || null,
        iban: form.iban.replace(/\s+/g, "").toUpperCase() || null,
        rating: form.rating === "" ? null : Number(form.rating),
        status: form.status,
        notes: form.notes.trim() || null,
      };
      return supplier
        ? updateRow<Supplier>("suppliers", supplier.id, values)
        : insertRow<Supplier>("suppliers", values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void qc.invalidateQueries({ queryKey: ["picker", "suppliers"] });
      toast.success(supplier ? t("toast.saved") : t("toast.created"));
      onDone(saved);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("suppliers.saveFailed")),
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
        <Field label={t("suppliers.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("suppliers.nameAr")}>
          <Input dir="rtl" lang="ar" value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} />
        </Field>
        <Field label={t("suppliers.type")}>
          <Select
            value={form.supplier_type}
            onChange={(e) => set("supplier_type", e.target.value as SupplierType)}
          >
            {Object.entries(supplierTypes).map(([v, k]) => (
              <option key={v} value={v}>{t(k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.status")} hint={form.status === "blocked" ? t("suppliers.blockedHint") : undefined}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value as SupplierStatus)}>
            {Object.entries(supplierStatus).map(([v, m]) => (
              <option key={v} value={v}>{t(m.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("suppliers.crNumber")}>
          <Input dir="ltr" value={form.cr_number} onChange={(e) => set("cr_number", e.target.value)} />
        </Field>
        <Field label={t("suppliers.taxNumber")}>
          <Input dir="ltr" value={form.tax_number} onChange={(e) => set("tax_number", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("suppliers.website")}>
          <Input dir="ltr" value={form.website} onChange={(e) => set("website", e.target.value)} />
        </Field>
        <Field label={t("suppliers.address")}>
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label={t("suppliers.city")}>
          <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={t("suppliers.country")}>
          <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
        <Field label={t("suppliers.paymentTermsDays")}>
          <Input
            type="number" min={0} step={1} dir="ltr"
            value={form.payment_terms_days}
            onChange={(e) => set("payment_terms_days", e.target.value)}
          />
        </Field>
        <Field label={t("suppliers.currency")} hint={t("suppliers.currencyHint", { currency: tenant.currency })}>
          <Input
            dir="ltr" maxLength={3} placeholder={tenant.currency}
            value={form.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label={t("suppliers.bankName")}>
          <Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
        </Field>
        <Field label={t("suppliers.iban")}>
          <Input dir="ltr" value={form.iban} onChange={(e) => set("iban", e.target.value)} />
        </Field>
        <Field label={t("suppliers.rating")}>
          <Select value={form.rating} onChange={(e) => set("rating", e.target.value)}>
            <option value="">{t("suppliers.ratingNone")}</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{t("suppliers.ratingValue", { rating: n })}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {supplier ? t("action.saveChanges") : t("action.create")}
        </Button>
      </div>
    </form>
  );
}

export default function SuppliersPage() {
  const t = useT();
  const { language } = useI18n();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const paymentTerms = usePaymentTermsLabel();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [actionError, setActionError] = useState("");

  // % , ( ) are .or() logic-tree syntax, not search text.
  const term = sanitizeSearch(search);

  const { data, isLoading, error } = useQuery({
    queryKey: ["suppliers", { page, term, type: typeFilter, status: statusFilter }],
    queryFn: () =>
      listPage<Supplier>("suppliers", page, PAGE_SIZE, (q) => {
        let f = q;
        if (typeFilter !== "all") f = f.eq("supplier_type", typeFilter);
        if (statusFilter !== "all") f = f.eq("status", statusFilter);
        if (term) {
          f = f.or(
            `name.ilike.%${term}%,name_ar.ilike.%${term}%,doc_number.ilike.%${term}%,` +
              `cr_number.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`,
          );
        }
        return f.order("name");
      }),
  });
  const suppliers = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Contact preview only needs the suppliers on the current page.
  const supplierIds = useMemo(() => (data?.rows ?? []).map((s) => s.id), [data]);
  const { data: contacts } = useQuery({
    queryKey: ["supplier_contacts", { supplierIds }],
    queryFn: () =>
      listRows<SupplierContact>("supplier_contacts", (q) => q.in("supplier_id", supplierIds)),
    enabled: supplierIds.length > 0,
  });

  // Preferred contact per supplier: the primary one when it exists.
  const contactBySupplier = useMemo(() => {
    const map = new Map<string, SupplierContact>();
    for (const c of contacts ?? []) {
      const existing = map.get(c.supplier_id);
      if (!existing || (c.is_primary && !existing.is_primary)) map.set(c.supplier_id, c);
    }
    return map;
  }, [contacts]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("suppliers", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void qc.invalidateQueries({ queryKey: ["supplier_contacts"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("suppliers.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtersOn = term !== "" || typeFilter !== "all" || statusFilter !== "all";

  const columns: Array<DataTableColumn<Supplier>> = [
    {
      id: "supplier",
      header: t("suppliers.supplier"),
      cell: (s) => {
        const names = supplierNames(s, language);
        return (
          <>
            <Link to={`/suppliers/${s.id}`} className="font-medium text-brand-700 hover:underline">
              <Bdi>{names.primary}</Bdi>
            </Link>
            <div className="text-xs text-ink-3">
              {s.doc_number && <Ltr>{s.doc_number}</Ltr>}
              {s.doc_number && names.secondary && " · "}
              {names.secondary && <Bdi>{names.secondary}</Bdi>}
            </div>
          </>
        );
      },
      sortValue: (s) => supplierNames(s, language).primary,
      exportValue: (s) => s.name,
    },
    {
      id: "number",
      header: t("suppliers.number"),
      defaultHidden: true,
      cell: (s) => <span className="text-ink-2 tabular-nums"><Ltr>{s.doc_number ?? "—"}</Ltr></span>,
      sortValue: (s) => s.number,
      exportValue: (s) => s.doc_number ?? "",
      dir: "ltr",
    },
    {
      id: "type",
      header: t("suppliers.type"),
      minBreakpoint: "md",
      cell: (s) => <span className="text-ink-2">{t(supplierTypes[s.supplier_type])}</span>,
      sortValue: (s) => t(supplierTypes[s.supplier_type]),
      exportValue: (s) => t(supplierTypes[s.supplier_type]),
    },
    {
      id: "cityCountry",
      header: t("suppliers.cityCountry"),
      minBreakpoint: "lg",
      cell: (s) => (
        <span className="text-ink-2">
          {/* One isolate for the whole line, or "Muscat, OM" reorders on an Arabic page. */}
          {s.city || s.country ? <Bdi>{[s.city, s.country].filter(Boolean).join(", ")}</Bdi> : "—"}
        </span>
      ),
      sortValue: (s) => [s.city, s.country].filter(Boolean).join(", ") || null,
      exportValue: (s) => [s.city, s.country].filter(Boolean).join(", "),
    },
    {
      id: "contact",
      header: t("suppliers.contact"),
      minBreakpoint: "lg",
      cell: (s) => {
        const contact = contactBySupplier.get(s.id);
        return contact ? (
          <>
            <div className="text-ink-2"><Bdi>{contact.name}</Bdi></div>
            {contact.phone && <div className="text-xs text-ink-3"><Ltr>{contact.phone}</Ltr></div>}
          </>
        ) : (
          <span className="text-ink-2"><Ltr>{s.phone ?? "—"}</Ltr></span>
        );
      },
      sortValue: (s) => contactBySupplier.get(s.id)?.name ?? s.phone ?? null,
      exportValue: (s) => {
        const contact = contactBySupplier.get(s.id);
        return contact ? [contact.name, contact.phone].filter(Boolean).join(" ") : (s.phone ?? "");
      },
    },
    {
      id: "terms",
      header: t("suppliers.paymentTerms"),
      minBreakpoint: "xl",
      cell: (s) => <span className="text-ink-2 tabular-nums">{paymentTerms(s.payment_terms_days)}</span>,
      sortValue: (s) => s.payment_terms_days,
      exportValue: (s) => s.payment_terms_days,
    },
    {
      id: "rating",
      header: t("suppliers.rating"),
      minBreakpoint: "md",
      cell: (s) => <RatingStars rating={s.rating} />,
      sortValue: (s) => s.rating,
      exportValue: (s) => s.rating,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (s) => {
        const st = supplierStatus[s.status];
        return <Badge tone={st.tone}>{t(st.labelKey)}</Badge>;
      },
      sortValue: (s) => t(supplierStatus[s.status].labelKey),
      exportValue: (s) => t(supplierStatus[s.status].labelKey),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (s) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(s);
                  }}
                  aria-label={t("suppliers.editSupplier")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(s);
                  }}
                  aria-label={t("suppliers.deleteSupplier")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<Supplier>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("suppliers.title")}
        description={t("suppliers.subtitle")}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("suppliers.newSupplier")}
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
          placeholder={t("suppliers.searchPlaceholder")}
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
          <option value="all">{t("suppliers.allTypes")}</option>
          {Object.entries(supplierTypes).map(([v, k]) => (
            <option key={v} value={v}>{t(k)}</option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("suppliers.allStatuses")}</option>
          {Object.entries(supplierStatus).map(([v, m]) => (
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
        <DataTable<Supplier>
          tableId="suppliers"
          exportName="suppliers"
          rows={suppliers}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
          columns={columns}
          empty={
            <EmptyState
              icon={<Factory className="h-10 w-10" />}
              title={filtersOn ? t("suppliers.emptyFilteredTitle") : t("suppliers.emptyTitle")}
              description={filtersOn ? t("suppliers.emptyFilteredDesc") : t("suppliers.emptyDesc")}
              action={
                isManager && !filtersOn ? (
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> {t("suppliers.newSupplier")}
                  </Button>
                ) : undefined
              }
            />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={t("suppliers.newSupplier")} open={adding} onClose={() => setAdding(false)} wide>
        <SupplierForm
          onDone={(saved) => {
            setAdding(false);
            navigate(`/suppliers/${saved.id}`);
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>

      <Modal title={t("suppliers.editSupplier")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <SupplierForm
            supplier={editing}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <Modal title={t("suppliers.deleteSupplier")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">
              {t("suppliers.deleteConfirm", { name: bdiText(deleting.name) })}
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
                {t("suppliers.deleteSupplier")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Package, Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import { countRows, deleteRow, getRow, insertRow, listRows, updateRow } from "../../lib/db";
import { recordRecent } from "../../lib/recent";
import { formatMoney } from "../../lib/format";
import { bdiText } from "../../lib/bidi";
import type { InventoryItem, Supplier, SupplierContact } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal,
  PageHeader, Table,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { RatingStars, SupplierForm, usePaymentTermsLabel } from "./SuppliersPage";
import { supplierNames, supplierStatus, supplierTypes } from "./labels";

/** Items shown on the detail page; the full list belongs to the inventory module. */
const ITEMS_LIMIT = 25;

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</div>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function ContactForm({
  supplierId,
  contact,
  contacts,
  onDone,
}: {
  supplierId: string;
  contact?: SupplierContact;
  contacts: SupplierContact[];
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
  });
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? contacts.length === 0);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // One primary per supplier (a partial unique index): demote the old one first.
      if (isPrimary) {
        for (const prev of contacts.filter((c) => c.is_primary && c.id !== contact?.id)) {
          await updateRow<SupplierContact>("supplier_contacts", prev.id, { is_primary: false });
        }
      }
      const values = {
        name: form.name.trim(),
        title: form.title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        is_primary: isPrimary,
      };
      return contact
        ? updateRow<SupplierContact>("supplier_contacts", contact.id, values)
        : insertRow<SupplierContact>("supplier_contacts", { ...values, supplier_id: supplierId });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["supplier_contacts"] });
      toast.success(contact ? t("toast.saved") : t("toast.created"));
      onDone();
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
        <Field label={t("field.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        </Field>
        <Field label={t("suppliers.contactTitle")}>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" dir="ltr" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        {t("suppliers.primaryContact")}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {contact ? t("action.saveChanges") : t("suppliers.addContact")}
        </Button>
      </div>
    </form>
  );
}

export default function SupplierDetailPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { supplierId = "" } = useParams();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const paymentTerms = usePaymentTermsLabel();
  // Inventory items are module-gated rows: only ask for them when the tenant runs inventory.
  const inventoryEnabled = isEnabled("inventory");

  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<SupplierContact | null>(null);
  const [deletingContact, setDeletingContact] = useState<SupplierContact | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: supplier, isLoading, error } = useQuery({
    queryKey: ["suppliers", supplierId],
    queryFn: () => getRow<Supplier>("suppliers", supplierId),
  });

  useEffect(() => {
    if (supplier) recordRecent(supplier.name, `/suppliers/${supplier.id}`);
  }, [supplier]);

  const contactsQ = useQuery({
    queryKey: ["supplier_contacts", supplierId],
    queryFn: () =>
      listRows<SupplierContact>("supplier_contacts", (q) =>
        q.eq("supplier_id", supplierId).order("is_primary", { ascending: false }).order("name"),
      ),
  });
  const contacts = contactsQ.data ?? [];

  const itemCountQ = useQuery({
    queryKey: ["inventory_items", "supplier", supplierId, "count"],
    queryFn: () => countRows("inventory_items", (q) => q.eq("preferred_supplier_id", supplierId)),
    enabled: inventoryEnabled,
  });

  const itemsQ = useQuery({
    queryKey: ["inventory_items", "supplier", supplierId],
    queryFn: () =>
      listRows<InventoryItem>("inventory_items", (q) =>
        q.eq("preferred_supplier_id", supplierId).order("name").limit(ITEMS_LIMIT),
      ),
    enabled: inventoryEnabled,
  });

  const removeContact = useMutation({
    mutationFn: (id: string) => deleteRow("supplier_contacts", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["supplier_contacts"] });
      setDeletingContact(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("suppliers.deleteFailed"));
      setDeletingContact(null);
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!supplier) {
    return (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title={t("suppliers.notFound")}
        action={
          <Link to="/suppliers" className="text-sm font-medium text-brand-700 hover:underline">
            {t("suppliers.title")}
          </Link>
        }
      />
    );
  }

  const st = supplierStatus[supplier.status];
  const names = supplierNames(supplier, language);
  const location = [supplier.address, supplier.city, supplier.country].filter(Boolean).join(", ");

  return (
    <>
      <Link
        to="/suppliers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("suppliers.title")}
      </Link>
      <PageHeader
        title={names.primary}
        description={[supplier.doc_number, names.secondary].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            {isManager && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t("suppliers.kpiContacts")} value={contactsQ.data ? contacts.length : t("common.dash")} />
        {inventoryEnabled && (
          <Kpi label={t("suppliers.kpiItems")} value={itemCountQ.data ?? t("common.dash")} />
        )}
        <Kpi label={t("suppliers.kpiTerms")} value={paymentTerms(supplier.payment_terms_days)} />
        <Kpi label={t("suppliers.kpiRating")} value={<RatingStars rating={supplier.rating} />} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-ink">{t("suppliers.details")}</h3>
          <dl className="divide-y divide-line">
            <DetailRow label={t("suppliers.type")}>{t(supplierTypes[supplier.supplier_type])}</DetailRow>
            <DetailRow label={t("suppliers.crNumber")}>
              {supplier.cr_number ? <Ltr>{supplier.cr_number}</Ltr> : t("common.dash")}
            </DetailRow>
            <DetailRow label={t("suppliers.taxNumber")}>
              {supplier.tax_number ? <Ltr>{supplier.tax_number}</Ltr> : t("common.dash")}
            </DetailRow>
            <DetailRow label={t("field.email")}>
              {supplier.email ? (
                <a href={`mailto:${supplier.email}`} className="text-brand-700 hover:underline">
                  <Ltr>{supplier.email}</Ltr>
                </a>
              ) : (
                t("common.dash")
              )}
            </DetailRow>
            <DetailRow label={t("field.phone")}>
              {supplier.phone ? <Ltr>{supplier.phone}</Ltr> : t("common.dash")}
            </DetailRow>
            <DetailRow label={t("suppliers.website")}>
              {supplier.website ? <Ltr>{supplier.website}</Ltr> : t("common.dash")}
            </DetailRow>
            <DetailRow label={t("suppliers.address")}>
              {location ? <Bdi>{location}</Bdi> : t("common.dash")}
            </DetailRow>
            <DetailRow label={t("suppliers.currency")}>
              <Ltr>{supplier.currency ?? tenant.currency}</Ltr>
            </DetailRow>
            {supplier.notes && (
              <DetailRow label={t("field.notes")}>
                <span className="whitespace-pre-line" dir="auto">{supplier.notes}</span>
              </DetailRow>
            )}
          </dl>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">{t("suppliers.banking")}</h3>
          {supplier.bank_name || supplier.iban ? (
            <dl className="divide-y divide-line">
              <DetailRow label={t("suppliers.bankName")}>
                {supplier.bank_name ? <Bdi>{supplier.bank_name}</Bdi> : t("common.dash")}
              </DetailRow>
              <DetailRow label={t("suppliers.iban")}>
                {supplier.iban ? (
                  // Groups of four, the way IBANs are printed and read aloud.
                  <Ltr className="font-mono tabular-nums">{supplier.iban.replace(/(.{4})(?=.)/g, "$1 ")}</Ltr>
                ) : (
                  t("common.dash")
                )}
              </DetailRow>
            </dl>
          ) : (
            <p className="text-sm text-ink-3">{t("suppliers.noBanking")}</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{t("suppliers.contacts")}</h3>
            {isManager && (
              <Button variant="secondary" onClick={() => setAddingContact(true)}>
                <Plus className="h-4 w-4" /> {t("action.add")}
              </Button>
            )}
          </div>
          {contactsQ.isLoading ? (
            <LoadingState />
          ) : contactsQ.error ? (
            <ErrorState message={(contactsQ.error as Error).message} />
          ) : contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">{t("suppliers.noContacts")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {c.is_primary && (
                        <Star
                          className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                          aria-label={t("suppliers.primaryContact")}
                        />
                      )}
                      <span className="truncate text-sm font-medium text-ink"><Bdi>{c.name}</Bdi></span>
                    </div>
                    {c.title && <div className="text-xs text-ink-3"><Bdi>{c.title}</Bdi></div>}
                    <div className="mt-0.5 space-y-0.5 text-xs text-ink-3">
                      {c.phone && <div><Ltr>{c.phone}</Ltr></div>}
                      {c.email && <div className="truncate"><Ltr>{c.email}</Ltr></div>}
                    </div>
                  </div>
                  {isManager && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                        onClick={() => setEditingContact(c)}
                        aria-label={t("suppliers.editContact")}
                        title={t("action.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                        onClick={() => setDeletingContact(c)}
                        aria-label={t("suppliers.deleteContact")}
                        title={t("action.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {inventoryEnabled && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink">{t("suppliers.items")}</h3>
          <p className="mb-3 text-xs text-ink-3">{t("suppliers.itemsHint")}</p>
          {itemsQ.isLoading ? (
            <LoadingState />
          ) : itemsQ.error ? (
            <ErrorState message={(itemsQ.error as Error).message} />
          ) : (itemsQ.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-ink-3">
              <Package className="h-8 w-8" aria-hidden />
              {t("suppliers.noItems")}
            </div>
          ) : (
            <Table
              headers={[
                t("suppliers.itemSku"),
                t("suppliers.itemName"),
                t("suppliers.itemCost"),
                t("suppliers.itemReorder"),
              ]}
            >
              {(itemsQ.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2.5 text-ink-2"><Ltr>{item.sku ?? "—"}</Ltr></td>
                  <td className="px-4 py-2.5 text-ink">
                    <Bdi>{language === "ar" && item.name_ar ? item.name_ar : item.name}</Bdi>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2 tabular-nums">
                    {formatMoney(item.cost_price, tenant.currency)}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2 tabular-nums">
                    {item.reorder_point != null ? <Ltr>{`${item.reorder_point} ${item.uom}`}</Ltr> : "—"}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Modal title={t("suppliers.editSupplier")} open={editing} onClose={() => setEditing(false)} wide>
        <SupplierForm
          supplier={supplier}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </Modal>

      <Modal title={t("suppliers.addContact")} open={addingContact} onClose={() => setAddingContact(false)}>
        <ContactForm
          supplierId={supplier.id}
          contacts={contacts}
          onDone={() => setAddingContact(false)}
        />
      </Modal>

      <Modal
        title={t("suppliers.editContact")}
        open={!!editingContact}
        onClose={() => setEditingContact(null)}
      >
        {editingContact && (
          <ContactForm
            supplierId={supplier.id}
            contact={editingContact}
            contacts={contacts}
            onDone={() => setEditingContact(null)}
          />
        )}
      </Modal>

      <Modal
        title={t("suppliers.deleteContact")}
        open={!!deletingContact}
        onClose={() => setDeletingContact(null)}
      >
        {deletingContact && (
          <>
            <p className="text-sm text-ink-2">
              {t("suppliers.deleteContactConfirm", { name: bdiText(deletingContact.name) })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeletingContact(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => removeContact.mutate(deletingContact.id)}
                loading={removeContact.isPending}
              >
                {t("suppliers.deleteContact")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

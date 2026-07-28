/**
 * Shared building blocks for the three sales documents. Quotes, sales orders
 * and invoices differ in lifecycle, not in shape — so the header fields, the
 * line editor and the totals panel are written once here and the three detail
 * pages own only their own state machine.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import {
  deleteRow,
  insertRow,
  listRows,
  updateRow,
  type TableName,
} from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { computeLine } from "../../lib/sales";
import { productKinds } from "../../lib/labels";
import type {
  Contact,
  Customer,
  Product,
  SalesSettings,
  Vehicle,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type Translate } from "../../i18n";
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
  Textarea,
} from "../../components/ui";

/** Picker ceiling — combobox-with-server-search is a Phase-3 platform item. */
const PICKER_LIMIT = 200;

// --- Tenant-level sales policy ------------------------------------------

/**
 * The tenant's sales_settings row. The DB seeds it on the first document, so
 * an absent row simply means "no documents yet" — fall back to the defaults.
 */
export function useSalesSettings() {
  return useQuery({
    queryKey: ["sales_settings"],
    queryFn: async () => {
      const rows = await listRows<SalesSettings>("sales_settings");
      return rows[0] ?? null;
    },
    staleTime: 60_000,
  });
}

/** Tax rate new lines start from: tenant override, else the country's VAT. */
export function useDefaultTaxRate(): number {
  const tenant = useTenant();
  const { data: settings } = useSalesSettings();
  return settings?.default_tax_rate ?? getCountry(tenant.country).tax.rate;
}

// --- Small presentational pieces ----------------------------------------

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-ink-3">{label}</span>
      <span className="text-end font-medium text-ink">{value}</span>
    </div>
  );
}

export function SectionCard({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-5 ${className ?? ""}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {actions}
      </div>
      {children}
    </Card>
  );
}

// --- Reference pickers ---------------------------------------------------

export function useCustomers() {
  return useQuery({
    queryKey: ["customers", "picker"],
    queryFn: () =>
      listRows<Customer>("customers", (q) =>
        q.eq("status", "active").order("name").limit(PICKER_LIMIT),
      ),
    staleTime: 60_000,
  });
}

export function useContacts(customerId: string) {
  return useQuery({
    queryKey: ["contacts", "picker", customerId],
    queryFn: () =>
      listRows<Contact>("contacts", (q) =>
        q.eq("customer_id", customerId).order("name").limit(PICKER_LIMIT),
      ),
    enabled: Boolean(customerId),
    staleTime: 60_000,
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: ["vehicles", "picker"],
    queryFn: () =>
      listRows<Vehicle>("vehicles", (q) => q.order("name").limit(PICKER_LIMIT)),
    staleTime: 60_000,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ["products", "picker"],
    queryFn: () =>
      listRows<Product>("products", (q) =>
        q.eq("active", true).order("name").limit(PICKER_LIMIT),
      ),
    staleTime: 60_000,
  });
}

// --- Document header form ------------------------------------------------

export interface DocumentFormValues {
  customer_id: string;
  contact_id: string;
  vehicle_id: string;
  title: string;
  customer_reference: string;
  /** Quote: valid_until · Order: expected_date · Invoice: due_date. */
  secondary_date: string;
  /**
   * The customer's purchase order. Orders capture all three; invoices capture
   * only the number, as a snapshot of the PO they were raised against. Quotes
   * predate the PO, so they show none of it.
   */
  customer_po_number: string;
  customer_po_date: string;
  customer_po_url: string;
  terms: string;
  notes: string;
  internal_notes: string;
}

export function emptyDocumentForm(): DocumentFormValues {
  return {
    customer_id: "",
    contact_id: "",
    vehicle_id: "",
    title: "",
    customer_reference: "",
    secondary_date: "",
    customer_po_number: "",
    customer_po_date: "",
    customer_po_url: "",
    terms: "",
    notes: "",
    internal_notes: "",
  };
}

/**
 * The header fields every sales document shares. `secondaryDateLabel` names
 * the one date that differs per document type.
 */
export function DocumentFormFields({
  form,
  set,
  secondaryDateLabel,
  lockCustomer,
  purchaseOrder,
}: {
  form: DocumentFormValues;
  set: <K extends keyof DocumentFormValues>(key: K, value: string) => void;
  secondaryDateLabel: string;
  lockCustomer?: boolean;
  /**
   * How much of the customer's PO this document captures. "full" is the sales
   * order, which is where a PO is received; "number" is the invoice, which
   * only snapshots the reference it bills against. Omitted on quotes, which
   * come before the PO exists.
   */
  purchaseOrder?: "full" | "number";
}) {
  const t = useT();
  const customersQ = useCustomers();
  const contactsQ = useContacts(form.customer_id);
  const vehiclesQ = useVehicles();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("sales.doc.customer")} required>
          <Select
            value={form.customer_id}
            onChange={(e) => {
              set("customer_id", e.target.value);
              set("contact_id", ""); // contacts belong to the previous customer
            }}
            required
            disabled={lockCustomer || customersQ.isLoading}
          >
            <option value="">{t("sales.doc.selectCustomer")}</option>
            {(customersQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("sales.doc.contact")}>
          <Select
            value={form.contact_id}
            onChange={(e) => set("contact_id", e.target.value)}
            disabled={!form.customer_id}
          >
            <option value="">{t("sales.doc.noContact")}</option>
            {(contactsQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("sales.doc.title")}>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label={t("sales.doc.reference")}>
          <Input
            value={form.customer_reference}
            onChange={(e) => set("customer_reference", e.target.value)}
          />
        </Field>
        <Field label={secondaryDateLabel}>
          <Input
            type="date"
            value={form.secondary_date}
            onChange={(e) => set("secondary_date", e.target.value)}
          />
        </Field>
        <Field label={t("sales.doc.vehicle")}>
          <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)}>
            <option value="">{t("sales.doc.noVehicle")}</option>
            {(vehiclesQ.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{v.license_plate ? ` — ${v.license_plate}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {purchaseOrder && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("sales.doc.poNumber")} hint={t("sales.doc.poNumberHint")}>
            <Input
              value={form.customer_po_number}
              onChange={(e) => set("customer_po_number", e.target.value)}
            />
          </Field>
          {purchaseOrder === "full" && (
            <>
              <Field label={t("sales.doc.poDate")}>
                <Input
                  type="date"
                  value={form.customer_po_date}
                  onChange={(e) => set("customer_po_date", e.target.value)}
                />
              </Field>
              <Field label={t("sales.doc.poUrl")} hint={t("sales.doc.poUrlHint")}>
                <Input
                  dir="ltr"
                  value={form.customer_po_url}
                  onChange={(e) => set("customer_po_url", e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      )}
      <Field label={t("sales.doc.terms")}>
        <Textarea value={form.terms} onChange={(e) => set("terms", e.target.value)} />
      </Field>
      <Field label={t("sales.doc.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <Field label={t("sales.doc.internalNotes")} hint={t("sales.doc.internalNotesHint")}>
        <Textarea
          value={form.internal_notes}
          onChange={(e) => set("internal_notes", e.target.value)}
        />
      </Field>
    </div>
  );
}

/** Form values → column payload. `dateColumn` names the type-specific date. */
export function documentPayload(
  form: DocumentFormValues,
  dateColumn: "valid_until" | "expected_date" | "due_date",
  purchaseOrder?: "full" | "number",
): Record<string, unknown> {
  // Only send the PO columns the document actually has: quotes carry none, and
  // invoices carry the number alone.
  const po =
    purchaseOrder === "full"
      ? {
          customer_po_number: form.customer_po_number.trim() || null,
          customer_po_date: form.customer_po_date || null,
          customer_po_url: form.customer_po_url.trim() || null,
        }
      : purchaseOrder === "number"
        ? { customer_po_number: form.customer_po_number.trim() || null }
        : {};
  return {
    ...po,
    customer_id: form.customer_id,
    contact_id: form.contact_id || null,
    vehicle_id: form.vehicle_id || null,
    title: form.title.trim() || null,
    customer_reference: form.customer_reference.trim() || null,
    [dateColumn]: form.secondary_date || null,
    terms: form.terms.trim() || null,
    notes: form.notes.trim() || null,
    internal_notes: form.internal_notes.trim() || null,
  };
}

// --- Totals --------------------------------------------------------------

export interface TotalsDoc {
  currency: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
}

/**
 * The money summary. Amounts come straight from the document row — the DB
 * computed them from the lines, so this never re-derives anything.
 */
export function TotalsPanel({
  doc,
  paid,
  balance,
  taxLabel,
}: {
  doc: TotalsDoc;
  paid?: number;
  balance?: number;
  taxLabel: string;
}) {
  const t = useT();
  const money = (v: number) => formatMoney(v, doc.currency);
  return (
    <dl className="space-y-1.5 text-sm tabular-nums">
      <Row label={t("sales.doc.subtotal")} value={money(doc.subtotal)} />
      {doc.discount_total > 0 && (
        <Row label={t("sales.doc.discount")} value={`− ${money(doc.discount_total)}`} />
      )}
      {doc.tax_total > 0 && <Row label={taxLabel} value={money(doc.tax_total)} />}
      <div className="border-t border-line pt-2">
        <Row label={t("sales.doc.total")} value={money(doc.total)} strong />
      </div>
      {paid !== undefined && (
        <>
          <Row label={t("sales.doc.amountPaid")} value={money(paid)} />
          <Row label={t("sales.doc.balanceDue")} value={money(balance ?? 0)} strong />
        </>
      )}
    </dl>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-2"}>{label}</dt>
      <dd className={strong ? "text-base font-semibold text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}

/** "VAT (5%)" when a single rate is in play, otherwise a plain "Tax". */
export function taxHeading(
  t: Translate,
  countryTaxLabel: string,
  rates: number[],
): string {
  const distinct = [...new Set(rates.filter((r) => r > 0))];
  return distinct.length === 1
    ? t("sales.doc.tax", { label: countryTaxLabel, rate: distinct[0] })
    : t("sales.doc.taxTotal");
}

// --- Line editor ---------------------------------------------------------

export interface EditableLine {
  id: string;
  sort_order: number;
  product_id: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_total: number;
}

interface LineDraft {
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
}

function draftOf(line: EditableLine): LineDraft {
  return {
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit ?? "",
    unit_price: String(line.unit_price),
    discount_percent: String(line.discount_percent),
    tax_rate: String(line.tax_rate),
  };
}

function draftPayload(d: LineDraft): Record<string, unknown> {
  return {
    description: d.description.trim(),
    quantity: Number(d.quantity) || 0,
    unit: d.unit.trim() || null,
    unit_price: Number(d.unit_price) || 0,
    discount_percent: Number(d.discount_percent) || 0,
    tax_rate: Number(d.tax_rate) || 0,
  };
}

/**
 * Inline line-item editor. Rows are editable in place and save explicitly —
 * a dirty row grows a save/undo pair rather than firing a request per
 * keystroke. Amounts previewed with the same rounding the DB will apply.
 */
export function LineEditor({
  table,
  lines,
  parentColumn,
  parentId,
  currency,
  currencyDecimals,
  readOnly,
  queryKey,
}: {
  table: TableName;
  lines: EditableLine[];
  parentColumn: string;
  parentId: string;
  currency: string;
  currencyDecimals: number;
  readOnly: boolean;
  queryKey: unknown[];
}) {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const catalogQ = useCatalog();
  const defaultTax = useDefaultTaxRate();

  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState<LineDraft>(() => ({
    description: "",
    quantity: "1",
    unit: "",
    unit_price: "",
    discount_percent: "0",
    tax_rate: String(defaultTax),
  }));
  const [addProductId, setAddProductId] = useState("");

  const editable = !readOnly && isManager;

  function invalidate() {
    void qc.invalidateQueries({ queryKey });
  }

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: LineDraft }) =>
      updateRow(table, id, draftPayload(draft)),
    onSuccess: (_data, vars) => {
      setError("");
      setDrafts((d) => {
        const next = { ...d };
        delete next[vars.id];
        return next;
      });
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  const add = useMutation({
    mutationFn: () =>
      insertRow(table, {
        [parentColumn]: parentId,
        product_id: addProductId || null,
        sort_order: lines.length,
        ...draftPayload(adding),
      }),
    onSuccess: () => {
      setError("");
      setAdding({
        description: "",
        quantity: "1",
        unit: "",
        unit_price: "",
        discount_percent: "0",
        tax_rate: String(defaultTax),
      });
      setAddProductId("");
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow(table, id),
    onSuccess: () => {
      setError("");
      setDeleting(null);
      invalidate();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("sales.deleteFailed"));
      setDeleting(null);
    },
  });

  const reorder = useMutation({
    mutationFn: async ({ a, b }: { a: EditableLine; b: EditableLine }) => {
      await updateRow(table, a.id, { sort_order: b.sort_order });
      await updateRow(table, b.id, { sort_order: a.sort_order });
    },
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  function pickProduct(productId: string) {
    setAddProductId(productId);
    const product = (catalogQ.data ?? []).find((p) => p.id === productId);
    if (!product) return;
    setAdding((a) => ({
      ...a,
      description: product.name,
      unit: product.unit,
      unit_price: String(product.unit_price),
      tax_rate: String(product.tax_rate),
    }));
  }

  function onAdd(e: FormEvent) {
    e.preventDefault();
    setError("");
    add.mutate();
  }

  const addPreview = computeLine(
    {
      quantity: Number(adding.quantity) || 0,
      unit_price: Number(adding.unit_price) || 0,
      discount_percent: Number(adding.discount_percent) || 0,
      tax_rate: Number(adding.tax_rate) || 0,
    },
    currencyDecimals,
  );

  const sorted = useMemo(
    () => [...lines].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    [lines],
  );

  return (
    <div>
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-canvas/60">
            <tr>
              {[
                t("sales.lines.description"),
                t("sales.lines.qty"),
                t("sales.lines.unitPrice"),
                t("sales.lines.discountPercent"),
                t("sales.lines.taxPercent"),
                t("sales.lines.lineTotal"),
              ].map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal ${
                    i === 0 ? "text-start" : "text-end"
                  }`}
                >
                  {h}
                </th>
              ))}
              {editable && <th className="w-24 px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((line, index) => {
              const draft = drafts[line.id];
              const dirty = Boolean(draft);
              const current = draft ?? draftOf(line);
              const preview = computeLine(
                {
                  quantity: Number(current.quantity) || 0,
                  unit_price: Number(current.unit_price) || 0,
                  discount_percent: Number(current.discount_percent) || 0,
                  tax_rate: Number(current.tax_rate) || 0,
                },
                currencyDecimals,
              );
              const setField = (key: keyof LineDraft, value: string) =>
                setDrafts((d) => ({ ...d, [line.id]: { ...current, [key]: value } }));

              if (!editable) {
                return (
                  <tr key={line.id}>
                    <td className="px-3 py-2.5 text-ink">{line.description}</td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      {line.quantity}{line.unit ? ` ${line.unit}` : ""}
                    </td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      {formatMoney(line.unit_price, currency)}
                    </td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      {line.discount_percent > 0 ? `${line.discount_percent}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-end text-ink-2 tabular-nums">
                      {line.tax_rate > 0 ? `${line.tax_rate}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-end font-medium text-ink tabular-nums">
                      {formatMoney(line.line_total, currency)}
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={line.id} className={dirty ? "bg-brand-50/40" : undefined}>
                  <td className="px-3 py-2">
                    <Input
                      value={current.description}
                      onChange={(e) => setField("description", e.target.value)}
                      aria-label={t("sales.lines.description")}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number" min={0} step="0.001"
                      className="w-24 text-end tabular-nums"
                      value={current.quantity}
                      onChange={(e) => setField("quantity", e.target.value)}
                      aria-label={t("sales.lines.qty")}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number" min={0} step="0.0001"
                      className="w-28 text-end tabular-nums"
                      value={current.unit_price}
                      onChange={(e) => setField("unit_price", e.target.value)}
                      aria-label={t("sales.lines.unitPrice")}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number" min={0} max={100} step="0.01"
                      className="w-20 text-end tabular-nums"
                      value={current.discount_percent}
                      onChange={(e) => setField("discount_percent", e.target.value)}
                      aria-label={t("sales.lines.discountPercent")}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number" min={0} max={100} step="0.01"
                      className="w-20 text-end tabular-nums"
                      value={current.tax_rate}
                      onChange={(e) => setField("tax_rate", e.target.value)}
                      aria-label={t("sales.lines.taxPercent")}
                    />
                  </td>
                  <td className="px-3 py-2 text-end font-medium text-ink tabular-nums">
                    {formatMoney(preview.total, currency)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      {dirty ? (
                        <>
                          <IconButton
                            label={t("action.saveChanges")}
                            onClick={() => save.mutate({ id: line.id, draft: current })}
                            disabled={save.isPending}
                            tone="brand"
                          >
                            <Check className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={t("action.cancel")}
                            onClick={() =>
                              setDrafts((d) => {
                                const next = { ...d };
                                delete next[line.id];
                                return next;
                              })
                            }
                          >
                            <RotateCcw className="h-4 w-4 rtl:-scale-x-100" />
                          </IconButton>
                        </>
                      ) : (
                        <>
                          <IconButton
                            label={t("sales.lines.moveUp")}
                            disabled={index === 0 || reorder.isPending}
                            onClick={() => reorder.mutate({ a: line, b: sorted[index - 1] })}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={t("sales.lines.moveDown")}
                            disabled={index === sorted.length - 1 || reorder.isPending}
                            onClick={() => reorder.mutate({ a: line, b: sorted[index + 1] })}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={t("sales.lines.delete")}
                            tone="danger"
                            onClick={() => setDeleting(line.id)}
                            disabled={remove.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={editable ? 7 : 6} className="px-3 py-8 text-center text-sm text-ink-3">
                  {editable ? t("sales.lines.empty") : t("sales.lines.emptyReadOnly")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleting && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-serious/30 bg-serious-soft px-4 py-3">
          <span className="text-sm text-ink">
            {t("sales.lines.deleteConfirm", {
              description: sorted.find((l) => l.id === deleting)?.description ?? "",
            })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(deleting)}
            >
              {t("action.delete")}
            </Button>
          </div>
        </div>
      )}

      {editable && (
        <form onSubmit={onAdd} className="mt-4 rounded-xl border border-dashed border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <div className="lg:col-span-3">
              <Field label={t("sales.lines.fromCatalog")}>
                <Select value={addProductId} onChange={(e) => pickProduct(e.target.value)}>
                  <option value="">{t("sales.lines.customLine")}</option>
                  {(catalogQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {t(productKinds[p.kind])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="lg:col-span-3">
              <Field label={t("sales.lines.description")} required>
                <Input
                  value={adding.description}
                  onChange={(e) => setAdding((a) => ({ ...a, description: e.target.value }))}
                  placeholder={t("sales.lines.descriptionPlaceholder")}
                  required
                />
              </Field>
            </div>
            <div className="lg:col-span-1">
              <Field label={t("sales.lines.qty")}>
                <Input
                  type="number" min={0.001} step="0.001" required
                  className="text-end tabular-nums"
                  value={adding.quantity}
                  onChange={(e) => setAdding((a) => ({ ...a, quantity: e.target.value }))}
                />
              </Field>
            </div>
            <div className="lg:col-span-1">
              <Field label={t("sales.lines.unit")}>
                <Input
                  value={adding.unit}
                  onChange={(e) => setAdding((a) => ({ ...a, unit: e.target.value }))}
                />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label={t("sales.lines.unitPrice")}>
                <Input
                  type="number" min={0} step="0.0001" required
                  className="text-end tabular-nums"
                  value={adding.unit_price}
                  onChange={(e) => setAdding((a) => ({ ...a, unit_price: e.target.value }))}
                />
              </Field>
            </div>
            <div className="lg:col-span-1">
              <Field label={t("sales.lines.discountPercent")}>
                <Input
                  type="number" min={0} max={100} step="0.01"
                  className="text-end tabular-nums"
                  value={adding.discount_percent}
                  onChange={(e) => setAdding((a) => ({ ...a, discount_percent: e.target.value }))}
                />
              </Field>
            </div>
            <div className="lg:col-span-1">
              <Field label={t("sales.lines.taxPercent")}>
                <Input
                  type="number" min={0} max={100} step="0.01"
                  className="text-end tabular-nums"
                  value={adding.tax_rate}
                  onChange={(e) => setAdding((a) => ({ ...a, tax_rate: e.target.value }))}
                />
              </Field>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-2 tabular-nums">
              {t("sales.lines.previewTotal", {
                amount: formatMoney(addPreview.total, currency),
              })}
            </span>
            <Button type="submit" loading={add.isPending}>
              <Plus className="h-4 w-4" /> {t("sales.lines.add")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  tone = "muted",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "muted" | "brand" | "danger";
  children: ReactNode;
}) {
  const tones = {
    muted: "text-ink-3 hover:bg-canvas hover:text-ink-2",
    brand: "text-brand-600 hover:bg-brand-50",
    danger: "text-ink-3 hover:bg-serious-soft hover:text-serious",
  };
  return (
    <button
      type="button"
      className={`rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

// --- Document page scaffolding ------------------------------------------

export function DocumentLoadState({
  isLoading,
  error,
  missing,
  missingMessage,
}: {
  isLoading: boolean;
  error: unknown;
  missing: boolean;
  missingMessage: string;
}): ReactNode | null {
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (missing) return <ErrorState message={missingMessage} />;
  return null;
}

/** Back-link above a document header, matching the SL detail pages. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2"
    >
      <ArrowUp className="h-4 w-4 -rotate-90 rtl:rotate-90" /> {label}
    </Link>
  );
}

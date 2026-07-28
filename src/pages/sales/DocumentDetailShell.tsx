/**
 * The frame every sales document detail page renders inside: header + status,
 * the details card, the line editor, the totals panel, edit and delete. Each
 * document type supplies only its own lifecycle actions and extra panels.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Printer, Trash2 } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { deleteRow, getRow, listRows, updateRow, type TableName } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { recordRecent } from "../../lib/recent";
import type { Customer } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  type BadgeTone,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import {
  BackLink,
  DocumentFormFields,
  documentPayload,
  InfoRow,
  LineEditor,
  SectionCard,
  TotalsPanel,
  taxHeading,
  type DocumentFormValues,
  type EditableLine,
} from "./shared";

/** Everything the shell needs off a document row, whatever its type. */
export interface ShellDocument {
  id: string;
  doc_number: string;
  status: string;
  customer_id: string;
  contact_id: string | null;
  vehicle_id: string | null;
  title: string | null;
  customer_reference: string | null;
  terms: string | null;
  notes: string | null;
  internal_notes: string | null;
  currency: string;
  currency_decimals: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  created_at: string;
}

export interface ShellRenderArgs<T> {
  doc: T;
  lines: EditableLine[];
  /** Patch the document (status transitions and lifecycle stamps). */
  patch: (values: Record<string, unknown>) => void;
  patching: boolean;
  setError: (message: string) => void;
  refresh: () => void;
}

export function DocumentDetailShell<T extends ShellDocument>({
  id,
  table,
  linesTable,
  parentColumn,
  routeBase,
  backLabel,
  notFoundMessage,
  statusMeta,
  effectiveStatus,
  dateColumn,
  dateLabel,
  editTitle,
  deleteTitle,
  deleteConfirm,
  headerMeta,
  actions,
  isEditable,
  isDeletable,
  detailRows,
  purchaseOrder,
  totalsExtra,
  panels,
  afterLines,
  onDeleted,
}: {
  id: string;
  table: TableName;
  linesTable: TableName;
  parentColumn: string;
  routeBase: string;
  backLabel: string;
  notFoundMessage: string;
  statusMeta: Record<string, { labelKey: MessageKey; tone: BadgeTone }>;
  effectiveStatus?: (doc: T) => string;
  dateColumn: "valid_until" | "expected_date" | "due_date";
  dateLabel: string;
  editTitle: string;
  /** Which PO fields this document type captures; see DocumentFormFields. */
  purchaseOrder?: "full" | "number";
  deleteTitle: string;
  deleteConfirm: (doc: T) => string;
  headerMeta?: (doc: T) => ReactNode;
  actions: (args: ShellRenderArgs<T>) => ReactNode;
  isEditable: (doc: T) => boolean;
  isDeletable: (doc: T) => boolean;
  detailRows?: (doc: T) => ReactNode;
  totalsExtra?: (doc: T) => { paid: number; balance: number } | undefined;
  panels?: (args: ShellRenderArgs<T>) => ReactNode;
  afterLines?: (args: ShellRenderArgs<T>) => ReactNode;
  onDeleted?: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState("");

  const docQuery = useQuery({
    queryKey: [table, id],
    queryFn: () => getRow<T>(table, id),
  });
  const doc = docQuery.data ?? null;

  const linesQuery = useQuery({
    queryKey: [linesTable, id],
    queryFn: () =>
      listRows<EditableLine>(linesTable, (q) =>
        q.eq(parentColumn, id).order("sort_order").order("created_at"),
      ),
  });
  const lines = linesQuery.data ?? [];

  const customerQuery = useQuery({
    queryKey: ["customers", doc?.customer_id],
    queryFn: () => getRow<Customer>("customers", doc!.customer_id),
    enabled: Boolean(doc?.customer_id),
  });

  useEffect(() => {
    if (doc) recordRecent(doc.doc_number, `${routeBase}/${doc.id}`);
  }, [doc, routeBase]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: [table] });
    void qc.invalidateQueries({ queryKey: [linesTable, id] });
    void qc.invalidateQueries({ queryKey: ["sales_summary"] });
  }

  const patch = useMutation({
    mutationFn: (values: Record<string, unknown>) => updateRow(table, id, values),
    onSuccess: () => {
      setActionError("");
      refresh();
      // Status transitions are the main thing that happens on these pages and
      // they change nothing the eye catches — the badge is one word.
      toast.success(t("toast.saved"));
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : t("sales.actionFailed")),
  });

  const remove = useMutation({
    mutationFn: () => deleteRow(table, id),
    onSuccess: () => {
      refresh();
      setConfirmDelete(false);
      onDeleted?.();
      navigate(routeBase);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("sales.deleteFailed"));
      setConfirmDelete(false);
    },
  });

  if (docQuery.isLoading) return <LoadingState />;
  if (docQuery.error) return <ErrorState message={(docQuery.error as Error).message} />;
  if (!doc) return <ErrorState message={notFoundMessage} />;

  const shown = effectiveStatus?.(doc) ?? doc.status;
  const meta = statusMeta[shown];
  const editable = isEditable(doc) && isManager;
  const args: ShellRenderArgs<T> = {
    doc,
    lines,
    patch: (values) => patch.mutate(values),
    patching: patch.isPending,
    setError: setActionError,
    refresh,
  };
  const country = getCountry(tenant.country);
  const settlement = totalsExtra?.(doc);

  return (
    <>
      <div className="print:hidden">
        <BackLink to={routeBase} label={backLabel} />
        <PageHeader
          title={doc.doc_number}
          description={doc.title ?? customerQuery.data?.name}
          actions={
            <>
              {meta && <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>}
              {headerMeta?.(doc)}
              {actions(args)}
              <Button variant="secondary" onClick={() => navigate(`${routeBase}/${doc.id}/print`)}>
                <Printer className="h-4 w-4" /> {t("sales.print.action")}
              </Button>
              {editable && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> {t("action.edit")}
                </Button>
              )}
              {isManager && isDeletable(doc) && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" /> {t("action.delete")}
                </Button>
              )}
            </>
          }
        />
      </div>

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <SectionCard title={t("sales.doc.details")}>
            <InfoRow
              label={t("sales.doc.customer")}
              value={
                customerQuery.data ? (
                  <Link
                    to={`/customers/${doc.customer_id}`}
                    className="text-brand-700 hover:underline"
                  >
                    {customerQuery.data.name}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            {detailRows?.(doc)}
            {doc.customer_reference && (
              <InfoRow label={t("sales.doc.reference")} value={doc.customer_reference} />
            )}
            <InfoRow label={t("sales.doc.created")} value={formatDate(doc.created_at)} />
            {doc.notes && (
              <p className="mt-3 rounded-lg bg-canvas p-3 text-sm text-ink-2">{doc.notes}</p>
            )}
            {doc.internal_notes && (
              <p className="mt-2 rounded-lg border border-dashed border-line p-3 text-sm text-ink-3">
                {doc.internal_notes}
              </p>
            )}
          </SectionCard>

          <SectionCard title={t("sales.doc.summary")}>
            <TotalsPanel
              doc={doc}
              paid={settlement?.paid}
              balance={settlement?.balance}
              taxLabel={taxHeading(t, country.tax.label, lines.map((l) => l.tax_rate))}
            />
            {!editable && (
              <p className="mt-3 text-xs text-ink-3">{t("sales.doc.lockedHint")}</p>
            )}
          </SectionCard>

          {panels?.(args)}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <SectionCard title={t("sales.lines.title")}>
            {linesQuery.isLoading ? (
              <LoadingState />
            ) : linesQuery.error ? (
              <ErrorState message={(linesQuery.error as Error).message} />
            ) : (
              <LineEditor
                table={linesTable}
                lines={lines}
                parentColumn={parentColumn}
                parentId={doc.id}
                currency={doc.currency}
                currencyDecimals={doc.currency_decimals}
                readOnly={!editable}
                queryKey={[linesTable, id]}
              />
            )}
          </SectionCard>

          {afterLines?.(args)}

          {doc.terms && (
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">{t("sales.doc.terms")}</h3>
              <p className="whitespace-pre-line text-sm text-ink-2">{doc.terms}</p>
            </Card>
          )}
        </div>
      </div>

      <Modal title={editTitle} open={editing} onClose={() => setEditing(false)} wide>
        {editing && (
          <EditDocumentForm
            doc={doc}
            table={table}
            dateColumn={dateColumn}
            dateLabel={dateLabel}
            purchaseOrder={purchaseOrder}
            onDone={() => {
              setEditing(false);
              refresh();
            }}
          />
        )}
      </Modal>

      <Modal title={deleteTitle} open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-ink-2">{deleteConfirm(doc)}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            {deleteTitle}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Reads an optional column the shared shape does not declare (quotes have no
 *  PO columns at all, invoices only the number). */
function docField(doc: unknown, column: string): string {
  return (doc as Record<string, string | null | undefined>)[column] ?? "";
}

function EditDocumentForm<T extends ShellDocument>({
  doc,
  table,
  dateColumn,
  dateLabel,
  purchaseOrder,
  onDone,
}: {
  doc: T;
  table: TableName;
  dateColumn: "valid_until" | "expected_date" | "due_date";
  dateLabel: string;
  purchaseOrder?: "full" | "number";
  onDone: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<DocumentFormValues>({
    customer_id: doc.customer_id,
    contact_id: doc.contact_id ?? "",
    vehicle_id: doc.vehicle_id ?? "",
    title: doc.title ?? "",
    customer_reference: doc.customer_reference ?? "",
    secondary_date: (doc as unknown as Record<string, string | null>)[dateColumn] ?? "",
    customer_po_number: docField(doc, "customer_po_number"),
    customer_po_date: docField(doc, "customer_po_date"),
    customer_po_url: docField(doc, "customer_po_url"),
    terms: doc.terms ?? "",
    notes: doc.notes ?? "",
    internal_notes: doc.internal_notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof DocumentFormValues>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const save = useMutation({
    mutationFn: () => updateRow(table, doc.id, documentPayload(form, dateColumn, purchaseOrder)),
    onSuccess: onDone,
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
      <DocumentFormFields
        form={form}
        set={set}
        secondaryDateLabel={dateLabel}
        purchaseOrder={purchaseOrder}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("action.cancel")}
        </Button>
        <Button type="submit" loading={save.isPending}>{t("action.saveChanges")}</Button>
      </div>
    </form>
  );
}

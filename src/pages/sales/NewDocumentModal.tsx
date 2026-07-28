/**
 * "New document" dialog shared by quotes, orders and invoices. Creating a
 * document only captures its header — the number, currency and totals are the
 * database's job — then drops you straight into the detail page to build the
 * lines, which is where the real work is.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertRow, type TableName } from "../../lib/db";
import { useT } from "../../i18n";
import { Button, ErrorState, Modal } from "../../components/ui";
import {
  DocumentFormFields,
  documentPayload,
  emptyDocumentForm,
  useSalesSettings,
  type DocumentFormValues,
} from "./shared";

type DateColumn = "valid_until" | "expected_date" | "due_date";

/** Today + n days as YYYY-MM-DD (dates here are date-only, never instants). */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function NewDocumentModal({
  open,
  onClose,
  table,
  routeBase,
  title,
  dateColumn,
  dateLabel,
  /** Which settings field seeds the date (quotes: validity, invoices: terms). */
  defaultDays,
  prefill,
  extraPayload,
  purchaseOrder,
}: {
  open: boolean;
  onClose: () => void;
  table: TableName;
  routeBase: string;
  title: string;
  dateColumn: DateColumn;
  dateLabel: string;
  defaultDays?: "quote_valid_days" | "payment_terms_days";
  /**
   * Header values to start from — used when a document is raised from
   * somewhere that already knows them, e.g. a speed-limiter job that knows its
   * customer and vehicle. Still editable before saving.
   */
  prefill?: Partial<DocumentFormValues>;
  /**
   * Columns the form does not own, written with the document. This is how the
   * job/certificate link is attached at creation rather than bolted on after.
   */
  extraPayload?: Record<string, unknown>;
  purchaseOrder?: "full" | "number";
}) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = useSalesSettings();
  const [form, setForm] = useState<DocumentFormValues>(() => ({
    ...emptyDocumentForm(),
    ...prefill,
  }));
  const [error, setError] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Seed the date + terms from tenant settings once they arrive, without
  // clobbering anything the user has already typed.
  if (open && !seeded && settings !== undefined) {
    setSeeded(true);
    const days = defaultDays ? (settings?.[defaultDays] ?? 30) : null;
    const terms =
      table === "invoices" ? settings?.invoice_terms : settings?.quote_terms;
    setForm((f) => ({
      ...f,
      secondary_date: f.secondary_date || (days !== null ? inDays(days) : ""),
      terms: f.terms || terms || "",
    }));
  }

  function set<K extends keyof DocumentFormValues>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    setForm({ ...emptyDocumentForm(), ...prefill });
    setSeeded(false);
    setError("");
    onClose();
  }

  const create = useMutation({
    mutationFn: () =>
      insertRow<{ id: string }>(table, {
        ...documentPayload(form, dateColumn, purchaseOrder),
        ...extraPayload,
      }),
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: [table] });
      void qc.invalidateQueries({ queryKey: ["sales_summary"] });
      close();
      navigate(`${routeBase}/${doc.id}`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    create.mutate();
  }

  return (
    <Modal title={title} open={open} onClose={close} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}
        <DocumentFormFields
          form={form}
          set={set}
          secondaryDateLabel={dateLabel}
          purchaseOrder={purchaseOrder}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {t("action.cancel")}
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!form.customer_id}>
            {t("action.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Record that certificates were invoiced and paid OUTSIDE FleetManage — the
 * paper register, a manual invoice book, another accounting system. They
 * stop reading as "not invoiced" everywhere (list chip, customer card, Sales
 * report, KPIs) and can never be put on a FleetManage invoice afterwards.
 *
 * One RPC, one transaction (set_certificates_paid_externally). Certificates a
 * FleetManage invoice already bills are shown as skipped rather than sent:
 * the database would refuse them (CERT_ALREADY_INVOICED) and the operator
 * should see which ones and why, not a bare error.
 *
 * The form is exported on its own so the invoice dialog can embed it for the
 * certificates the operator just removed from an invoice — no modal in a modal.
 */
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { wrapDbError } from "../../lib/db";
import { supabase } from "../../lib/supabase";
import { ltrText } from "../../lib/bidi";
import { indexBillingRows, type InvoiceableCertificate } from "../../lib/certificateBilling";
import { useT, useTp } from "../../i18n";
import { useToast } from "../../components/Toast";
import {
  Button, ErrorState, Field, Input, LoadingState, Ltr, Modal,
} from "../../components/ui";
import { useCertificateBilling } from "./InvoiceCertificatesModal";

/** Everything that shows billing reads one of these keys. */
function invalidateBilling(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["speed_limiter_certificates"] });
  void qc.invalidateQueries({ queryKey: ["certificate_billing_status"] });
  void qc.invalidateQueries({ queryKey: ["sales_summary"] });
  void qc.invalidateQueries({ queryKey: ["sales_report"] });
}

/**
 * Mark (paidOn = YYYY-MM-DD) or clear (paidOn = null) the manual settlement.
 * Shared by the form below and the "Undo" actions on the list.
 */
export function useSetPaidExternally() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { ids: string[]; paidOn: string | null; reference?: string }) => {
      const { data, error } = await supabase.rpc("set_certificates_paid_externally", {
        p_certificate_ids: args.ids,
        // The generated type marks it required; NULL is the documented undo.
        p_paid_on: args.paidOn as string,
        p_reference: args.reference?.trim() || undefined,
      });
      if (error) throw wrapDbError(error);
      return data as number;
    },
    onSuccess: () => invalidateBilling(qc),
  });
}

export function MarkPaidExternallyForm({
  certs,
  onDone,
  onCancel,
  embedded = false,
}: {
  certs: InvoiceableCertificate[];
  /**
   * Rendered inside another <form> (the invoice dialog). Forms cannot nest,
   * so the root becomes a <div> and the confirm button submits by click.
   */
  embedded?: boolean;
  /** Called after a successful save with the ids that were marked. */
  onDone: (markedIds: string[]) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tp = useTp();
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  const ids = useMemo(() => certs.map((c) => c.id), [certs]);
  const billingQ = useCertificateBilling(ids);
  const billed = indexBillingRows(billingQ.data);
  const eligible = certs.filter((c) => !billed.has(c.id));
  const skipped = certs.filter((c) => billed.has(c.id));

  const save = useSetPaidExternally();

  function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    if (!paidOn) {
      setError(t("slCertificates.markPaidDateRequired"));
      return;
    }
    const markIds = eligible.map((c) => c.id);
    save.mutate(
      { ids: markIds, paidOn, reference },
      {
        onSuccess: () => {
          toast.success(tp("slCertificates.markPaidDone", markIds.length));
          onDone(markIds);
        },
        onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
      },
    );
  }

  if (billingQ.isLoading) return <LoadingState />;
  if (billingQ.error) return <ErrorState message={(billingQ.error as Error).message} />;

  const Root = embedded ? "div" : "form";
  return (
    <Root
      className="space-y-4"
      {...(embedded ? {} : { onSubmit: (e: FormEvent) => onSubmit(e) })}
    >
      {error && <ErrorState message={error} />}
      <p className="text-sm text-ink-2">{t("slCertificates.markPaidLead")}</p>

      <div className="rounded-lg bg-canvas p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {tp("slCertificates.markPaidList", eligible.length)}
        </h3>
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-sm">
          {eligible.map((c) => (
            <li key={c.id} className="flex justify-between gap-4">
              <span className="font-medium text-ink"><Ltr>{c.certificate_number}</Ltr></span>
              <span className="text-end text-ink-3">
                {c.license_plate ? <Ltr>{c.license_plate}</Ltr> : t("common.dash")}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {skipped.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
            {t("slCertificates.invoiceSkipped", { count: skipped.length })}
          </h3>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-sm">
            {skipped.map((c) => (
              <li key={c.id} className="flex justify-between gap-4">
                <span className="font-medium text-ink"><Ltr>{c.certificate_number}</Ltr></span>
                <span className="text-end text-ink-3">
                  {t("slCertificates.invoiceSkipInvoiced", {
                    number: ltrText(billed.get(c.id)?.doc_number ?? ""),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {eligible.length === 0 ? (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("action.close")}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("slCertificates.markPaidDate")} required>
              <Input
                type="date"
                required
                value={paidOn}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Field>
            <Field
              label={t("slCertificates.markPaidRef")}
              hint={t("slCertificates.markPaidRefHint")}
            >
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel} disabled={save.isPending}>
              {t("action.cancel")}
            </Button>
            <Button
              type={embedded ? "button" : "submit"}
              onClick={embedded ? () => onSubmit() : undefined}
              loading={save.isPending}
            >
              {t("slCertificates.markPaidConfirm")}
            </Button>
          </div>
        </>
      )}
    </Root>
  );
}

export function MarkPaidExternallyModal({
  certificates,
  onClose,
  onDone,
}: {
  /** The selection to mark; null closes the dialog. */
  certificates: InvoiceableCertificate[] | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const tp = useTp();
  return (
    <Modal
      title={tp("slCertificates.markPaidTitle", certificates?.length ?? 0)}
      open={certificates !== null}
      onClose={onClose}
      wide
    >
      {certificates && (
        <MarkPaidExternallyForm
          certs={certificates}
          onCancel={onClose}
          onDone={() => {
            onDone?.();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

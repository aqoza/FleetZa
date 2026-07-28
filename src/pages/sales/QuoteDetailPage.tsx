import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, Ban, Check, Copy, CopyPlus, Send, ThumbsDown,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { wrapDbError } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { quoteStatus } from "../../lib/labels";
import { effectiveQuoteStatus, isQuoteExpired } from "../../lib/sales";
import type { Quote, SalesOrder } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Modal, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DocumentDetailShell, type ShellRenderArgs } from "./DocumentDetailShell";
import { InfoRow, SectionCard } from "./shared";

export default function QuoteDetailPage() {
  const t = useT();
  const { quoteId = "" } = useParams();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [copied, setCopied] = useState(false);

  const convert = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("convert_quote_to_order", { p_quote_id: id });
      if (error) throw wrapDbError(error);
      return data as unknown as SalesOrder;
    },
    onSuccess: (order) => {
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      void qc.invalidateQueries({ queryKey: ["sales_orders"] });
      void qc.invalidateQueries({ queryKey: ["sales_summary"] });
      navigate(`/sales/orders/${order.id}`);
      toast.success(t("sales.toast.converted", { number: order.doc_number }));
    },
  });

  const revise = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("revise_quote", { p_quote_id: id });
      if (error) throw wrapDbError(error);
      return data as unknown as Quote;
    },
    onSuccess: (quote) => {
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      navigate(`/sales/quotes/${quote.id}`);
      toast.success(t("sales.toast.revised", { number: quote.doc_number }));
    },
  });

  function publicUrl(quote: Quote): string {
    return `${location.origin}/q/${quote.public_token}`;
  }

  function actions({ doc, patch, patching, setError }: ShellRenderArgs<Quote>) {
    if (!isManager) return null;
    const status = doc.status;
    const expired = isQuoteExpired(doc);

    const run = (values: Record<string, unknown>) => {
      setError("");
      patch(values);
    };

    return (
      <>
        {status === "draft" && (
          <Button onClick={() => run({ status: "sent" })} loading={patching}>
            <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("sales.quotes.send")}
          </Button>
        )}
        {status === "sent" && (
          <>
            <Button onClick={() => run({ status: "accepted" })} loading={patching}>
              <Check className="h-4 w-4" /> {t("sales.quotes.accept")}
            </Button>
            <Button variant="secondary" disabled={patching} onClick={() => setDeclining(true)}>
              <ThumbsDown className="h-4 w-4" /> {t("sales.quotes.decline")}
            </Button>
            {expired && (
              <Button
                variant="secondary"
                disabled={patching}
                onClick={() => run({ status: "expired" })}
              >
                {t("sales.quotes.markExpired")}
              </Button>
            )}
            <Button variant="ghost" disabled={patching} onClick={() => run({ status: "draft" })}>
              {t("sales.quotes.reopen")}
            </Button>
          </>
        )}
        {status === "accepted" && !doc.sales_order_id && isEnabled("sales") && (
          <Button
            onClick={() => {
              setError("");
              convert.mutate(doc.id, {
                onError: (err) =>
                  setError(err instanceof Error ? err.message : t("sales.actionFailed")),
              });
            }}
            loading={convert.isPending}
          >
            <ArrowRightLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("sales.quotes.convert")}
          </Button>
        )}
        {status !== "draft" && (
          <Button
            variant="secondary"
            loading={revise.isPending}
            onClick={() => {
              setError("");
              revise.mutate(doc.id, {
                onError: (err) =>
                  setError(err instanceof Error ? err.message : t("sales.actionFailed")),
              });
            }}
            title={t("sales.quotes.reviseHint")}
          >
            <CopyPlus className="h-4 w-4" /> {t("sales.quotes.revise")}
          </Button>
        )}
        {(status === "draft" || status === "sent" || status === "declined" ||
          status === "expired") && (
          <Button variant="ghost" disabled={patching} onClick={() => run({ status: "canceled" })}>
            <Ban className="h-4 w-4" /> {t("sales.quotes.cancel")}
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <DocumentDetailShell<Quote>
        id={quoteId}
        table="quotes"
        linesTable="quote_lines"
        parentColumn="quote_id"
        routeBase="/sales/quotes"
        backLabel={t("sales.quotes.title")}
        notFoundMessage={t("sales.quotes.notFound")}
        statusMeta={quoteStatus}
        effectiveStatus={(q) => effectiveQuoteStatus(q)}
        dateColumn="valid_until"
        dateLabel={t("sales.doc.validUntil")}
        editTitle={t("sales.quotes.edit")}
        deleteTitle={t("sales.quotes.delete")}
        deleteConfirm={(q) => t("sales.quotes.deleteConfirm", { number: q.doc_number })}
        isEditable={(q) => q.status === "draft"}
        isDeletable={(q) => q.status === "draft" || q.status === "canceled"}
        detailRows={(q) => (
          <>
            <InfoRow label={t("sales.doc.issueDate")} value={formatDate(q.issue_date)} />
            <InfoRow label={t("sales.doc.validUntil")} value={formatDate(q.valid_until)} />
            {q.revision > 1 && (
              <InfoRow
                label={t("sales.doc.revisionOf")}
                value={t("sales.doc.revisionOf", { revision: q.revision })}
              />
            )}
            {q.accepted_by_name && (
              <InfoRow
                label={t("sales.quotes.acceptedBy", { name: q.accepted_by_name })}
                value={formatDate(q.accepted_at)}
              />
            )}
            {q.decline_reason && (
              <InfoRow label={t("sales.quotes.declineReason")} value={q.decline_reason} />
            )}
          </>
        )}
        actions={actions}
        panels={({ doc }) => (
          <>
            {doc.sales_order_id && (
              <SectionCard title={t("sales.orders.title")}>
                <Link
                  to={`/sales/orders/${doc.sales_order_id}`}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  {t("sales.quotes.convertedTo", { number: "" }).trim()}
                </Link>
              </SectionCard>
            )}
            <SectionCard title={t("sales.quotes.shareLink")}>
              {doc.status === "draft" ? (
                <p className="text-sm text-ink-3">{t("sales.quotes.shareLocked")}</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-ink-2">{t("sales.quotes.shareHint")}</p>
                  <code
                    dir="ltr"
                    className="block truncate rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2"
                  >
                    {publicUrl(doc)}
                  </code>
                  <Button
                    variant="secondary"
                    className="mt-3"
                    onClick={() => {
                      void navigator.clipboard.writeText(publicUrl(doc));
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? t("sales.quotes.linkCopied") : t("sales.quotes.copyLink")}
                  </Button>
                </>
              )}
            </SectionCard>
          </>
        )}
      />

      <DeclineModal
        open={declining}
        reason={declineReason}
        setReason={setDeclineReason}
        onClose={() => setDeclining(false)}
        quoteId={quoteId}
      />
    </>
  );
}

function DeclineModal({
  open,
  reason,
  setReason,
  onClose,
  quoteId,
}: {
  open: boolean;
  reason: string;
  setReason: (value: string) => void;
  onClose: () => void;
  quoteId: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState("");

  const decline = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase
        .from("quotes")
        .update({ status: "declined", decline_reason: reason.trim() || null })
        .eq("id", quoteId);
      if (err) throw wrapDbError(err);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      void qc.invalidateQueries({ queryKey: ["sales_summary"] });
      setReason("");
      onClose();
      toast.success(t("toast.saved"));
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("sales.actionFailed")),
  });

  return (
    <Modal title={t("sales.quotes.decline")} open={open} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <Field label={t("sales.quotes.declineReason")}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" loading={decline.isPending} onClick={() => decline.mutate()}>
          {t("sales.quotes.decline")}
        </Button>
      </div>
    </Modal>
  );
}

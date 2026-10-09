import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Pencil, RotateCcw, Trash2, Trophy, XCircle } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { OPEN_STAGES, isOpenStage, weighted, type Stage } from "../../../shared/crm";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { NewDocumentModal } from "../sales/NewDocumentModal";
import { RecordActivities } from "./ActivityList";
import { LostForm, OpportunityForm } from "./forms";
import { dayIn, personName, stageTone } from "./labels";
import { OPP_SELECT, type Opportunity } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

type ModalKind = "edit" | "lost" | "delete" | "quote" | null;

export default function OpportunityDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["crm_opportunities", "detail", id],
    queryFn: async () => (await listRows<Opportunity>("crm_opportunities", (b) => b.select(OPP_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const salesOn = isEnabled("sales");
  const quoteId = q.data?.quote_id ?? null;
  const quoteQ = useQuery({
    queryKey: ["quotes", "for-opportunity", quoteId],
    enabled: !!quoteId && salesOn,
    queryFn: async () =>
      (await listRows<{ id: string; doc_number: string | null; status: string; total: number; currency: string }>("quotes", (b) =>
        b.select("id, doc_number, status, total, currency").eq("id", quoteId!).limit(1)))[0] ?? null,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["crm_opportunities"] });
  const fail = (err: unknown) => setActionError(err instanceof Error ? err.message : t("common.error"));
  const move = useMutation({
    mutationFn: (to: Stage) => updateRow("crm_opportunities", id, { stage: to }),
    onSuccess: (_d, to) => { setActionError(""); refresh(); toast.success(t("crm.opp.movedTo", { stage: t(`crm.stage.${to}`) })); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("crm_opportunities", id),
    onSuccess: () => { refresh(); toast.success(t("crm.opp.deleted")); navigate("/crm/opportunities"); },
    onError: (err) => { fail(err); setModal(null); },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const o = q.data;
  if (!o) return <ErrorState message={t("crm.opp.notFound")} />;
  const close = () => setModal(null);
  const open = isOpenStage(o.stage);
  const today = dayIn(new Date().toISOString(), tenant.timezone);
  const late = open && !!o.expected_close_date && o.expected_close_date < today;
  const canQuote = isManager && salesOn && open && !!o.customer_id && !o.quote_id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/crm/opportunities" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("crm.opp.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{o.doc_number}</Ltr>
        <Badge tone={stageTone[o.stage]}>{t(`crm.stage.${o.stage}`)}</Badge>
        {isManager && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setModal("edit")}>
              <Pencil className="h-4 w-4" /> {t("action.edit")}
            </Button>
            {o.stage !== "won" && (
              <Button variant="ghost" onClick={() => setModal("delete")} aria-label={t("action.delete")} title={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <div className="w-44">
              <Select value="" onChange={(e) => e.target.value && move.mutate(e.target.value as Stage)}
                aria-label={open ? t("crm.opp.moveStage") : t("crm.opp.reopen")} disabled={move.isPending}>
                <option value="">{open ? t("crm.opp.moveStage") : t("crm.opp.reopen")}</option>
                {OPEN_STAGES.filter((s) => s !== o.stage).map((s) => <option key={s} value={s}>{t(`crm.stage.${s}`)}</option>)}
              </Select>
            </div>
            {open && (
              <>
                <Button variant="secondary" onClick={() => setModal("lost")}>
                  <XCircle className="h-4 w-4" /> {t("crm.opp.markLost")}
                </Button>
                <Button loading={move.isPending && move.variables === "won"} onClick={() => move.mutate("won")}>
                  <Trophy className="h-4 w-4" /> {t("crm.opp.markWon")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      {o.stage === "won" && (
        <div className="rounded-2xl bg-good-soft p-4 text-sm font-medium text-good">
          {t("crm.opp.wonOn", { date: ltrText(formatDateTime(o.won_at, tenant.timezone)) })}
        </div>
      )}
      {o.stage === "lost" && (
        <div className="rounded-2xl bg-serious-soft p-4 text-sm">
          <div className="font-medium text-serious">{t("crm.opp.lostOn", { date: ltrText(formatDateTime(o.lost_at, tenant.timezone)) })}</div>
          {o.lost_reason && <p className="mt-1 whitespace-pre-line text-ink-2"><Bdi>{o.lost_reason}</Bdi></p>}
          {isManager && (
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-3"><RotateCcw className="h-3.5 w-3.5" /> {t("crm.opp.reopenHint")}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <h1 className="text-base font-semibold text-ink"><Bdi>{o.title}</Bdi></h1>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-canvas p-3">
                <div className="text-xs text-ink-3">{t("crm.f.amount")}</div>
                <Ltr className="text-lg font-semibold text-ink">{formatMoney(Number(o.amount), o.currency)}</Ltr>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <div className="text-xs text-ink-3">{t("crm.col.weighted")}</div>
                <Ltr className="text-lg font-semibold text-ink">{formatMoney(weighted(o), o.currency)}</Ltr>
                <Ltr className="ms-1 text-xs text-ink-3">{`${o.probability}%`}</Ltr>
              </div>
            </div>
            <dl className="mt-3">
              <Row label={t("crm.f.customer")}>
                {o.customer ? <Link to={`/customers/${o.customer_id}`} className="text-brand-700 hover:underline"><Bdi>{o.customer.name}</Bdi></Link>
                  : <span className="text-ink-3">—</span>}
              </Row>
              {o.lead && (
                <Row label={t("crm.d.fromLead")}>
                  <Link to={`/crm/leads/${o.lead_id}`} className="text-brand-700 hover:underline">
                    <Ltr>{o.lead.doc_number}</Ltr> · <Bdi>{o.lead.name}</Bdi>
                  </Link>
                </Row>
              )}
              <Row label={t("crm.f.closeDate")}>
                {o.expected_close_date
                  ? <span className={late ? "font-medium text-serious" : undefined}>{formatDate(o.expected_close_date)}{late ? ` · ${t("crm.d.pastDue")}` : ""}</span>
                  : <span className="text-ink-3">—</span>}
              </Row>
              <Row label={t("crm.f.owner")}>{o.owner ? <Bdi>{personName(o.owner)}</Bdi> : <span className="text-ink-3">—</span>}</Row>
              <Row label={t("crm.col.created")}>{formatDateTime(o.created_at, tenant.timezone)}</Row>
              {o.notes && <Row label={t("crm.f.notes")}><Bdi className="whitespace-pre-line">{o.notes}</Bdi></Row>}
            </dl>
          </Card>

          {salesOn && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("crm.d.quote")}</h2>
              {quoteId ? (
                quoteQ.data ? (
                  <Link to={`/sales/quotes/${quoteId}`} className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3 hover:bg-line/40">
                    <span className="flex items-center gap-2 text-sm text-brand-700"><FileText className="h-4 w-4" /><Ltr>{quoteQ.data.doc_number}</Ltr></span>
                    <span className="text-end text-xs text-ink-3">
                      <Ltr className="block text-sm font-medium text-ink">{formatMoney(Number(quoteQ.data.total), quoteQ.data.currency)}</Ltr>
                      {t(`enum.quoteStatus.${quoteQ.data.status}` as MessageKey)}
                    </span>
                  </Link>
                ) : <LoadingState />
              ) : (
                <div className="text-sm text-ink-3">
                  <p>{o.customer_id ? t("crm.d.noQuote") : t("crm.d.quoteNeedsCustomer")}</p>
                  {canQuote && (
                    <Button variant="secondary" className="mt-2 px-2.5 py-1.5" onClick={() => setModal("quote")}>
                      <FileText className="h-4 w-4" /> {t("crm.d.createQuote")}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
        <div className="lg:col-span-3">
          <RecordActivities links={{ opportunity_id: o.id, customer_id: o.customer_id, lead_id: o.lead_id }} />
        </div>
      </div>

      <Modal title={t("crm.opp.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && (
          <OpportunityForm opportunity={o} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("crm.opp.saved")); }} />
        )}
      </Modal>
      <Modal title={t("crm.opp.lostTitle")} open={modal === "lost"} onClose={close}>
        {modal === "lost" && (
          <LostForm opportunity={o} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("crm.opp.movedTo", { stage: t("crm.stage.lost") })); }} />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("crm.opp.deleteConfirm", { number: o.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
      {canQuote && (
        <NewDocumentModal
          open={modal === "quote"}
          onClose={close}
          table="quotes"
          routeBase="/sales/quotes"
          title={t("crm.d.createQuote")}
          dateColumn="valid_until"
          dateLabel={t("sales.doc.validUntil")}
          defaultDays="quote_valid_days"
          prefill={{ customer_id: o.customer_id ?? "", title: o.title }}
          onCreated={async (quote) => {
            await updateRow("crm_opportunities", o.id, { quote_id: quote, ...(o.stage === "prospecting" || o.stage === "qualification" ? { stage: "proposal" } : {}) });
            refresh();
          }}
        />
      )}
    </div>
  );
}

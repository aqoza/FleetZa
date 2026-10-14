import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Pencil, Send, Trash2, Undo2, XCircle } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { CLAIM_TRANSITIONS, claimShortfall, type ClaimStatus } from "../../../shared/insurance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ClaimForm, ClaimStepForm, type ClaimStep } from "./forms";
import { claimInsurer, claimTone } from "./labels";
import { CLAIM_SELECT, type Claim } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

const CLOSED: readonly ClaimStatus[] = ["settled", "rejected", "withdrawn"];

type ModalKind = "edit" | "delete" | ClaimStep | null;

export default function ClaimDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["insurance_claims", "detail", id],
    queryFn: async () => (await listRows<Claim>("insurance_claims", (b) => b.select(CLAIM_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["insurance_claims"] });
  const step = useMutation({
    mutationFn: (to: ClaimStatus) => updateRow("insurance_claims", id, { status: to }),
    onSuccess: (_d, to) => {
      setActionError("");
      refresh();
      toast.success(t("insurance.c.statusSaved", { status: t(`insurance.claim.${to}`) }));
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("insurance_claims", id),
    onSuccess: () => {
      refresh();
      toast.success(t("insurance.c.deleted"));
      navigate("/insurance/claims");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const c = q.data;
  if (!c) return <ErrorState message={t("insurance.c.notFound")} />;

  const close = () => setModal(null);
  const can = (to: ClaimStatus) => CLAIM_TRANSITIONS[c.status].includes(to);
  const money = (n: number | null) => (n == null ? <span className="text-ink-3">—</span> : <Ltr>{formatMoney(n, c.currency)}</Ltr>);
  const shortfall = claimShortfall(c);
  const timeline = [
    { label: t("insurance.c.t.created"), at: c.created_at },
    { label: t("insurance.claim.submitted"), at: c.submitted_at },
    { label: c.status === "rejected" ? t("insurance.claim.rejected") : t("insurance.claim.approved"), at: c.decided_at },
    { label: t("insurance.claim.withdrawn"), at: c.withdrawn_at },
  ].filter((e): e is { label: string; at: string } => !!e.at);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/insurance/claims" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("insurance.c.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{c.doc_number}</Ltr>
        <Badge tone={claimTone[c.status]}>{t(`insurance.claim.${c.status}`)}</Badge>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {!CLOSED.includes(c.status) && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {c.status === "draft" && (
              <Button variant="ghost" onClick={() => setModal("delete")} aria-label={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {can("withdrawn") && (
              <Button variant="ghost" loading={step.isPending && step.variables === "withdrawn"} onClick={() => step.mutate("withdrawn")}>
                <Undo2 className="h-4 w-4 rtl:-scale-x-100" /> {t("insurance.c.withdraw")}
              </Button>
            )}
            {can("submitted") && (
              <Button loading={step.isPending && step.variables === "submitted"} onClick={() => step.mutate("submitted")}>
                <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("insurance.c.submit")}
              </Button>
            )}
            {can("under_review") && (
              <Button loading={step.isPending && step.variables === "under_review"} onClick={() => step.mutate("under_review")}>
                {t("insurance.c.markReview")}
              </Button>
            )}
            {can("rejected") && (
              <Button variant="secondary" onClick={() => setModal("rejected")}>
                <XCircle className="h-4 w-4" /> {t("insurance.c.reject")}
              </Button>
            )}
            {can("approved") && (
              <Button onClick={() => setModal("approved")}>
                <CheckCircle2 className="h-4 w-4" /> {t("insurance.c.approve")}
              </Button>
            )}
            {can("settled") && <Button onClick={() => setModal("settled")}>{t("insurance.c.settle")}</Button>}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="p-4">
            <p className="mb-3 whitespace-pre-line text-sm text-ink"><Bdi>{c.description}</Bdi></p>
            <dl>
              <Row label={t("insurance.c.policy")}>
                <Link to={`/insurance/policies/${c.policy_id}`} className="text-brand-700 hover:underline">
                  <Ltr>{c.policy?.policy_number}</Ltr>
                </Link>
                <div className="text-xs text-ink-3"><Bdi>{claimInsurer(c)}</Bdi></div>
              </Row>
              {c.vehicle && (
                <Row label={t("insurance.c.vehicle")}>
                  <Link to={`/vehicles/${c.vehicle_id}`} className="hover:underline"><Bdi>{c.vehicle.name}</Bdi></Link>
                  {c.vehicle.license_plate && <div className="text-xs text-ink-3"><Ltr>{c.vehicle.license_plate}</Ltr></div>}
                </Row>
              )}
              <Row label={t("insurance.c.lossDate")}>{formatDate(c.loss_date)}</Row>
              <Row label={t("insurance.c.claimDate")}>{formatDate(c.claim_date)}</Row>
              {c.insurer_reference && <Row label={t("insurance.c.insurerRef")}><Ltr>{c.insurer_reference}</Ltr></Row>}
              {c.adjuster_name && (
                <Row label={t("insurance.c.adjuster")}>
                  <Bdi>{c.adjuster_name}</Bdi>
                  {c.adjuster_phone && (
                    <div><a href={`tel:${c.adjuster_phone}`} className="text-xs text-brand-700 hover:underline"><Ltr>{c.adjuster_phone}</Ltr></a></div>
                  )}
                </Row>
              )}
              {c.rejection_reason && <Row label={t("insurance.c.rejectionReason")}><Bdi>{c.rejection_reason}</Bdi></Row>}
              {c.notes && <Row label={t("insurance.c.notes")}><Bdi className="whitespace-pre-line">{c.notes}</Bdi></Row>}
            </dl>
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("insurance.c.timeline")}</h2>
            <ol className="space-y-2">
              {timeline.map((e) => (
                <li key={e.label} className="flex items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-chart-1" />
                  <span className="text-sm text-ink">{e.label}</span>
                  <span className="text-xs text-ink-3">{formatDateTime(e.at, tenant.timezone)}</span>
                </li>
              ))}
              {c.settled_at && (
                <li className="flex items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-chart-2" />
                  <span className="text-sm text-ink">{t("insurance.claim.settled")}</span>
                  <span className="text-xs text-ink-3">{formatDate(c.settled_at)}</span>
                </li>
              )}
            </ol>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("insurance.c.amounts")}</h2>
            <dl>
              <Row label={t("insurance.c.claimed")}>{money(c.amount_claimed)}</Row>
              <Row label={t("insurance.c.approved")}>{money(c.amount_approved)}</Row>
              <Row label={t("insurance.c.paid")}>{money(c.amount_paid)}</Row>
              <Row label={t("insurance.c.deductible")}>{money(c.deductible_applied)}</Row>
            </dl>
            {shortfall != null && shortfall > 0 && (
              <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2">
                <div className="flex items-baseline justify-between gap-3 text-sm text-warn">
                  <span>{t("insurance.c.shortfall")}</span>
                  <span className="font-semibold">{money(shortfall)}</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal title={t("insurance.c.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && <ClaimForm claim={c} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("insurance.c.saved")); }} />}
      </Modal>
      {(["approved", "rejected", "settled"] as const).map((s) => (
        <Modal key={s} title={t(`insurance.c.stepTitle.${s}`, { number: c.doc_number ?? "" })} open={modal === s} onClose={close}>
          {modal === s && (
            <ClaimStepForm claim={c} step={s} onCancel={close}
              onDone={() => { close(); refresh(); toast.success(t("insurance.c.statusSaved", { status: t(`insurance.claim.${s}`) })); }} />
          )}
        </Modal>
      ))}
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("insurance.c.deleteConfirm", { number: c.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

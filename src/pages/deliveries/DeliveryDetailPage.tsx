import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Copy, MapPin, Pencil, Phone, RotateCcw, Trash2, Undo2, XCircle } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Input, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DeliveryForm, OutcomeForm } from "./forms";
import { deliveryTone, mapUrl, trackingUrl } from "./labels";
import { DELIVERY_SELECT, type DeliveryWithPod } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function DeliveryDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<"edit" | "delivered" | "failed" | "delete" | null>(null);
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["deliveries", "detail", id],
    queryFn: async () =>
      (await listRows<DeliveryWithPod>("deliveries", (b) => b.select(`${DELIVERY_SELECT}, pod_signature`).eq("id", id).limit(1)))[0] ?? null,
  });
  const update = useMutation({
    mutationFn: (v: { values: Record<string, unknown>; done: string }) => updateRow("deliveries", id, v.values),
    onSuccess: (_d, v) => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      void qc.invalidateQueries({ queryKey: ["delivery_routes"] });
      toast.success(v.done);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("deliveries", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      toast.success(t("deliveries.deleted"));
      navigate("/deliveries/list");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const d = q.data;
  if (!d) return <ErrorState message={t("deliveries.notFound")} />;

  const editable = d.status !== "delivered" && d.status !== "returned";
  const link = trackingUrl(d.tracking_token);
  const short = d.status === "delivered" ? d.cod_amount - (d.cod_collected ?? 0) : 0;
  const done = () => {
    setModal(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/deliveries/list" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("deliveries.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{d.doc_number}</Ltr>
        <Badge tone={deliveryTone[d.status]}>{t(`deliveries.status.${d.status}`)}</Badge>
        <Bdi className="min-w-0 truncate text-ink-2">{d.recipient_name}</Bdi>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {editable && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {d.status === "pending" && (
              <Button variant="ghost" onClick={() => setModal("delete")}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
            )}
            {d.status === "failed" && (
              <>
                <Button variant="secondary" loading={update.isPending}
                  onClick={() => update.mutate({ values: { status: "returned" }, done: t("deliveries.returned") })}>
                  <Undo2 className="h-4 w-4 rtl:-scale-x-100" /> {t("deliveries.return")}
                </Button>
                <Button variant="secondary" loading={update.isPending}
                  onClick={() => update.mutate({ values: { status: "pending" }, done: t("deliveries.requeued") })}>
                  {t("deliveries.requeue")}
                </Button>
                {d.route?.status === "out_for_delivery" && (
                  <Button loading={update.isPending}
                    onClick={() => update.mutate({ values: { status: "out_for_delivery" }, done: t("deliveries.retried") })}>
                    <RotateCcw className="h-4 w-4" /> {t("deliveries.retry")}
                  </Button>
                )}
              </>
            )}
            {d.status === "out_for_delivery" && (
              <>
                <Button variant="secondary" onClick={() => setModal("failed")}>
                  <XCircle className="h-4 w-4" /> {t("deliveries.markFailed")}
                </Button>
                <Button onClick={() => setModal("delivered")}>
                  <CheckCircle2 className="h-4 w-4" /> {t("deliveries.markDelivered")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-3">
          <dl>
            <Row label={t("deliveries.s.recipient")}>
              <Bdi>{d.recipient_name}</Bdi>
              {d.recipient_phone && (
                <a href={`tel:${d.recipient_phone}`} dir="ltr" className="flex items-center justify-end gap-1 text-brand-700 hover:underline">
                  <Phone className="h-3.5 w-3.5" /> {d.recipient_phone}
                </a>
              )}
            </Row>
            <Row label={t("deliveries.s.address")}>
              <div><Bdi>{d.address}</Bdi></div>
              {d.city && <div className="text-xs text-ink-3"><Bdi>{d.city}</Bdi></div>}
              <a href={mapUrl(d)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                <MapPin className="h-3.5 w-3.5" /> {t("deliveries.openMap")}
              </a>
            </Row>
            <Row label={t("deliveries.s.route")}>
              {d.route_id && d.route ? (
                <Link to={`/deliveries/routes/${d.route_id}`} className="text-brand-700 hover:underline">
                  <Ltr>{d.route.doc_number}</Ltr>
                  {d.sequence != null && <span className="text-ink-3"> · #{d.sequence}</span>}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label={t("deliveries.s.parcels")}>
              {tp("deliveries.parcelsCount", d.parcels)}
              {d.weight_kg != null && <span className="text-ink-3"> · <Ltr>{`${d.weight_kg} kg`}</Ltr></span>}
            </Row>
            <Row label={t("deliveries.s.cod")}>{d.cod_amount > 0 ? formatMoney(d.cod_amount, tenant.currency) : "—"}</Row>
            {d.customer && (
              <Row label={t("deliveries.s.customer")}>
                <Link to={`/customers/${d.customer_id}`} className="text-brand-700 hover:underline"><Bdi>{d.customer.name}</Bdi></Link>
              </Row>
            )}
            {d.reference && <Row label={t("deliveries.s.reference")}><Bdi>{d.reference}</Bdi></Row>}
            <Row label={t("deliveries.s.attempts")}>{tp("deliveries.attemptsCount", d.attempts)}</Row>
          </dl>
          {d.instructions && (
            <div className="mt-3 text-sm">
              <div className="text-ink-3">{t("deliveries.s.instructions")}</div>
              <Bdi className="block whitespace-pre-line text-ink-2">{d.instructions}</Bdi>
            </div>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {d.status === "delivered" && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("deliveries.pod")}</h2>
              <p className="text-sm text-ink"><Bdi>{d.pod_name}</Bdi></p>
              <p className="text-xs text-ink-3">{t("deliveries.podAt", { time: formatDateTime(d.delivered_at, tenant.timezone) })}</p>
              {d.cod_amount > 0 && (
                <p className="mt-1 text-sm text-ink-2">
                  {t("deliveries.podCod", { amount: ltrText(formatMoney(d.cod_collected ?? 0, tenant.currency)) })}
                  {short > 0.0005 && <span className="ms-2 font-medium text-serious">{t("deliveries.podShort", { amount: ltrText(formatMoney(short, tenant.currency)) })}</span>}
                </p>
              )}
              {d.pod_signature && (
                <img src={d.pod_signature} alt={t("deliveries.signature")} className="mt-3 h-28 w-full rounded-lg border border-line bg-white object-contain" />
              )}
            </Card>
          )}
          {d.status === "failed" && d.failure_reason && (
            <div className="rounded-2xl border border-serious/30 bg-serious-soft p-4">
              <p className="text-sm font-medium text-serious">{t(`deliveries.reason.${d.failure_reason}`)}</p>
              <p className="text-xs text-serious">{t("deliveries.lastFailure", { time: formatDateTime(d.failed_at, tenant.timezone) })}</p>
              {d.failure_note && <Bdi className="mt-1 block text-sm text-ink-2">{d.failure_note}</Bdi>}
            </div>
          )}
          {d.status === "returned" && (
            <div className="rounded-2xl border border-warn/30 bg-warn-soft p-4">
              <p className="text-sm font-medium text-warn">{t("deliveries.returnedAt", { time: formatDateTime(d.returned_at, tenant.timezone) })}</p>
            </div>
          )}
          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">{t("deliveries.tracking")}</h2>
            <p className="mb-2 text-xs text-ink-3">{t("deliveries.trackingHint")}</p>
            <div className="flex gap-2">
              <Input dir="ltr" readOnly value={link} className="min-w-0 flex-1 text-xs" onFocus={(e) => e.target.select()} />
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => toast.success(t("deliveries.copied")));
                }}
              >
                <Copy className="h-4 w-4" /> {t("deliveries.copyLink")}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Modal title={t("deliveries.editTitle")} open={modal === "edit"} onClose={done} wide>
        {modal === "edit" && (
          <DeliveryForm
            delivery={d}
            onCancel={done}
            onDone={() => {
              done();
              void qc.invalidateQueries({ queryKey: ["deliveries"] });
              toast.success(t("deliveries.saved"));
            }}
          />
        )}
      </Modal>
      <Modal title={t("deliveries.deliveredTitle", { number: d.doc_number ?? "" })} open={modal === "delivered"} onClose={done}>
        {modal === "delivered" && <OutcomeForm delivery={d} outcome="delivered" onDone={done} onCancel={done} />}
      </Modal>
      <Modal title={t("deliveries.failedTitle", { number: d.doc_number ?? "" })} open={modal === "failed"} onClose={done}>
        {modal === "failed" && <OutcomeForm delivery={d} outcome="failed" onDone={done} onCancel={done} />}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={done}>
        <p className="text-sm text-ink-2">{t("deliveries.deleteConfirm", { number: d.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={done}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

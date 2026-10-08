/**
 * Mobile-first run sheet for the person on the road: one card per stop, in
 * order, with call / map links and big Delivered / Failed buttons.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, MapPin, Phone, XCircle } from "lucide-react";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { OutcomeForm } from "./forms";
import { useRoute, useRouteStops } from "./hooks";
import { deliveryTone, driverName, mapUrl } from "./labels";
import type { Delivery } from "./types";

export default function RunSheetPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const routeQ = useRoute(id);
  const stopsQ = useRouteStops(id);
  const [outcome, setOutcome] = useState<{ d: Delivery; kind: "delivered" | "failed" } | null>(null);

  if (routeQ.isLoading || stopsQ.isLoading) return <LoadingState />;
  const err = routeQ.error ?? stopsQ.error;
  if (err) return <ErrorState message={(err as Error).message} />;
  const route = routeQ.data;
  if (!route) return <ErrorState message={t("deliveries.routes.notFound")} />;
  const stops = stopsQ.data ?? [];
  const done = stops.filter((d) => d.status !== "assigned" && d.status !== "out_for_delivery").length;
  const codLeft = stops.filter((d) => d.status === "out_for_delivery").reduce((s, d) => s + Number(d.cod_amount), 0);

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <Link to={`/deliveries/routes/${id}`} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> <Ltr>{route.doc_number}</Ltr>
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink">{t("deliveries.run.title", { number: route.doc_number ?? "" })}</h1>
        <p className="text-sm text-ink-2">
          {formatDate(`${route.route_date}T12:00:00Z`, "UTC")} · <Bdi>{route.vehicle?.name}</Bdi>
          {route.driver && <> · <Bdi>{driverName(route.driver)}</Bdi></>}
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas" dir="ltr">
          <div className="h-full rounded-full bg-good" style={{ width: `${stops.length ? (done / stops.length) * 100 : 0}%` }} />
        </div>
        <p className="mt-1 text-xs text-ink-3">{t("deliveries.run.progress", { done, total: stops.length })}</p>
        {codLeft > 0 && <p className="text-xs font-medium text-ink-2">{t("deliveries.run.codTotal", { amount: ltrText(formatMoney(codLeft, tenant.currency)) })}</p>}
      </div>
      {route.status === "planned" && <p className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm text-warn">{t("deliveries.run.notStarted")}</p>}
      {(route.status === "completed" || route.status === "canceled") && (
        <p className="rounded-lg border border-line bg-canvas p-3 text-sm text-ink-2">{t("deliveries.run.finished")}</p>
      )}

      <ol className="space-y-3">
        {stops.map((d, i) => {
          const open = d.status === "out_for_delivery";
          return (
            <li key={d.id} className={`rounded-2xl border bg-surface p-4 shadow-card ${open ? "border-line" : "border-line opacity-80"}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-ink">
                  <Ltr>{i + 1}</Ltr>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bdi className="font-semibold text-ink">{d.recipient_name}</Bdi>
                    <Badge tone={deliveryTone[d.status]}>{t(`deliveries.status.${d.status}`)}</Badge>
                  </div>
                  <div className="text-sm text-ink-2"><Bdi>{[d.address, d.city].filter(Boolean).join(", ")}</Bdi></div>
                  <div className="mt-1 text-xs text-ink-3">
                    <Ltr>{d.doc_number}</Ltr> · {tp("deliveries.parcelsCount", d.parcels)}
                    {d.cod_amount > 0 && <span className="font-medium text-ink"> · {t("deliveries.col.cod")} <Ltr>{formatMoney(d.cod_amount, tenant.currency)}</Ltr></span>}
                  </div>
                  {d.instructions && <div className="mt-1 text-sm text-ink-2"><Bdi>{d.instructions}</Bdi></div>}
                  {d.status === "delivered" && d.pod_name && (
                    <p className="mt-1 text-xs text-good">
                      <Bdi>{d.pod_name}</Bdi> · {formatDateTime(d.delivered_at, tenant.timezone)}
                    </p>
                  )}
                  {d.status === "failed" && d.failure_reason && (
                    <p className="mt-1 text-xs text-serious">{t(`deliveries.reason.${d.failure_reason}`)}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {d.recipient_phone && (
                  <a href={`tel:${d.recipient_phone}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm text-ink">
                    <Phone className="h-4 w-4" /> {t("deliveries.call")}
                  </a>
                )}
                <a href={mapUrl(d)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm text-ink">
                  <MapPin className="h-4 w-4" /> {t("deliveries.openMap")}
                </a>
                {isManager && open && (
                  <div className="ms-auto flex gap-2">
                    <Button variant="secondary" onClick={() => setOutcome({ d, kind: "failed" })}>
                      <XCircle className="h-4 w-4" /> {t("deliveries.markFailed")}
                    </Button>
                    <Button onClick={() => setOutcome({ d, kind: "delivered" })}>
                      <CheckCircle2 className="h-4 w-4" /> {t("deliveries.markDelivered")}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <Modal
        title={outcome ? t(outcome.kind === "delivered" ? "deliveries.deliveredTitle" : "deliveries.failedTitle", { number: outcome.d.doc_number ?? "" }) : ""}
        open={!!outcome}
        onClose={() => setOutcome(null)}
      >
        {outcome && <OutcomeForm delivery={outcome.d} outcome={outcome.kind} onDone={() => setOutcome(null)} onCancel={() => setOutcome(null)} />}
      </Modal>
    </div>
  );
}

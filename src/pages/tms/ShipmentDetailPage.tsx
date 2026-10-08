import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, MapPin, Pencil, Trash2, Truck, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { canTransition, isLocked, type ShipmentStatus } from "../../../shared/tms";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ShipmentForm, StepForm, TrackingForm } from "./forms";
import { driverName, isLate, shipmentTone } from "./labels";
import { Lane } from "./ShipmentsPage";
import { SHIPMENT_SELECT, type Shipment, type ShipmentEvent } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

function Place({ name, address, city, country }: { name: string | null; address: string | null; city: string; country: string | null }) {
  const t = useT();
  return (
    <div>
      {name && <div className="font-medium"><Bdi>{name}</Bdi></div>}
      <div className="text-ink-2"><Bdi>{[address, city, country].filter(Boolean).join(t("tms.s.listSep"))}</Bdi></div>
    </div>
  );
}

type ModalKind = "edit" | "delete" | "delivered" | "exception" | "canceled" | null;

export default function ShipmentDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["shipments", "detail", id],
    queryFn: async () => (await listRows<Shipment>("shipments", (b) => b.select(SHIPMENT_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const evQ = useQuery({
    queryKey: ["shipment_events", id],
    queryFn: () =>
      listRows<ShipmentEvent>("shipment_events", (b) =>
        b.select("id, shipment_id, status, at, location, note, created_at").eq("shipment_id", id)
          .order("at", { ascending: false }).order("created_at", { ascending: false }).limit(200)),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["shipments"] });
    void qc.invalidateQueries({ queryKey: ["shipment_events", id] });
  };
  const step = useMutation({
    mutationFn: (to: ShipmentStatus) => updateRow("shipments", id, { status: to }),
    onSuccess: (_d, to) => {
      setActionError("");
      refresh();
      toast.success(t("tms.statusSaved", { status: t(`tms.status.${to}`) }));
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("common.error")),
  });
  const invoice = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("shipment_create_invoice", { p_shipment_id: id });
      if (error) throw wrapDbError(error);
      return data as string;
    },
    onSuccess: (invoiceId) => {
      setActionError("");
      refresh();
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(t("tms.invoiceCreated"));
      navigate(`/sales/invoices/${invoiceId}`);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("shipments", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      toast.success(t("tms.deleted"));
      navigate("/tms/shipments");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const s = q.data;
  if (!s) return <ErrorState message={t("tms.notFound")} />;

  const close = () => setModal(null);
  const late = isLate(s);
  const money = (n: number) => <Ltr>{formatMoney(n, s.currency)}</Ltr>;
  const can = (to: ShipmentStatus) => canTransition(s.status, to);
  const invoiceLive = s.invoice != null && s.invoice.status !== "void";
  const canInvoice = isManager && isEnabled("billing") && (s.status === "delivered" || s.status === "closed")
    && !invoiceLive && s.total_charge > 0;
  const windowText = (from: string | null, to: string | null) => {
    if (from && to) return t("tms.s.windowRange", { from: ltrText(formatDateTime(from, tz)), to: ltrText(formatDateTime(to, tz)) });
    if (from) return t("tms.s.windowFrom", { from: ltrText(formatDateTime(from, tz)) });
    if (to) return t("tms.s.windowTo", { to: ltrText(formatDateTime(to, tz)) });
    return null;
  };
  const pickupWindow = windowText(s.pickup_window_start, s.pickup_window_end);
  const deliveryWindow = windowText(s.delivery_window_start, s.delivery_window_end);
  const cargoBits = [
    s.pieces != null ? tp("tms.piecesCount", s.pieces) : null,
    s.weight_kg != null ? t("tms.s.weightKg", { weight: ltrText(Number(s.weight_kg).toLocaleString()) }) : null,
    s.volume_m3 != null ? t("tms.s.volumeM3", { volume: ltrText(Number(s.volume_m3).toLocaleString()) }) : null,
  ].filter(Boolean).join(" · ");
  const marginPct = s.margin != null && s.total_charge > 0 ? Math.round((s.margin / s.total_charge) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/tms/shipments" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("tms.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{s.doc_number}</Ltr>
        <Badge tone={shipmentTone[s.status]}>{t(`tms.status.${s.status}`)}</Badge>
        {late != null && <Badge tone={late ? "red" : "green"}>{late ? t("tms.late") : t("tms.onTime")}</Badge>}
        <span className="min-w-0 text-ink-2"><Lane s={s} /></span>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {!isLocked(s.status) && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {s.status === "draft" && (
              <Button variant="ghost" onClick={() => setModal("delete")}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
            )}
            {can("canceled") && (
              <Button variant="ghost" onClick={() => setModal("canceled")}>
                <XCircle className="h-4 w-4" /> {t("tms.cancel")}
              </Button>
            )}
            {can("exception") && (
              <Button variant="secondary" onClick={() => setModal("exception")}>
                <AlertTriangle className="h-4 w-4" /> {t("tms.reportException")}
              </Button>
            )}
            {can("booked") && <Button loading={step.isPending} onClick={() => step.mutate("booked")}>{t("tms.book")}</Button>}
            {can("dispatched") && (
              <Button loading={step.isPending} onClick={() => step.mutate("dispatched")}>
                <Truck className="h-4 w-4 rtl:-scale-x-100" /> {t("tms.dispatch")}
              </Button>
            )}
            {can("in_transit") && (
              <Button variant={s.status === "exception" ? "secondary" : "primary"} loading={step.isPending} onClick={() => step.mutate("in_transit")}>
                {s.status === "exception" ? t("tms.resume") : t("tms.pickUp")}
              </Button>
            )}
            {can("delivered") && (
              <Button onClick={() => setModal("delivered")}>
                <CheckCircle2 className="h-4 w-4" /> {t("tms.markDelivered")}
              </Button>
            )}
            {canInvoice && (
              <Button variant="secondary" loading={invoice.isPending} onClick={() => invoice.mutate()} title={t("tms.invoiceHint")}>
                <FileText className="h-4 w-4" /> {t("tms.createInvoice")}
              </Button>
            )}
            {can("closed") && (
              <Button variant={canInvoice ? "secondary" : "primary"} loading={step.isPending} onClick={() => step.mutate("closed")}>
                {t("tms.close")}
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="p-4">
            <dl>
              <Row label={t("tms.s.customer")}><Bdi>{s.customer?.name}</Bdi></Row>
              <Row label={t("tms.s.mode")}>{t(`tms.mode.${s.mode}`)} · {t(`tms.service.${s.service_level}`)}</Row>
              <Row label={t("tms.s.pickup")}>
                <Place name={s.origin_name} address={s.origin_address} city={s.origin_city} country={s.origin_country} />
                {pickupWindow && <div className="text-xs text-ink-3">{pickupWindow}</div>}
              </Row>
              <Row label={t("tms.s.delivery")}>
                <Place name={s.destination_name} address={s.destination_address} city={s.destination_city} country={s.destination_country} />
                {deliveryWindow && <div className="text-xs text-ink-3">{deliveryWindow}</div>}
              </Row>
              {(s.cargo_description || cargoBits || s.hazardous) && (
                <Row label={t("tms.s.cargo")}>
                  {s.cargo_description && <div><Bdi>{s.cargo_description}</Bdi></div>}
                  {cargoBits && <div className="text-xs text-ink-3">{cargoBits}</div>}
                  {s.hazardous && <Badge tone="red">{t("tms.s.hazardous")}</Badge>}
                </Row>
              )}
              <Row label={t("tms.s.carrier")}>
                {s.carrier_type === "own" ? (
                  <>
                    <div>{t("tms.carrier.own")}</div>
                    {s.vehicle && <div className="text-ink-2"><Bdi>{s.vehicle.name}{s.vehicle.license_plate ? ` · ${s.vehicle.license_plate}` : ""}</Bdi></div>}
                    {s.driver && <div className="text-ink-2"><Bdi>{driverName(s.driver)}</Bdi></div>}
                  </>
                ) : (
                  <>
                    <div>{t("tms.carrier.third_party")}</div>
                    {s.carrier && <div className="text-ink-2"><Bdi>{s.carrier.name}</Bdi></div>}
                  </>
                )}
              </Row>
              {s.customer_ref && <Row label={t("tms.s.customerRef")}><Bdi>{s.customer_ref}</Bdi></Row>}
              {s.bol_number && <Row label={t("tms.s.bol")}><Ltr>{s.bol_number}</Ltr></Row>}
              {s.received_by && (
                <Row label={t("tms.s.received")}>
                  <div><Bdi>{s.received_by}</Bdi></div>
                  <div className="text-xs text-ink-3">{formatDateTime(s.delivered_at, tz)}</div>
                  {s.pod_notes && <div className="mt-1 text-ink-2"><Bdi>{s.pod_notes}</Bdi></div>}
                </Row>
              )}
              {s.cancel_reason && <Row label={t("tms.s.cancelReason")}><Bdi>{s.cancel_reason}</Bdi></Row>}
              {s.notes && <Row label={t("tms.s.notes")}><Bdi className="whitespace-pre-line">{s.notes}</Bdi></Row>}
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("tms.timeline")}</h2>
            {evQ.isLoading ? (
              <LoadingState />
            ) : (evQ.data ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">{t("tms.timelineEmpty")}</p>
            ) : (
              <ol className="space-y-3">
                {(evQ.data ?? []).map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.status ? "bg-chart-1" : "bg-chart-2"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {e.status ? (
                          <Badge tone={shipmentTone[e.status]}>{t(`tms.status.${e.status}`)}</Badge>
                        ) : e.location ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
                            <MapPin className="h-3.5 w-3.5 text-ink-3" /> <Bdi>{e.location}</Bdi>
                          </span>
                        ) : null}
                        <span className="text-xs text-ink-3">{formatDateTime(e.at, tz)}</span>
                      </div>
                      {e.note && <div className="mt-0.5 text-sm text-ink-2"><Bdi>{e.note}</Bdi></div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {isManager && !isLocked(s.status) && s.status !== "draft" && (
              <div className="mt-3"><TrackingForm shipmentId={s.id} /></div>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("tms.charges")}</h2>
            <dl>
              <Row label={t("tms.ch.freight")}>{money(s.freight_charge)}</Row>
              {s.fuel_surcharge > 0 && <Row label={t("tms.ch.fuel")}>{money(s.fuel_surcharge)}</Row>}
              {s.other_charges > 0 && <Row label={t("tms.ch.other")}>{money(s.other_charges)}</Row>}
              <Row label={t("tms.ch.total")}><span className="font-semibold">{money(s.total_charge)}</span></Row>
              {s.carrier_cost != null && <Row label={t("tms.ch.carrierCost")}>{money(s.carrier_cost)}</Row>}
            </dl>
            {s.margin != null ? (
              <div className={`mt-3 rounded-xl px-3 py-2 ${s.margin < 0 ? "bg-serious-soft" : "bg-good-soft"}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-sm ${s.margin < 0 ? "text-serious" : "text-good"}`}>{t("tms.ch.margin")}</span>
                  <span className={`inline-flex items-baseline gap-2 text-base font-semibold ${s.margin < 0 ? "text-serious" : "text-good"}`}>
                    {money(s.margin)}
                    {marginPct != null && <Ltr className="text-xs font-normal">{`${marginPct}%`}</Ltr>}
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-3">{t("tms.ch.noCost")}</p>
            )}
          </Card>
          {s.invoice && s.invoice_id && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("tms.invoice")}</h2>
              <div className="flex items-center justify-between gap-3">
                <Ltr className="text-sm text-ink">{s.invoice.doc_number}</Ltr>
                <Link to={`/sales/invoices/${s.invoice_id}`} className="text-sm text-brand-700 hover:underline">{t("tms.openInvoice")}</Link>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal title={t("tms.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && (
          <ShipmentForm shipment={s} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("tms.saved")); }} />
        )}
      </Modal>
      <Modal title={t("tms.deliveredTitle", { number: s.doc_number ?? "" })} open={modal === "delivered"} onClose={close}>
        {modal === "delivered" && <StepForm shipment={s} step="delivered" onDone={close} onCancel={close} />}
      </Modal>
      <Modal title={t("tms.exceptionTitle", { number: s.doc_number ?? "" })} open={modal === "exception"} onClose={close}>
        {modal === "exception" && <StepForm shipment={s} step="exception" onDone={close} onCancel={close} />}
      </Modal>
      <Modal title={t("tms.cancelTitle", { number: s.doc_number ?? "" })} open={modal === "canceled"} onClose={close}>
        {modal === "canceled" && <StepForm shipment={s} step="canceled" onDone={close} onCancel={close} />}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("tms.deleteConfirm", { number: s.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

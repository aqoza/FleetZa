import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Pencil, Play, Send, Trash2, XCircle } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { displayToKm, formatDateTime, formatDistance, formatMoney, formatVolume, kmToDisplay } from "../../lib/format";
import { planVsActual, straightLineKm } from "../../../shared/trips";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, Input, LoadingState, Ltr, Modal, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ConflictList, TripForm, useConflicts } from "./TripForm";
import { StopsPanel } from "./StopsPanel";
import { driverName, fromInput, statusTone, toInput } from "./labels";
import { normalizeTrip, STOP_SELECT, TRIP_SELECT, type Trip, type TripStop } from "./types";

function useTrip(id: string) {
  return useQuery({
    queryKey: ["trips", "detail", id],
    queryFn: async () => {
      const rows = await listRows<Trip>("trips", (q) => q.select(TRIP_SELECT).eq("id", id).limit(1));
      return rows[0] ? normalizeTrip(rows[0]) : null;
    },
  });
}

function useStops(tripId: string) {
  return useQuery({
    queryKey: ["trip_stops", tripId],
    queryFn: () => listRows<TripStop>("trip_stops", (q) => q.select(STOP_SELECT).eq("trip_id", tripId).order("sequence").limit(1000)),
  });
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

function minutesText(mins: number, t: ReturnType<typeof useT>): string {
  return t("trips.hours", { h: Math.floor(mins / 60), m: mins % 60 });
}

/** Isolate a left-to-right value (a distance with its unit) inside translated text. */
const iso = (s: string) => `\u2066${s}\u2069`;

export default function TripDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const tripQ = useTrip(id);
  const stopsQ = useStops(id);
  const [modal, setModal] = useState<"edit" | "complete" | "cancel" | "delete" | null>(null);
  const [endOdo, setEndOdo] = useState("");
  const [actualEnd, setActualEnd] = useState("");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const trip = tripQ.data;
  const holding = trip?.status === "planned" || trip?.status === "dispatched";
  const conflictsQ = useConflicts(holding ? trip.vehicle_id : "", trip?.driver_id ?? "", trip?.planned_start ?? null, trip?.planned_end ?? null, trip?.id);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["trips"] });
    void qc.invalidateQueries({ queryKey: ["trip_conflicts"] });
  };
  const update = useMutation({
    mutationFn: (v: { values: Record<string, unknown>; done: string }) => updateRow("trips", id, v.values),
    onSuccess: (_d, v) => {
      setActionError("");
      setModal(null);
      refresh();
      toast.success(v.done);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("trips", id),
    onSuccess: () => {
      refresh();
      toast.success(t("trips.deleted"));
      navigate("/trips/list");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setModal(null);
    },
  });

  if (tripQ.isLoading) return <LoadingState />;
  if (tripQ.error) return <ErrorState message={(tripQ.error as Error).message} />;
  if (!trip) return <ErrorState message={t("trips.notFound")} />;

  const stops = stopsQ.data ?? [];
  const unit = tenant.distance_unit;
  const pva = planVsActual(trip);
  const lineKm = straightLineKm(stops.map((s) => ({ lat: s.lat == null ? null : Number(s.lat), lng: s.lng == null ? null : Number(s.lng) })));
  const open = trip.status !== "completed" && trip.status !== "canceled";

  function submitComplete(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      values: {
        status: "completed",
        end_odometer: endOdo.trim() === "" ? null : Math.round(displayToKm(Number(endOdo), unit) * 10) / 10,
        actual_end: fromInput(actualEnd),
      },
      done: t("trips.completed"),
    });
  }

  const delay = pva.start_delay_minutes;
  const delayText =
    delay == null ? t("trips.notStarted") : Math.abs(delay) <= 5 ? t("trips.onTime") : delay > 0 ? tp("trips.late", delay) : tp("trips.early", -delay);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/trips/list" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("trips.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{trip.doc_number}</Ltr>
        <Badge tone={statusTone[trip.status]}>{t(`trips.status.${trip.status}`)}</Badge>
        <Bdi className="min-w-0 truncate text-ink-2">{trip.purpose}</Bdi>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {open && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {trip.status === "planned" && (
              <Button variant="ghost" onClick={() => setModal("delete")}>
                <Trash2 className="h-4 w-4" /> {t("action.delete")}
              </Button>
            )}
            {holding && (
              <Button variant="secondary" onClick={() => { setReason(""); setModal("cancel"); }}>
                <XCircle className="h-4 w-4" /> {t("trips.cancel")}
              </Button>
            )}
            {trip.status === "planned" && (
              <Button loading={update.isPending} onClick={() => update.mutate({ values: { status: "dispatched" }, done: t("trips.dispatched") })}>
                <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("trips.dispatch")}
              </Button>
            )}
            {trip.status === "dispatched" && (
              <Button loading={update.isPending} onClick={() => update.mutate({ values: { status: "in_progress" }, done: t("trips.started") })}>
                <Play className="h-4 w-4 rtl:-scale-x-100" /> {t("trips.start")}
              </Button>
            )}
            {trip.status === "in_progress" && (
              <Button
                onClick={() => {
                  setEndOdo(trip.vehicle ? String(Math.round(kmToDisplay(Number(trip.vehicle.odometer), unit))) : "");
                  setActualEnd(toInput(new Date().toISOString()));
                  setModal("complete");
                }}
              >
                <CheckCircle2 className="h-4 w-4" /> {t("trips.complete")}
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}
      {holding && <ConflictList conflicts={conflictsQ.data ?? []} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-ink">{t("trips.summary")}</h2>
          <dl>
            <Row label={t("trips.col.vehicle")}>
              <Link to={`/vehicles/${trip.vehicle_id}`} className="text-brand-700 hover:underline"><Bdi>{trip.vehicle?.name ?? "—"}</Bdi></Link>
            </Row>
            <Row label={t("trips.col.driver")}>{trip.driver ? <Bdi>{driverName(trip.driver)}</Bdi> : "—"}</Row>
            {trip.customer && <Row label={t("trips.s.customer")}><Bdi>{trip.customer.name}</Bdi></Row>}
            <Row label={t("trips.s.window")}>
              <span className="whitespace-nowrap">{formatDateTime(trip.planned_start, tenant.timezone)}</span>
              <div className="text-xs text-ink-3">{formatDateTime(trip.planned_end, tenant.timezone)}</div>
            </Row>
            <Row label={t("trips.s.actual")}>
              {trip.actual_start ? (
                <>
                  <span className="whitespace-nowrap">{formatDateTime(trip.actual_start, tenant.timezone)}</span>
                  {trip.actual_end && <div className="text-xs text-ink-3">{formatDateTime(trip.actual_end, tenant.timezone)}</div>}
                </>
              ) : (
                <span className="text-ink-3">{t("trips.notStarted")}</span>
              )}
            </Row>
            <Row label={t("trips.s.delay")}>
              <span className={delay != null && delay > 5 ? "text-serious" : undefined}>{delayText}</span>
            </Row>
            <Row label={t("trips.s.duration")}>
              {pva.actual_minutes != null
                ? t("trips.plannedVsActual", { actual: minutesText(pva.actual_minutes, t), planned: minutesText(pva.planned_minutes, t) })
                : minutesText(pva.planned_minutes, t)}
            </Row>
            <Row label={t("trips.s.distance")}>
              {pva.actual_km != null && trip.planned_distance_km != null
                ? t("trips.plannedVsActual", { actual: iso(formatDistance(pva.actual_km, unit)), planned: iso(formatDistance(trip.planned_distance_km, unit)) })
                : <Ltr>{formatDistance(pva.actual_km ?? trip.planned_distance_km, unit)}</Ltr>}
              {pva.distance_delta_km != null && pva.distance_delta_km !== 0 && (
                <div className="text-xs text-ink-3">
                  {t("trips.deltaKm", { delta: iso(`${pva.distance_delta_km > 0 ? "+" : "−"}${formatDistance(Math.abs(pva.distance_delta_km), unit)}`) })}
                </div>
              )}
              {trip.planned_distance_km == null && lineKm != null && (
                <div className="mt-1 text-xs text-ink-3">
                  {t("trips.straightLine", { distance: iso(formatDistance(lineKm, unit)) })}
                  {isManager && open && (
                    <button
                      type="button"
                      className="ms-2 text-brand-700 hover:underline"
                      onClick={() => update.mutate({ values: { planned_distance_km: lineKm }, done: t("trips.saved") })}
                    >
                      {t("trips.useEstimate")}
                    </button>
                  )}
                </div>
              )}
            </Row>
            {(trip.start_odometer != null || trip.end_odometer != null) && (
              <Row label={t("trips.s.odometer")}>
                <Ltr>{`${formatDistance(trip.start_odometer, unit)} → ${formatDistance(trip.end_odometer, unit)}`}</Ltr>
              </Row>
            )}
            <Row label={t("trips.s.fuel")}>
              {trip.estimated_fuel_l != null ? <Ltr>{formatVolume(trip.estimated_fuel_l, tenant.volume_unit)}</Ltr> : <span className="text-xs text-ink-3">{t("trips.noEstimate")}</span>}
            </Row>
            {trip.estimated_cost != null && <Row label={t("trips.s.cost")}>{formatMoney(trip.estimated_cost, tenant.currency)}</Row>}
            {trip.cancel_reason && <Row label={t("trips.s.cancelReason")}><Bdi>{trip.cancel_reason}</Bdi></Row>}
          </dl>
          {trip.notes && (
            <div className="mt-3 text-sm">
              <div className="text-ink-3">{t("trips.s.notes")}</div>
              <Bdi className="block whitespace-pre-line text-ink-2">{trip.notes}</Bdi>
            </div>
          )}
        </Card>
        <div className="lg:col-span-3">
          {stopsQ.isLoading ? <LoadingState /> : stopsQ.error ? <ErrorState message={(stopsQ.error as Error).message} /> : <StopsPanel trip={trip} stops={stops} />}
        </div>
      </div>

      <Modal title={t("trips.editTitle")} open={modal === "edit"} onClose={() => setModal(null)} wide>
        {modal === "edit" && (
          <TripForm
            trip={trip}
            onCancel={() => setModal(null)}
            onDone={() => {
              setModal(null);
              refresh();
              toast.success(t("trips.saved"));
            }}
          />
        )}
      </Modal>

      <Modal title={t("trips.completeTitle")} open={modal === "complete"} onClose={() => setModal(null)}>
        <form className="space-y-3" onSubmit={submitComplete}>
          <Field
            label={`${t("trips.endOdometer")} (${unit})`}
            hint={trip.start_odometer != null ? t("trips.endOdometerHint", { km: iso(formatDistance(trip.start_odometer, unit)) }) : undefined}
          >
            <Input type="number" min={0} step="0.1" value={endOdo} onChange={(e) => setEndOdo(e.target.value)} />
          </Field>
          <Field label={t("trips.actualEnd")}>
            <Input type="datetime-local" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
            <Button type="submit" loading={update.isPending}>{t("trips.complete")}</Button>
          </div>
        </form>
      </Modal>

      <Modal title={t("trips.cancelTitle")} open={modal === "cancel"} onClose={() => setModal(null)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ values: { status: "canceled", cancel_reason: reason.trim() || null }, done: t("trips.canceled") });
          }}
        >
          <Field label={t("trips.cancelReason")}>
            <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
            <Button type="submit" variant="danger" loading={update.isPending}>{t("trips.cancel")}</Button>
          </div>
        </form>
      </Modal>

      <Modal title={t("action.delete")} open={modal === "delete"} onClose={() => setModal(null)}>
        <p className="text-sm text-ink-2">{t("trips.deleteConfirm", { number: trip.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

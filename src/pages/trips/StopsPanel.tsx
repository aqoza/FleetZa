import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LogIn, LogOut, MapPin, Pencil, Plus, SkipForward, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, insertRow, updateRow, wrapDbError } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import type { StopStatus } from "../../../shared/trips";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, Input, Ltr, Modal, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { fromInput, stopTone, toInput } from "./labels";
import type { Trip, TripStop } from "./types";

interface StopForm {
  name: string;
  address: string;
  lat: string;
  lng: string;
  planned_arrival: string;
  notes: string;
}

function StopEditor({ trip, stop, onDone }: { trip: Trip; stop: TripStop | null; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<StopForm>({
    name: stop?.name ?? "",
    address: stop?.address ?? "",
    lat: stop?.lat == null ? "" : String(stop.lat),
    lng: stop?.lng == null ? "" : String(stop.lng),
    planned_arrival: toInput(stop?.planned_arrival ?? null),
    notes: stop?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = <K extends keyof StopForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const halfCoords = (form.lat.trim() === "") !== (form.lng.trim() === "");

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        lat: form.lat.trim() === "" ? null : Number(form.lat),
        lng: form.lng.trim() === "" ? null : Number(form.lng),
        planned_arrival: fromInput(form.planned_arrival),
        notes: form.notes.trim() || null,
      };
      if (stop) await updateRow("trip_stops", stop.id, row);
      else await insertRow("trip_stops", { ...row, trip_id: trip.id });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["trip_stops", trip.id] });
      toast.success(t("trips.stopSaved"));
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!halfCoords) save.mutate();
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label={t("trips.stop.name")} required>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
      </Field>
      <Field label={t("trips.stop.address")}>
        <Input value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={500} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("trips.stop.lat")} hint={t("trips.stop.coordsHint")} error={halfCoords ? t("trips.stop.coordsPair") : undefined}>
          <Input dir="ltr" type="number" step="0.000001" min={-90} max={90} value={form.lat} onChange={(e) => set("lat", e.target.value)} />
        </Field>
        <Field label={t("trips.stop.lng")}>
          <Input dir="ltr" type="number" step="0.000001" min={-180} max={180} value={form.lng} onChange={(e) => set("lng", e.target.value)} />
        </Field>
      </div>
      <Field label={t("trips.stop.planned")}>
        <Input type="datetime-local" value={form.planned_arrival} onChange={(e) => set("planned_arrival", e.target.value)} />
      </Field>
      <Field label={t("trips.stop.notes")}>
        <Textarea rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-serious">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={halfCoords}>{t("action.save")}</Button>
      </div>
    </form>
  );
}

const iconBtn =
  "rounded-md p-1.5 text-ink-3 transition-colors hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

export function StopsPanel({ trip, stops }: { trip: Trip; stops: TripStop[] }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<TripStop | "new" | null>(null);
  const [error, setError] = useState("");
  const locked = trip.status === "completed" || trip.status === "canceled";
  const canEdit = isManager && !locked;
  const running = trip.status === "in_progress";
  const refresh = () => void qc.invalidateQueries({ queryKey: ["trip_stops", trip.id] });
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : t("common.error"));

  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error: e } = await supabase.rpc("trip_stops_reorder", { p_trip_id: trip.id, p_stop_ids: ids });
      if (e) throw wrapDbError(e);
    },
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError,
  });
  const move = useMutation({
    mutationFn: (v: { id: string; status: StopStatus }) => updateRow("trip_stops", v.id, { status: v.status }),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("trip_stops", id),
    onSuccess: () => {
      setError("");
      refresh();
      toast.success(t("trips.stopRemoved"));
    },
    onError,
  });

  const shift = (i: number, by: -1 | 1) => {
    const ids = stops.map((s) => s.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{t("trips.stops")}</h2>
        {canEdit && (
          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> {t("trips.addStop")}
          </Button>
        )}
      </div>
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      {stops.length === 0 ? (
        <p className="text-sm text-ink-3">{t(canEdit ? "trips.stopsEmpty" : "trips.noStops")}</p>
      ) : (
        <ol className="space-y-0">
          {stops.map((s, i) => (
            <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < stops.length - 1 && <span aria-hidden className="absolute start-3.5 top-8 bottom-0 w-px bg-line" />}
              <span
                className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  s.status === "departed" ? "bg-good-soft text-good" : s.status === "skipped" ? "bg-warn-soft text-warn" : "bg-canvas text-ink-2"
                }`}
              >
                <Ltr>{i + 1}</Ltr>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Bdi className="font-medium text-ink">{s.name}</Bdi>
                  <Badge tone={stopTone[s.status]}>{t(`trips.stopStatus.${s.status}`)}</Badge>
                </div>
                {s.address && <Bdi className="block text-sm text-ink-2">{s.address}</Bdi>}
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-3">
                  {s.planned_arrival && <span>{t("trips.stop.plannedAt", { time: formatDateTime(s.planned_arrival, tenant.timezone) })}</span>}
                  {s.actual_arrival && <span>{t("trips.stop.arrivedAt", { time: formatDateTime(s.actual_arrival, tenant.timezone) })}</span>}
                  {s.actual_departure && <span>{t("trips.stop.departedAt", { time: formatDateTime(s.actual_departure, tenant.timezone) })}</span>}
                  {s.lat != null && s.lng != null && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      <Ltr>{`${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}`}</Ltr>
                    </span>
                  )}
                </div>
                {s.notes && <Bdi className="mt-0.5 block text-xs text-ink-3">{s.notes}</Bdi>}
                {isManager && running && (s.status === "pending" || s.status === "arrived") && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.status === "pending" && (
                      <>
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={move.isPending}
                          onClick={() => move.mutate({ id: s.id, status: "arrived" })}>
                          <LogIn className="h-4 w-4 rtl:-scale-x-100" /> {t("trips.stop.arrive")}
                        </Button>
                        <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={move.isPending}
                          onClick={() => move.mutate({ id: s.id, status: "skipped" })}>
                          <SkipForward className="h-4 w-4 rtl:-scale-x-100" /> {t("trips.stop.skip")}
                        </Button>
                      </>
                    )}
                    {s.status === "arrived" && (
                      <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={move.isPending}
                        onClick={() => move.mutate({ id: s.id, status: "departed" })}>
                        <LogOut className="h-4 w-4 rtl:-scale-x-100" /> {t("trips.stop.depart")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-start gap-0.5">
                  <button type="button" className={iconBtn} aria-label={t("trips.stop.moveUp")} title={t("trips.stop.moveUp")}
                    disabled={i === 0 || reorder.isPending} onClick={() => shift(i, -1)}>
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" className={iconBtn} aria-label={t("trips.stop.moveDown")} title={t("trips.stop.moveDown")}
                    disabled={i === stops.length - 1 || reorder.isPending} onClick={() => shift(i, 1)}>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" className={iconBtn} aria-label={t("action.edit")} title={t("action.edit")} onClick={() => setEditing(s)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  {s.status === "pending" && (
                    <button type="button" className={`${iconBtn} hover:bg-serious-soft hover:text-serious`} aria-label={t("trips.stop.remove")}
                      title={t("trips.stop.remove")} disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <Modal title={t(editing === "new" ? "trips.stopTitle" : "trips.editStopTitle")} open={editing != null} onClose={() => setEditing(null)}>
        {editing != null && <StopEditor trip={trip} stop={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Card>
  );
}

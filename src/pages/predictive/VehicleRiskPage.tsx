import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Wrench, XCircle } from "lucide-react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import {
  GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { getRow, insertRow, listRows, updateRow } from "../../lib/db";
import { formatDate, formatDistance, formatMoney } from "../../lib/format";
import type { Vehicle } from "../../lib/types";
import { projectOdometer, type Factor } from "../../../shared/predictive";
import { getCountry } from "../../../shared/countries";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useHealth } from "./hooks";
import { bandTone, factorValue, SERIES_1, SERIES_SERVICE, serviceText } from "./labels";
import type { HealthRow } from "./types";

const DAY = 86_400_000;
type Priority = "low" | "normal" | "high" | "critical";

function useReadings(vehicleId: string) {
  return useQuery({
    queryKey: ["predictive", "readings", vehicleId],
    queryFn: async () => {
      const since = new Date(Date.now() - 180 * DAY).toISOString();
      const [fuel, wo, insp] = await Promise.all([
        listRows<{ filled_at: string; odometer: number }>("fuel_logs", (q) =>
          q.select("filled_at, odometer").eq("vehicle_id", vehicleId).gt("odometer", 0).gte("filled_at", since).order("filled_at").limit(500),
        ),
        listRows<{ completed_at: string | null; created_at: string; odometer: number }>("work_orders", (q) =>
          q.select("completed_at, created_at, odometer").eq("vehicle_id", vehicleId).gt("odometer", 0).gte("created_at", since).limit(500),
        ),
        listRows<{ performed_at: string; odometer: number }>("inspections", (q) =>
          q.select("performed_at, odometer").eq("vehicle_id", vehicleId).gt("odometer", 0).gte("performed_at", since).limit(500),
        ),
      ]);
      return [
        ...fuel.map((r) => ({ t: Date.parse(r.filled_at), km: Number(r.odometer) })),
        ...wo.map((r) => ({ t: Date.parse(r.completed_at ?? r.created_at), km: Number(r.odometer) })),
        ...insp.map((r) => ({ t: Date.parse(r.performed_at), km: Number(r.odometer) })),
      ].sort((a, b) => a.t - b.t);
    },
  });
}

function Forecast({ health, vehicle }: { health: HealthRow; vehicle: Vehicle }) {
  const t = useT();
  const tenant = useTenant();
  const readingsQ = useReadings(vehicle.id);
  const now = Date.now();
  const points = useMemo(() => {
    const pts = [...(readingsQ.data ?? [])];
    if (vehicle.odometer > 0 && vehicle.odometer_updated_at && Date.parse(vehicle.odometer_updated_at) >= now - 180 * DAY) {
      pts.push({ t: Date.parse(vehicle.odometer_updated_at), km: Number(vehicle.odometer) });
    }
    return pts;
  }, [readingsQ.data, vehicle, now]);

  const horizon = health.days_to_service != null && health.days_to_service > 0 ? Math.min(health.days_to_service, 365) : 30;
  const projection =
    health.avg_daily_km != null
      ? [
          { t: now, km: Number(health.odometer) },
          { t: now + horizon * DAY, km: projectOdometer(Number(health.odometer), health.avg_daily_km, horizon) },
        ]
      : [];
  const service =
    health.predicted_service_date && health.avg_daily_km != null
      ? [{ t: Date.parse(`${health.predicted_service_date}T12:00:00`), km: projectOdometer(Number(health.odometer), health.avg_daily_km, Math.max(health.days_to_service ?? 0, 0)) }]
      : [];
  const fmtDay = (ms: number) =>
    new Intl.DateTimeFormat(getCountry(tenant.country).locale, { month: "short", day: "numeric", timeZone: tenant.timezone }).format(ms);

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">{t("predictive.forecast")}</h3>
      {readingsQ.isLoading && <LoadingState />}
      {readingsQ.error && <ErrorState message={(readingsQ.error as Error).message} />}
      {readingsQ.data && points.length < 2 && <p className="text-sm text-ink-3">{t("predictive.forecastEmpty")}</p>}
      {readingsQ.data && points.length >= 2 && (
        <div dir="ltr" className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtDay} tick={TICK_STYLE} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis
                dataKey="km"
                type="number"
                domain={["auto", "auto"]}
                tick={TICK_STYLE}
                axisLine={false}
                tickLine={false}
                width={92}
                tickFormatter={(km) => formatDistance(Number(km), tenant.distance_unit)}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelFormatter={(ms) => formatDate(new Date(Number(ms)).toISOString().slice(0, 10))}
                formatter={(v, name) => [formatDistance(Number(v), tenant.distance_unit), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Scatter name={t("predictive.series.readings")} data={points} dataKey="km" fill={SERIES_1} />
              {projection.length > 0 && (
                <Line name={t("predictive.series.projection")} data={projection} dataKey="km" stroke={SERIES_1} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
              )}
              {service.length > 0 && <Scatter name={t("predictive.series.service")} data={service} dataKey="km" fill={SERIES_SERVICE} shape="diamond" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function FactorList({ factors }: { factors: Factor[] }) {
  const t = useT();
  const tp = useTp();
  if (factors.length === 0) return <p className="text-sm text-ink-3">{t("predictive.noFactors")}</p>;
  const max = Math.max(...factors.map((f) => f.points));
  return (
    <ul className="space-y-3">
      {factors.map((f) => {
        const value = factorValue(f, t, tp);
        return (
          <li key={f.code}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink">{t(`predictive.f.${f.code}`)}</span>
              <span className="whitespace-nowrap text-xs font-semibold text-serious">{tp("predictive.points", f.points)}</span>
            </div>
            {value && <div className="text-xs text-ink-3">{value}</div>}
            <div className="mt-1 h-1.5 rounded-full bg-canvas">
              <div className="h-1.5 rounded-full bg-serious" style={{ width: `${(f.points / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WorkOrderModal({
  health,
  vehicle,
  predictionId,
  onClose,
}: {
  health: HealthRow;
  vehicle: Vehicle;
  predictionId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const top = health.factors[0];
  const [form, setForm] = useState(() => ({
    title: t("predictive.woTitle", { reason: top ? t(`predictive.f.${top.code}`) : t("predictive.title") }).slice(0, 200),
    description: [
      t("predictive.woDescription", { score: health.risk_score }),
      ...health.factors.map((f) => {
        const v = factorValue(f, t, tp);
        return `- ${t(`predictive.f.${f.code}`)}${v ? ` (${v})` : ""}`;
      }),
    ].join("\n"),
    priority: (health.band === "high" ? (health.open_critical > 0 ? "critical" : "high") : "normal") as Priority,
    scheduled: health.predicted_service_date ?? "",
  }));
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const m = useMutation({
    mutationFn: async () => {
      const wo = await insertRow<{ id: string }>("work_orders", {
        vehicle_id: vehicle.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: "open",
        priority: form.priority,
        scheduled_date: form.scheduled || null,
        tax_rate: getCountry(tenant.country).tax.rate,
      });
      if (predictionId) {
        await updateRow("maintenance_predictions", predictionId, { status: "actioned", work_order_id: wo.id });
      }
      return wo.id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      void qc.invalidateQueries({ queryKey: ["maintenance_predictions"] });
      toast.success(t("predictive.woCreated"));
      onClose();
      navigate(`/maintenance/work-orders/${id}`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  return (
    <Modal title={t("predictive.createWorkOrder")} open onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t("predictive.f.title")} required>
          <Input maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </Field>
        <Field label={t("predictive.f.description")}>
          <Textarea rows={6} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("predictive.f.priority")} required>
            <Select value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {(["low", "normal", "high", "critical"] as const).map((p) => (
                <option key={p} value={p}>{t(`predictive.priority.${p}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("predictive.f.scheduled")}>
            <Input type="date" dir="ltr" value={form.scheduled} onChange={(e) => set("scheduled", e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" loading={m.isPending} disabled={!form.title.trim()}>{t("predictive.createWorkOrder")}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function VehicleRiskPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const healthQ = useHealth();
  const vehicleQ = useQuery({ queryKey: ["vehicles", id], queryFn: () => getRow<Vehicle>("vehicles", id) });
  const openQ = useQuery({
    queryKey: ["maintenance_predictions", "open", id],
    queryFn: async () =>
      (
        await listRows<{ id: string; computed_at: string }>("maintenance_predictions", (q) =>
          q.select("id, computed_at").eq("vehicle_id", id).eq("status", "open").limit(1),
        )
      )[0] ?? null,
  });
  const [creating, setCreating] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");

  const dismiss = useMutation({
    mutationFn: () => updateRow("maintenance_predictions", openQ.data!.id, { status: "dismissed", note: note.trim() || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["maintenance_predictions"] });
      toast.success(t("predictive.dismissed"));
      setDismissing(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  if (healthQ.isLoading || vehicleQ.isLoading) return <LoadingState />;
  if (healthQ.error) return <ErrorState message={(healthQ.error as Error).message} />;
  if (vehicleQ.error) return <ErrorState message={(vehicleQ.error as Error).message} />;
  const vehicle = vehicleQ.data;
  const health = healthQ.data?.find((r) => r.vehicle_id === id);
  if (!vehicle || !health) return <ErrorState message={t("predictive.notFound")} />;

  const stats: Array<[string, string]> = [
    [t("predictive.s.usage"), health.avg_daily_km == null ? t("predictive.noUsage") : t("predictive.kmPerDay", { km: health.avg_daily_km })],
    [t("predictive.s.service"), serviceText(health.days_to_service, health.service_overdue, t, tp)],
    [t("predictive.s.predicted"), health.predicted_service_date ? formatDate(health.predicted_service_date) : "—"],
    [t("predictive.s.issues"), String(health.issues_180d)],
    [t("predictive.s.issueRate"), health.issue_rate.toFixed(1)],
    [t("predictive.s.cost"), formatMoney(health.cost_90d, tenant.currency)],
    [t("predictive.s.costPrev"), formatMoney(health.cost_prev_90d, tenant.currency)],
    [
      t("predictive.s.inspection"),
      health.days_since_inspection == null ? t("predictive.s.never") : tp("predictive.s.inspectionAgo", health.days_since_inspection),
    ],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/predictive" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("predictive.back")}
        </Link>
        <h2 className="text-lg font-semibold text-ink">
          <Link to={`/vehicles/${vehicle.id}`} className="hover:underline">
            <Bdi>{vehicle.name}</Bdi>
          </Link>
        </h2>
        <Badge tone={bandTone[health.band]}>{t(`predictive.band.${health.band}`)}</Badge>
        <span className="text-2xl font-bold tabular-nums text-ink">{health.risk_score}</span>
        <span className="text-sm text-ink-3">/100</span>
        {isManager && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {openQ.data && (
              <span className="text-xs text-ink-3">{t("predictive.openPrediction", { date: formatDate(openQ.data.computed_at, tenant.timezone) })}</span>
            )}
            {openQ.data && (
              <Button variant="secondary" onClick={() => setDismissing(true)}>
                <XCircle className="h-4 w-4" /> {t("predictive.dismiss")}
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>
              <Wrench className="h-4 w-4" /> {t("predictive.createWorkOrder")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">{t("predictive.whyTitle")}</h3>
          <FactorList factors={health.factors} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">{t("predictive.stats")}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {stats.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-line pb-1.5">
                <dt className="text-ink-3">{label}</dt>
                <dd className="text-end font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Forecast health={health} vehicle={vehicle} />

      {creating && (
        <WorkOrderModal health={health} vehicle={vehicle} predictionId={openQ.data?.id ?? null} onClose={() => setCreating(false)} />
      )}
      <Modal title={t("predictive.dismissTitle")} open={dismissing} onClose={() => setDismissing(false)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            dismiss.mutate();
          }}
        >
          <Field label={t("predictive.dismissNote")}>
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDismissing(false)}>{t("action.cancel")}</Button>
            <Button type="submit" variant="danger" loading={dismiss.isPending}>{t("predictive.dismiss")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

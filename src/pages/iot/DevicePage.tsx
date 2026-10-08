import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { deleteRow, insertRow, listPage, listRows } from "../../lib/db";
import { downsample, latestValues, METRIC_RE, TYPE_DEFAULTS } from "../../lib/iot";
import { formatDateTime } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Pagination, Select,
} from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { DeviceForm } from "./DeviceForm";
import { AlertsTable } from "./AlertsPage";
import { RulesTable } from "./RulesPage";
import { FreshDot, useFormatReading } from "./shared";
import { localNow, SERIES_1, statusTone, THRESHOLD_COLOR } from "./labels";
import { DEVICE_SELECT, type IotDevice, type IotReading } from "./types";

const RANGES = { "24h": 1, "7d": 7, "30d": 30 } as const;
type Range = keyof typeof RANGES;
const MAX_POINTS = 2000;
const CHART_POINTS = 300;
const PAGE_SIZE = 20;

function ReadingForm({ device, onClose }: { device: IotDevice; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const def = TYPE_DEFAULTS[device.device_type];
  const [form, setForm] = useState({ metric: def.metric, value: "", unit: def.unit, at: localNow() });
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const metricOk = METRIC_RE.test(form.metric);

  const m = useMutation({
    mutationFn: () =>
      insertRow("iot_readings", {
        device_id: device.id,
        metric: form.metric,
        value: Number(form.value),
        unit: form.unit.trim() || null,
        recorded_at: new Date(form.at).toISOString(),
        source: "manual",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["iot_readings"] });
      void qc.invalidateQueries({ queryKey: ["iot_devices"] });
      void qc.invalidateQueries({ queryKey: ["iot_alerts"] });
      toast.success(t("iot.readingSaved"));
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  return (
    <Modal title={t("iot.addReading")} open onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t("iot.f.metric")} hint={t("iot.f.metricHint")} required error={form.metric && !metricOk ? t("iot.f.metricHint") : undefined}>
          <Input dir="ltr" maxLength={50} value={form.metric} onChange={(e) => set("metric", e.target.value.trim().toLowerCase())} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("iot.f.value")} required>
            <Input type="number" dir="ltr" step="any" value={form.value} onChange={(e) => set("value", e.target.value)} required />
          </Field>
          <Field label={t("iot.f.unit")}>
            <Input dir="ltr" maxLength={20} value={form.unit} onChange={(e) => set("unit", e.target.value)} />
          </Field>
        </div>
        <Field label={t("iot.f.recordedAt")} required>
          <Input type="datetime-local" dir="ltr" value={form.at} onChange={(e) => set("at", e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" loading={m.isPending} disabled={!metricOk || form.value === ""}>{t("action.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function MetricChart({ device }: { device: IotDevice }) {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const fmt = useFormatReading();
  const metrics = useMemo(() => latestValues(device.last_reading).map((v) => v.metric).sort(), [device.last_reading]);
  // Open on the device type's usual metric when it reports one.
  const [metric, setMetric] = useState(() => {
    const usual = TYPE_DEFAULTS[device.device_type].metric;
    return metrics.includes(usual) ? usual : (metrics[0] ?? "");
  });
  const [range, setRange] = useState<Range>("24h");
  const active = metric || metrics[0] || "";

  const readingsQ = useQuery({
    queryKey: ["iot_readings", "series", device.id, active, range],
    enabled: !!active,
    queryFn: () =>
      listRows<{ recorded_at: string; value: number; unit: string | null }>("iot_readings", (q) =>
        q
          .select("recorded_at, value, unit")
          .eq("device_id", device.id)
          .eq("metric", active)
          .gte("recorded_at", new Date(Date.now() - RANGES[range] * 86_400_000).toISOString())
          .order("recorded_at", { ascending: true })
          .limit(MAX_POINTS),
      ),
  });
  const rulesQ = useQuery({
    queryKey: ["iot_alert_rules", "thresholds", device.id, active],
    enabled: !!active,
    queryFn: () =>
      listRows<{ id: string; threshold: number }>("iot_alert_rules", (q) =>
        q
          .select("id, threshold")
          .eq("metric", active)
          .eq("active", true)
          .or(
            `device_id.eq.${device.id},and(device_id.is.null,device_type.is.null),and(device_id.is.null,device_type.eq.${device.device_type})`,
          )
          .limit(10),
      ),
  });

  const unit = readingsQ.data?.find((r) => r.unit)?.unit ?? null;
  const series = useMemo(
    () => downsample((readingsQ.data ?? []).map((r) => ({ t: Date.parse(r.recorded_at), v: Number(r.value) })), CHART_POINTS),
    [readingsQ.data],
  );
  const tick = (ms: number) =>
    new Intl.DateTimeFormat(undefined, {
      ...(range === "24h" ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" }),
      timeZone: tenant.timezone,
    }).format(ms);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="me-auto text-sm font-semibold text-ink">{t("iot.chart")}</h3>
        {metrics.length > 0 && (
          <>
            <Select aria-label={t("iot.metric")} dir="ltr" value={active} onChange={(e) => setMetric(e.target.value)} className="max-w-48">
              {metrics.map((mtr) => (
                <option key={mtr} value={mtr}>{mtr}</option>
              ))}
            </Select>
            <Select value={range} onChange={(e) => setRange(e.target.value as Range)} className="max-w-44">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <option key={r} value={r}>{t(`iot.range.${r}`)}</option>
              ))}
            </Select>
          </>
        )}
      </div>
      {metrics.length === 0 && <p className="text-sm text-ink-3">{t("iot.noReadings")}</p>}
      {readingsQ.isLoading && active && <LoadingState />}
      {readingsQ.error && <ErrorState message={(readingsQ.error as Error).message} />}
      {readingsQ.data && readingsQ.data.length === 0 && <p className="text-sm text-ink-3">{t("iot.chartEmpty")}</p>}
      {series.length > 0 && (
        <>
          <div dir="ltr" className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={tick}
                  tick={TICK_STYLE}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={48} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelFormatter={(ms) => formatDateTime(new Date(Number(ms)).toISOString(), tenant.timezone)}
                  formatter={(v) => [fmt(Number(v), unit), active]}
                />
                {(rulesQ.data ?? []).map((r) => (
                  <ReferenceLine
                    key={r.id}
                    y={Number(r.threshold)}
                    stroke={THRESHOLD_COLOR}
                    strokeDasharray="4 4"
                    label={{ value: `${t("iot.threshold")} ${Number(r.threshold)}`, fill: THRESHOLD_COLOR, fontSize: 11, position: "insideTopRight" }}
                  />
                ))}
                <Line type="monotone" dataKey="v" stroke={SERIES_1} strokeWidth={2} dot={series.length < 60} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-ink-3">{tp("iot.readingsShown", readingsQ.data?.length ?? 0)}</p>
        </>
      )}
    </Card>
  );
}

function ReadingsTable({ deviceId }: { deviceId: string }) {
  const t = useT();
  const tenant = useTenant();
  const fmt = useFormatReading();
  const [page, setPage] = useState(0);
  const listQ = useQuery({
    queryKey: ["iot_readings", "recent", deviceId, page],
    queryFn: () =>
      listPage<IotReading>("iot_readings", page, PAGE_SIZE, (q) =>
        q.select("id, device_id, recorded_at, metric, value, unit, source").eq("device_id", deviceId).order("recorded_at", { ascending: false }),
      ),
  });
  const columns: Array<DataTableColumn<IotReading>> = [
    {
      id: "time",
      header: t("iot.col.time"),
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(r.recorded_at, tenant.timezone)}</span>,
      sortValue: (r) => r.recorded_at,
      exportValue: (r) => r.recorded_at,
    },
    { id: "metric", header: t("iot.col.metric"), dir: "ltr", cell: (r) => <span className="text-ink-2">{r.metric}</span>, sortValue: (r) => r.metric, exportValue: (r) => r.metric },
    {
      id: "value",
      header: t("iot.col.value"),
      align: "end",
      dir: "ltr",
      cell: (r) => <span className="font-medium tabular-nums text-ink">{fmt(Number(r.value), r.unit)}</span>,
      sortValue: (r) => Number(r.value),
      exportValue: (r) => r.value,
    },
    {
      id: "source",
      header: t("iot.col.source"),
      minBreakpoint: "sm",
      cell: (r) => <span className="text-ink-2">{t(`iot.source.${r.source}`)}</span>,
      exportValue: (r) => r.source,
    },
  ];
  if (listQ.isLoading) return <LoadingState />;
  if (listQ.error) return <ErrorState message={(listQ.error as Error).message} />;
  return (
    <DataTable<IotReading>
      tableId="iot-readings"
      exportName="iot-readings"
      rows={listQ.data?.rows ?? []}
      rowKey={(r) => r.id}
      columns={columns}
      empty={<EmptyState title={t("iot.noReadings")} />}
      footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data?.total ?? 0} onPage={setPage} />}
    />
  );
}

export default function DevicePage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fmt = useFormatReading();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingReading, setAddingReading] = useState(false);
  const [actionError, setActionError] = useState("");

  const deviceQ = useQuery({
    queryKey: ["iot_devices", "one", id],
    queryFn: async () => (await listRows<IotDevice>("iot_devices", (q) => q.select(DEVICE_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });

  const remove = useMutation({
    mutationFn: () => deleteRow("iot_devices", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["iot_devices"] });
      toast.success(t("toast.deleted"));
      navigate("/iot");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(false);
    },
  });

  if (deviceQ.isLoading) return <LoadingState />;
  if (deviceQ.error) return <ErrorState message={(deviceQ.error as Error).message} />;
  const device = deviceQ.data;
  if (!device) return <ErrorState message={t("iot.notFound")} />;
  const latest = latestValues(device.last_reading);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/iot" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("iot.back")}
        </Link>
        <h2 className="text-lg font-semibold text-ink">
          <Bdi>{device.name}</Bdi>
        </h2>
        <Badge tone={statusTone[device.status]}>{t(`iot.status.${device.status}`)}</Badge>
        <FreshDot lastSeenAt={device.last_seen_at} withLabel />
        {isManager && (
          <div className="ms-auto flex gap-2">
            <Button variant="secondary" onClick={() => setAddingReading(true)}>
              <Plus className="h-4 w-4" /> {t("iot.addReading")}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)} aria-label={t("iot.editDevice")}>
              <Pencil className="h-4 w-4" /> {t("action.edit")}
            </Button>
            <Button variant="secondary" onClick={() => setDeleting(true)} aria-label={t("iot.deleteDevice")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {actionError && <ErrorState message={actionError} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">{t("iot.detail.info")}</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{t("iot.f.serial")}</dt>
              <dd dir="ltr" className="font-medium text-ink">{device.serial}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{t("iot.col.type")}</dt>
              <dd className="text-ink">{t(`iot.type.${device.device_type}`)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{t("iot.col.mountedOn")}</dt>
              <dd className="text-ink">
                {device.vehicle ? (
                  <Link to={`/vehicles/${device.vehicle_id}`} className="text-brand-700 hover:underline">
                    <Bdi>{device.vehicle.name}</Bdi>
                  </Link>
                ) : device.asset_label ? (
                  <Bdi>{device.asset_label}</Bdi>
                ) : (
                  <span className="text-ink-3">{t("iot.notMounted")}</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{t("iot.col.lastSeen")}</dt>
              <dd className="text-ink">{device.last_seen_at ? formatDateTime(device.last_seen_at, tenant.timezone) : t("iot.never")}</dd>
            </div>
            {device.notes && <p className="whitespace-pre-line pt-1 text-ink-2">{device.notes}</p>}
          </dl>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">{t("iot.latestValues")}</h3>
          {latest.length === 0 ? (
            <p className="text-sm text-ink-3">{t("iot.noReadings")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {latest.map((v) => (
                <div key={v.metric} className="rounded-xl border border-line p-2.5">
                  <div dir="ltr" className="truncate text-xs text-ink-3 rtl:text-end">{v.metric}</div>
                  <div dir="ltr" className="text-lg font-semibold tabular-nums text-ink rtl:text-end">{fmt(v.value, v.unit)}</div>
                  <div className="truncate text-[11px] text-ink-3">{formatDateTime(v.at, tenant.timezone)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="min-w-0">
          <MetricChart key={device.id} device={device} />
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("iot.detail.alerts")}</h3>
        <AlertsTable deviceId={device.id} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("iot.detail.rules")}</h3>
        <RulesTable device={device} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("iot.recentReadings")}</h3>
        <ReadingsTable deviceId={device.id} />
      </section>

      {editing && <DeviceForm device={device} onClose={() => setEditing(false)} />}
      {addingReading && <ReadingForm device={device} onClose={() => setAddingReading(false)} />}
      <Modal title={t("iot.deleteDevice")} open={deleting} onClose={() => setDeleting(false)}>
        <p className="text-sm text-ink-2">{t("iot.confirmDeleteDevice")}</p>
        <p className="mt-2 text-xs text-ink-3">
          <Bdi>{device.name}</Bdi> · <span dir="ltr">{device.serial}</span>
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
            {t("iot.deleteDevice")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

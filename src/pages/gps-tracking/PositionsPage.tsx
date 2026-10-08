import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Trash2, Upload } from "lucide-react";
import { deleteRow, insertMany, insertRow, listPage, listRows } from "../../lib/db";
import { parsePositionsCsv, plateKey, type CsvPosition } from "../../lib/gps";
import { useVehiclePicker } from "../../lib/pickers";
import { formatDateTime } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp, type MessageKey } from "../../i18n";
import {
  Bdi, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select,
} from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { fmtCoord } from "./labels";
import { vehicleEmbed, type Position, type PositionSource } from "./types";

const PAGE_SIZE = 25;
const CHUNK = 500;

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function ManualForm() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ vehicle: "", at: localNow(), lat: "", lng: "", speed: "", odometer: "" });
  const [error, setError] = useState("");
  const picker = useVehiclePicker(form.vehicle);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const m = useMutation({
    mutationFn: () =>
      insertRow("gps_positions", {
        vehicle_id: form.vehicle,
        recorded_at: new Date(form.at).toISOString(),
        lat: Number(form.lat),
        lng: Number(form.lng),
        speed_kmh: num(form.speed),
        odometer_km: num(form.odometer),
        source: "manual",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gps_positions"] });
      void qc.invalidateQueries({ queryKey: ["vehicle_last_positions"] });
      void qc.invalidateQueries({ queryKey: ["geofence_events"] });
      toast.success(t("gpsTracking.positionAdded"));
      setForm((f) => ({ ...f, at: localNow(), lat: "", lng: "", speed: "", odometer: "" }));
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    m.mutate();
  };

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{t("gpsTracking.addPosition")}</h2>
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t("gpsTracking.f.vehicle")} required>
          <Combobox {...picker} value={form.vehicle} onChange={(v) => set("vehicle", v)} />
        </Field>
        <Field label={t("gpsTracking.f.recordedAt")} required>
          <Input type="datetime-local" dir="ltr" value={form.at} onChange={(e) => set("at", e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("gpsTracking.f.lat")} required>
            <Input type="number" dir="ltr" step="any" min={-90} max={90} value={form.lat} onChange={(e) => set("lat", e.target.value)} required />
          </Field>
          <Field label={t("gpsTracking.f.lng")} required>
            <Input type="number" dir="ltr" step="any" min={-180} max={180} value={form.lng} onChange={(e) => set("lng", e.target.value)} required />
          </Field>
          <Field label={t("gpsTracking.f.speed")}>
            <Input type="number" dir="ltr" step="0.1" min={0} max={400} value={form.speed} onChange={(e) => set("speed", e.target.value)} />
          </Field>
          <Field label={t("gpsTracking.f.odometer")}>
            <Input type="number" dir="ltr" step="0.1" min={0} value={form.odometer} onChange={(e) => set("odometer", e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={m.isPending} disabled={!form.vehicle}>{t("gpsTracking.addPosition")}</Button>
        </div>
      </form>
    </Card>
  );
}

interface Prepared {
  rows: Array<CsvPosition & { vehicle_id: string }>;
  problems: string[];
}

function ImportCard() {
  const t = useT();
  const tp = useTp();
  const qc = useQueryClient();
  const toast = useToast();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const errKey: Record<string, MessageKey> = {
    lat: "gpsTracking.err.lat",
    lng: "gpsTracking.err.lng",
    time: "gpsTracking.err.time",
    plate: "gpsTracking.err.plate",
  };

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setPrepared(null);
    setReading(true);
    try {
      const parsed = parsePositionsCsv(await file.text());
      const problems: string[] = [];
      for (const er of parsed.errors) {
        problems.push(er.reason === "columns" ? t("gpsTracking.err.columns") : t(errKey[er.reason], { line: er.line }));
      }
      // Match plates in one bounded query: the file's distinct plates, exact and upper-cased.
      const plates = [...new Set(parsed.rows.flatMap((r) => [r.plate, r.plate.toUpperCase()]))];
      const vehicles = plates.length
        ? await listRows<{ id: string; license_plate: string | null }>("vehicles", (q) =>
            q.select("id, license_plate").in("license_plate", plates).limit(5000),
          )
        : [];
      const byPlate = new Map(vehicles.filter((v) => v.license_plate).map((v) => [plateKey(v.license_plate!), v.id]));
      const latest = Date.now() + 10 * 60_000;
      const rows: Prepared["rows"] = [];
      for (const r of parsed.rows) {
        const id = byPlate.get(plateKey(r.plate));
        if (!id) problems.push(t("gpsTracking.err.unknownPlate", { line: r.line, plate: r.plate }));
        else if (Date.parse(r.recorded_at) > latest) problems.push(t("gpsTracking.err.future", { line: r.line }));
        else rows.push({ ...r, vehicle_id: id });
      }
      setPrepared({ rows, problems });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setReading(false);
    }
  }

  const importM = useMutation({
    mutationFn: async (rows: Prepared["rows"]) => {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        inserted += await insertMany(
          "gps_positions",
          rows.slice(i, i + CHUNK).map((r) => ({
            vehicle_id: r.vehicle_id,
            recorded_at: r.recorded_at,
            lat: r.lat,
            lng: r.lng,
            speed_kmh: r.speed_kmh,
            source: "import",
          })),
          { skipDuplicatesOn: "vehicle_id,recorded_at" },
        );
      }
      return { inserted, skipped: rows.length - inserted };
    },
    onSuccess: ({ inserted, skipped }) => {
      void qc.invalidateQueries({ queryKey: ["gps_positions"] });
      void qc.invalidateQueries({ queryKey: ["vehicle_last_positions"] });
      void qc.invalidateQueries({ queryKey: ["geofence_events"] });
      toast.success(
        skipped > 0 ? `${tp("gpsTracking.imported", inserted)} ${tp("gpsTracking.importedSkipped", skipped)}` : tp("gpsTracking.imported", inserted),
      );
      setPrepared(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink">{t("gpsTracking.importTitle")}</h2>
      <p className="mb-3 mt-1 text-xs text-ink-3">{t("gpsTracking.importHint")}</p>
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-canvas">
        <Upload className="h-4 w-4" /> {t("gpsTracking.chooseFile")}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
      </label>
      {reading && <LoadingState />}
      {prepared && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-ink">{tp("gpsTracking.readyRows", prepared.rows.length)}</p>
          {prepared.problems.length > 0 && (
            <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
              <p className="font-medium">{tp("gpsTracking.problemRows", prepared.problems.length)}</p>
              <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto ps-5 text-xs">
                {prepared.problems.slice(0, 50).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {prepared.rows.length > 0 && (
            <Button onClick={() => importM.mutate(prepared.rows)} loading={importM.isPending}>
              {tp("gpsTracking.importN", prepared.rows.length)}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function PositionsPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [vehicle, setVehicle] = useState("");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Position | null>(null);
  const [actionError, setActionError] = useState("");
  const picker = useVehiclePicker(vehicle);

  const listQ = useQuery({
    queryKey: ["gps_positions", "recent", { page, vehicle, source }],
    queryFn: () =>
      listPage<Position>("gps_positions", page, PAGE_SIZE, (q) => {
        let f = q.select(`id, vehicle_id, recorded_at, lat, lng, speed_kmh, heading, odometer_km, source, ${vehicleEmbed("gps_positions")}`);
        if (vehicle) f = f.eq("vehicle_id", vehicle);
        if (source !== "all") f = f.eq("source", source);
        return f.order("recorded_at", { ascending: false });
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("gps_positions", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["gps_positions"] });
      void qc.invalidateQueries({ queryKey: ["vehicle_last_positions"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(null);
    },
  });

  const sourceLabel = (s: PositionSource) => t(`gpsTracking.source.${s}`);

  const columns: Array<DataTableColumn<Position>> = [
    {
      id: "time",
      header: t("gpsTracking.col.time"),
      cell: (p) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(p.recorded_at, tenant.timezone)}</span>,
      sortValue: (p) => p.recorded_at,
      exportValue: (p) => p.recorded_at,
    },
    {
      id: "vehicle",
      header: t("gpsTracking.col.vehicle"),
      cell: (p) => <Bdi className="font-medium text-ink">{p.vehicle?.name ?? "—"}</Bdi>,
      sortValue: (p) => p.vehicle?.name ?? null,
      exportValue: (p) => p.vehicle?.name ?? "",
    },
    {
      id: "position",
      header: t("gpsTracking.col.position"),
      minBreakpoint: "md",
      cell: (p) => <span className="text-ink-2 tabular-nums">{`${fmtCoord(p.lat)}, ${fmtCoord(p.lng)}`}</span>,
      exportValue: (p) => `${p.lat},${p.lng}`,
      dir: "ltr",
    },
    {
      id: "speed",
      header: t("gpsTracking.col.speed"),
      align: "end",
      minBreakpoint: "sm",
      cell: (p) => (
        <span className="text-ink-2 tabular-nums">
          {p.speed_kmh != null ? t("gpsTracking.speed", { speed: Math.round(Number(p.speed_kmh)) }) : "—"}
        </span>
      ),
      sortValue: (p) => p.speed_kmh,
      exportValue: (p) => p.speed_kmh ?? "",
    },
    {
      id: "source",
      header: t("gpsTracking.col.source"),
      minBreakpoint: "lg",
      cell: (p) => <span className="text-ink-2">{sourceLabel(p.source)}</span>,
      sortValue: (p) => p.source,
      exportValue: (p) => p.source,
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (p) => (
              <button
                className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                onClick={() => setDeleting(p)}
                aria-label={t("gpsTracking.deletePosition")}
                title={t("action.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          } satisfies DataTableColumn<Position>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <p className="min-w-0 flex-1 text-sm text-ink-2">{t("gpsTracking.apiHint")}</p>
        {isEnabled("integrations") && (
          <Link to="/integrations" className="text-sm font-medium text-brand-700 hover:underline">
            {t("gpsTracking.openIntegrations")}
          </Link>
        )}
      </Card>

      <div className={`grid grid-cols-1 gap-4 ${isManager ? "lg:grid-cols-[340px_minmax(0,1fr)]" : ""}`}>
        {isManager && (
          <div className="min-w-0 space-y-4">
            <ManualForm />
            <ImportCard />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("gpsTracking.recentTitle")}</h2>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="w-full max-w-64">
              <Combobox
                {...picker}
                placeholder={t("gpsTracking.allVehicles")}
                value={vehicle}
                onChange={(v) => {
                  setVehicle(v);
                  setPage(0);
                }}
              />
            </div>
            <Select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(0);
              }}
              className="max-w-44"
            >
              <option value="all">{t("common.all")}</option>
              {(["api", "manual", "import"] as const).map((s) => (
                <option key={s} value={s}>{sourceLabel(s)}</option>
              ))}
            </Select>
          </div>
          {actionError && (
            <div className="mb-3">
              <ErrorState message={actionError} />
            </div>
          )}
          {listQ.isLoading && <LoadingState />}
          {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
          {listQ.data && (
            <DataTable<Position>
              tableId="gps-positions"
              exportName="gps-positions"
              rows={listQ.data.rows}
              rowKey={(p) => p.id}
              columns={columns}
              empty={<EmptyState icon={<MapPin className="h-10 w-10" />} title={t("gpsTracking.recentEmpty")} />}
              footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
            />
          )}
        </div>
      </div>

      <Modal title={t("gpsTracking.deletePosition")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("gpsTracking.confirmDeletePosition")}</p>
            <p className="mt-2 text-xs text-ink-3">
              <Bdi>{deleting.vehicle?.name ?? ""}</Bdi> · {formatDateTime(deleting.recorded_at, tenant.timezone)} ·{" "}
              <Ltr>{`${fmtCoord(deleting.lat)}, ${fmtCoord(deleting.lng)}`}</Ltr>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("gpsTracking.deletePosition")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

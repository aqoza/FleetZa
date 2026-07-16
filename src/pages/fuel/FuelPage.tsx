import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fuel, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows } from "../../lib/db";
import {
  computeEfficiency,
  displayToKm,
  displayToLiters,
  efficiencyLabel,
  formatDate,
  formatDistance,
  formatMoney,
  formatVolume,
  litersToDisplay,
} from "../../lib/format";
import type { Driver, FuelLog, Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";

type FuelLogRow = FuelLog & { vehicles: { name: string } | null };

/** Current local date-time formatted for a datetime-local input. */
function nowForInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function FuelForm({
  vehicles,
  drivers,
  onDone,
}: {
  vehicles: Vehicle[];
  drivers: Driver[];
  onDone: () => void;
}) {
  const tenant = useTenant();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    vehicle_id: "",
    driver_id: "",
    filled_at: nowForInput(),
    odometer: "",
    volume: "",
    total_cost: "",
    is_full_tank: true,
    vendor: "",
    notes: "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        vehicle_id: form.vehicle_id,
        driver_id: form.driver_id || null,
        filled_at: new Date(form.filled_at).toISOString(),
        odometer:
          form.odometer.trim() === ""
            ? null
            : displayToKm(Number(form.odometer), tenant.distance_unit),
        volume: displayToLiters(Number(form.volume), tenant.volume_unit),
        total_cost: Number(form.total_cost),
        is_full_tank: form.is_full_tank,
        vendor: form.vendor.trim() || null,
        notes: form.notes.trim() || null,
      };
      return insertRow<FuelLog>("fuel_logs", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fuel_logs"] });
      // DB trigger bumps vehicles.odometer, which feeds service reminders.
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vehicle" required>
          <Select
            value={form.vehicle_id}
            onChange={(e) => set("vehicle_id", e.target.value)}
            required
          >
            <option value="">Select a vehicle…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Driver">
          <Select value={form.driver_id} onChange={(e) => set("driver_id", e.target.value)}>
            <option value="">— None —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.first_name} {d.last_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Filled at" required>
          <Input
            type="datetime-local"
            value={form.filled_at}
            onChange={(e) => set("filled_at", e.target.value)}
            required
          />
        </Field>
        <Field label={`Odometer (${tenant.distance_unit})`}>
          <Input
            type="number"
            min="0"
            step="any"
            value={form.odometer}
            onChange={(e) => set("odometer", e.target.value)}
          />
        </Field>
        <Field label={`Volume (${tenant.volume_unit})`} required>
          <Input
            type="number"
            min="0"
            step="any"
            value={form.volume}
            onChange={(e) => set("volume", e.target.value)}
            required
          />
        </Field>
        <Field label={`Total cost (${tenant.currency})`} required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.total_cost}
            onChange={(e) => set("total_cost", e.target.value)}
            required
          />
        </Field>
        <Field label="Vendor">
          <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.is_full_tank}
            onChange={(e) => set("is_full_tank", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-600"
          />
          Full tank
        </label>
      </div>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Log fuel</Button>
      </div>
    </form>
  );
}

export default function FuelPage() {
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<FuelLogRow | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const { data: logs, isLoading, error } = useQuery({
    queryKey: ["fuel_logs"],
    queryFn: () =>
      listRows<FuelLogRow>("fuel_logs", (q) =>
        q.select("*, vehicles(name)").order("filled_at", { ascending: false }),
      ),
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const { data: drivers } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => listRows<Driver>("drivers", (q) => q.order("first_name")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("fuel_logs", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fuel_logs"] });
      setDeleting(null);
    },
    onError: (err) =>
      setDeleteError(err instanceof Error ? err.message : "Delete failed"),
  });

  /** Efficiency per log id, vs the previous fill-up (next-lower odometer) of the same vehicle. */
  const efficiency = useMemo(() => {
    const map = new Map<string, number | null>();
    const byVehicle = new Map<string, FuelLogRow[]>();
    for (const log of logs ?? []) {
      if (log.odometer === null) continue;
      const group = byVehicle.get(log.vehicle_id);
      if (group) group.push(log);
      else byVehicle.set(log.vehicle_id, [log]);
    }
    for (const group of byVehicle.values()) {
      group.sort((a, b) =>
        a.odometer! !== b.odometer!
          ? a.odometer! - b.odometer!
          : a.filled_at.localeCompare(b.filled_at),
      );
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1];
        const cur = group[i];
        // Partial fills make volume-vs-distance meaningless.
        if (!cur.is_full_tank) {
          map.set(cur.id, null);
          continue;
        }
        map.set(cur.id, computeEfficiency(cur.odometer! - prev.odometer!, cur.volume, tenant));
      }
    }
    return map;
  }, [logs, tenant]);

  const filtered = useMemo(() => {
    if (vehicleFilter === "all") return logs ?? [];
    return (logs ?? []).filter((l) => l.vehicle_id === vehicleFilter);
  }, [logs, vehicleFilter]);

  const totals = useMemo(() => {
    const spend = filtered.reduce((sum, l) => sum + l.total_cost, 0);
    const liters = filtered.reduce((sum, l) => sum + l.volume, 0);
    const displayVolume = litersToDisplay(liters, tenant.volume_unit);
    return {
      spend,
      liters,
      avgPrice: displayVolume > 0 ? spend / displayVolume : null,
    };
  }, [filtered, tenant]);

  function pricePerUnit(log: FuelLogRow): string {
    const displayVolume = litersToDisplay(log.volume, tenant.volume_unit);
    if (displayVolume <= 0) return "—";
    return formatMoney(log.total_cost / displayVolume, tenant.currency);
  }

  function efficiencyCell(log: FuelLogRow): string {
    const eff = efficiency.get(log.id);
    if (eff === null || eff === undefined) return "—";
    return `${eff.toFixed(1)} ${efficiencyLabel(tenant)}`;
  }

  return (
    <>
      <PageHeader
        title="Fuel"
        description={`${logs?.length ?? 0} fuel logs`}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Log fuel
            </Button>
          )
        }
      />

      <div className="mb-4">
        <Select
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
          className="max-w-xs"
        >
          <option value="all">All vehicles</option>
          {vehicles?.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total spend
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatMoney(totals.spend, tenant.currency)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total volume
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatVolume(totals.liters, tenant.volume_unit)}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Avg price / {tenant.volume_unit}
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {formatMoney(totals.avgPrice, tenant.currency)}
            </div>
          </Card>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Fuel className="h-10 w-10" />}
          title={logs?.length ? "No fuel logs for this vehicle" : "No fuel logs yet"}
          description={
            logs?.length
              ? "Try a different vehicle filter."
              : "Log fill-ups to track fuel spend and efficiency per vehicle."
          }
          action={
            isManager && !logs?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Log fuel
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            "Date",
            "Vehicle",
            "Odometer",
            "Volume",
            "Total cost",
            `Price/${tenant.volume_unit}`,
            "Efficiency",
            "Vendor",
            "",
          ]}
        >
          {filtered.map((log) => (
            <tr key={log.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-slate-600">
                {formatDate(log.filled_at, tenant.timezone)}
              </td>
              <td className="px-4 py-3 font-medium text-slate-800">
                {log.vehicles?.name ?? "—"}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatDistance(log.odometer, tenant.distance_unit)}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatVolume(log.volume, tenant.volume_unit)}
              </td>
              <td className="px-4 py-3 font-medium text-slate-800">
                {formatMoney(log.total_cost, tenant.currency)}
              </td>
              <td className="px-4 py-3 text-slate-600">{pricePerUnit(log)}</td>
              <td className="px-4 py-3 text-slate-600">{efficiencyCell(log)}</td>
              <td className="px-4 py-3 text-slate-600">{log.vendor ?? "—"}</td>
              <td className="px-4 py-3 text-right">
                {isManager && (
                  <button
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => {
                      setDeleteError("");
                      setDeleting(log);
                    }}
                    aria-label="Delete fuel log"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal title="Log fuel" open={adding} onClose={() => setAdding(false)} wide>
        {adding && (
          <FuelForm
            vehicles={vehicles ?? []}
            drivers={drivers ?? []}
            onDone={() => setAdding(false)}
          />
        )}
      </Modal>

      <Modal title="Delete fuel log" open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            {deleteError && (
              <div className="mb-3">
                <ErrorState message={deleteError} />
              </div>
            )}
            <p className="text-sm text-slate-600">
              Delete the {formatDate(deleting.filled_at, tenant.timezone)} fuel log for{" "}
              <span className="font-semibold">{deleting.vehicles?.name ?? "this vehicle"}</span> (
              {formatVolume(deleting.volume, tenant.volume_unit)},{" "}
              {formatMoney(deleting.total_cost, tenant.currency)})? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                Delete log
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

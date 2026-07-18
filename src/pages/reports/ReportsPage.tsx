import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, Fuel } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCountry, taxBreakdown } from "../../../shared/countries";
import { listRows } from "../../lib/db";
import {
  computeEfficiency,
  efficiencyLabel,
  formatMoney,
  formatVolume,
  kmToDisplay,
  litersToDisplay,
} from "../../lib/format";
import type { FuelLog, Vehicle, WorkOrder, WorkOrderLine } from "../../lib/types";
import { useTenant } from "../../context/AuthContext";
import {
  Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Select, Table,
} from "../../components/ui";

type FuelLogRow = FuelLog & { vehicles: { name: string } | null };
type WorkOrderRow = WorkOrder & {
  vehicles: { name: string } | null;
  work_order_lines: Array<Pick<WorkOrderLine, "quantity" | "unit_cost">>;
};

interface CostRow {
  vehicleId: string;
  name: string;
  fuel: number;
  maintenance: number;
  total: number;
  costPerDistance: number | null;
}

interface EfficiencyRow {
  vehicleId: string;
  name: string;
  fillUps: number;
  liters: number;
  avgEfficiency: number | null;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const tenant = useTenant();
  const [period, setPeriod] = useState("90");
  const currencyDecimals = getCountry(tenant.country).currencyDecimals;
  const maintenanceHeader =
    getCountry(tenant.country).tax.rate > 0 ? "Maintenance (incl. tax)" : "Maintenance";

  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useQuery({
    queryKey: ["vehicles", "reports"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const { data: fuelLogs, isLoading: fuelLoading, error: fuelError } = useQuery({
    queryKey: ["fuel_logs", "reports"],
    queryFn: () =>
      listRows<FuelLogRow>("fuel_logs", (q) =>
        q.select("*, vehicles(name)").order("filled_at"),
      ),
  });

  const { data: workOrders, isLoading: ordersLoading, error: ordersError } = useQuery({
    queryKey: ["work_orders", "reports", "completed"],
    queryFn: () =>
      listRows<WorkOrderRow>("work_orders", (q) =>
        q
          .select("*, vehicles(name), work_order_lines(quantity, unit_cost)")
          .eq("status", "completed"),
      ),
  });

  const isLoading = vehiclesLoading || fuelLoading || ordersLoading;
  const error = vehiclesError ?? fuelError ?? ordersError;

  const cutoffMs = useMemo(
    () => Date.now() - Number(period) * 86_400_000,
    [period],
  );

  const periodFuel = useMemo(
    () => (fuelLogs ?? []).filter((l) => new Date(l.filled_at).getTime() >= cutoffMs),
    [fuelLogs, cutoffMs],
  );

  const periodOrders = useMemo(
    () =>
      (workOrders ?? []).filter(
        (w) => w.completed_at !== null && new Date(w.completed_at).getTime() >= cutoffMs,
      ),
    [workOrders, cutoffMs],
  );

  const vehicleNames = useMemo(
    () => new Map((vehicles ?? []).map((v) => [v.id, v.name])),
    [vehicles],
  );

  /** Section 1: fuel + maintenance cost per vehicle, sorted by total desc. */
  const costRows = useMemo(() => {
    const byVehicle = new Map<
      string,
      { fuel: number; maintenance: number; odometers: number[] }
    >();
    const entry = (vehicleId: string) => {
      let e = byVehicle.get(vehicleId);
      if (!e) {
        e = { fuel: 0, maintenance: 0, odometers: [] };
        byVehicle.set(vehicleId, e);
      }
      return e;
    };
    for (const log of periodFuel) {
      const e = entry(log.vehicle_id);
      e.fuel += log.total_cost;
      if (log.odometer !== null) e.odometers.push(log.odometer);
    }
    for (const wo of periodOrders) {
      const lineSum = wo.work_order_lines.reduce(
        (sum, line) => sum + line.quantity * line.unit_cost,
        0,
      );
      entry(wo.vehicle_id).maintenance += taxBreakdown(lineSum, wo.tax_rate, currencyDecimals).total;
    }
    const rows: CostRow[] = [];
    for (const [vehicleId, e] of byVehicle) {
      const total = e.fuel + e.maintenance;
      if (total <= 0) continue;
      let costPerDistance: number | null = null;
      if (e.odometers.length >= 2) {
        const distKm = Math.max(...e.odometers) - Math.min(...e.odometers);
        const distance = kmToDisplay(distKm, tenant.distance_unit);
        if (distance > 0) costPerDistance = total / distance;
      }
      rows.push({
        vehicleId,
        name: vehicleNames.get(vehicleId) ?? "Unknown vehicle",
        fuel: e.fuel,
        maintenance: e.maintenance,
        total,
        costPerDistance,
      });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [periodFuel, periodOrders, vehicleNames, tenant, currencyDecimals]);

  /** Section 2: fill-ups, volume, and average full-tank efficiency per vehicle. */
  const efficiencyRows = useMemo(() => {
    const byVehicle = new Map<string, FuelLogRow[]>();
    for (const log of periodFuel) {
      const group = byVehicle.get(log.vehicle_id);
      if (group) group.push(log);
      else byVehicle.set(log.vehicle_id, [log]);
    }
    const rows: EfficiencyRow[] = [];
    for (const [vehicleId, group] of byVehicle) {
      const withOdometer = group.filter((l) => l.odometer !== null);
      withOdometer.sort((a, b) =>
        a.odometer! !== b.odometer!
          ? a.odometer! - b.odometer!
          : a.filled_at.localeCompare(b.filled_at),
      );
      const samples: number[] = [];
      let lastFull: FuelLogRow | null = null;
      let volumeSinceLastFull = 0;
      for (const cur of withOdometer) {
        volumeSinceLastFull += cur.volume;
        if (!cur.is_full_tank) continue;
        if (lastFull) {
          const eff = computeEfficiency(
            cur.odometer! - lastFull.odometer!,
            volumeSinceLastFull,
            tenant,
          );
          if (eff !== null) samples.push(eff);
        }
        lastFull = cur;
        volumeSinceLastFull = 0;
      }
      rows.push({
        vehicleId,
        name: vehicleNames.get(vehicleId) ?? "Unknown vehicle",
        fillUps: group.length,
        liters: group.reduce((sum, l) => sum + l.volume, 0),
        avgEfficiency: samples.length
          ? samples.reduce((sum, v) => sum + v, 0) / samples.length
          : null,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [periodFuel, vehicleNames, tenant]);

  const chartHeight = Math.min(400, 60 + 36 * costRows.length);

  function exportCostCsv() {
    downloadCsv("cost-per-vehicle.csv", [
      ["Vehicle", "Fuel", maintenanceHeader, "Total", `Cost per ${tenant.distance_unit}`],
      ...costRows.map((r) => [
        r.name,
        r.fuel.toFixed(currencyDecimals),
        r.maintenance.toFixed(currencyDecimals),
        r.total.toFixed(currencyDecimals),
        r.costPerDistance === null ? "" : r.costPerDistance.toFixed(currencyDecimals),
      ]),
    ]);
  }

  function exportEfficiencyCsv() {
    downloadCsv("fuel-efficiency.csv", [
      [
        "Vehicle",
        "Fill-ups",
        `Volume (${tenant.volume_unit})`,
        `Avg efficiency (${efficiencyLabel(tenant)})`,
      ],
      ...efficiencyRows.map((r) => [
        r.name,
        r.fillUps,
        litersToDisplay(r.liters, tenant.volume_unit).toFixed(2),
        r.avgEfficiency === null ? "" : r.avgEfficiency.toFixed(1),
      ]),
    ]);
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Cost and fuel efficiency across the fleet"
      />

      <div className="mb-4">
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="max-w-xs"
        >
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 365 days</option>
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Cost per vehicle</h2>
              {costRows.length > 0 && (
                <Button variant="secondary" onClick={exportCostCsv}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
              )}
            </div>

            {costRows.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="h-10 w-10" />}
                title="No costs in this period"
                description="Fuel logs and completed work orders in the selected period will appear here."
              />
            ) : (
              <>
                <Card className="mb-4 p-4">
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart
                      data={costRows}
                      layout="vertical"
                      margin={{ top: 5, right: 20, bottom: 5, left: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: "#64748b", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        tick={{ fill: "#64748b", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        formatter={(value) => formatMoney(Number(value), tenant.currency)}
                      />
                      <Bar
                        dataKey="total"
                        name="Total cost"
                        fill="#1d67f1"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                <Table
                  headers={[
                    "Vehicle",
                    "Fuel",
                    maintenanceHeader,
                    "Total",
                    `Cost / ${tenant.distance_unit}`,
                  ]}
                >
                  {costRows.map((r) => (
                    <tr key={r.vehicleId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatMoney(r.fuel, tenant.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatMoney(r.maintenance, tenant.currency)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {formatMoney(r.total, tenant.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatMoney(r.costPerDistance, tenant.currency)}
                      </td>
                    </tr>
                  ))}
                </Table>
              </>
            )}
          </section>

          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Fuel efficiency</h2>
              {efficiencyRows.length > 0 && (
                <Button variant="secondary" onClick={exportEfficiencyCsv}>
                  <Download className="h-4 w-4" /> Export CSV
                </Button>
              )}
            </div>

            {efficiencyRows.length === 0 ? (
              <EmptyState
                icon={<Fuel className="h-10 w-10" />}
                title="No fuel logs in this period"
                description="Log fill-ups to see per-vehicle fuel volume and efficiency."
              />
            ) : (
              <Table headers={["Vehicle", "Fill-ups", "Volume", "Avg efficiency"]}>
                {efficiencyRows.map((r) => (
                  <tr key={r.vehicleId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.fillUps}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatVolume(r.liters, tenant.volume_unit)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.avgEfficiency === null
                        ? "—"
                        : `${r.avgEfficiency.toFixed(1)} ${efficiencyLabel(tenant)}`}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </>
      )}
    </>
  );
}

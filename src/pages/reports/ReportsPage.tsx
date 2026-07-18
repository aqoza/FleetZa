import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
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
import { GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE, CURSOR_FILL } from "../../lib/chart";
import { getCountry } from "../../../shared/countries";
import { wrapDbError } from "../../lib/db";
import {
  computeEfficiency,
  efficiencyLabel,
  formatMoney,
  formatVolume,
  kmToDisplay,
  litersToDisplay,
} from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import {
  Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Select, Table,
} from "../../components/ui";

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
  const t = useT();
  const tenant = useTenant();
  const { isEnabled } = useModules();
  const customersOn = isEnabled("customers");
  const [period, setPeriod] = useState("90");
  const [owner, setOwner] = useState("company");
  const currencyDecimals = getCountry(tenant.country).currencyDecimals;
  const hasTax = getCountry(tenant.country).tax.rate > 0;
  // On-screen header is translated; the CSV keeps English column headers (stable export).
  const maintenanceHeader = hasTax ? t("reports.maintenanceInclTax") : t("reports.maintenance");
  const maintenanceCsvHeader = hasTax ? "Maintenance (incl. tax)" : "Maintenance";

  // Aggregation runs in Postgres (RLS-scoped, SECURITY INVOKER RPCs). Omitting
  // p_ownership means SQL null = all vehicles (also when the module is off).
  const ownership = customersOn && owner !== "all" ? owner : undefined;
  const rpcArgs = () => ({
    p_from: format(subDays(new Date(), Number(period)), "yyyy-MM-dd"),
    p_to: format(new Date(), "yyyy-MM-dd"),
    p_ownership: ownership,
  });

  const costQ = useQuery({
    queryKey: ["report_cost_by_vehicle", period, ownership ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_cost_by_vehicle", rpcArgs());
      if (error) throw wrapDbError(error);
      return data;
    },
  });

  const efficiencyQ = useQuery({
    queryKey: ["report_fuel_efficiency", period, ownership ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_fuel_efficiency", rpcArgs());
      if (error) throw wrapDbError(error);
      return data;
    },
  });

  const isLoading = costQ.isLoading || efficiencyQ.isLoading;
  const error = costQ.error ?? efficiencyQ.error;

  /** Section 1: fuel + maintenance cost per vehicle (the RPC pre-sorts by total
   *  desc). Cost per distance reuses the efficiency RPC's canonical km. */
  const costRows = useMemo(() => {
    const kmByVehicle = new Map(
      (efficiencyQ.data ?? []).map((r) => [r.vehicle_id, r.total_km]),
    );
    return (costQ.data ?? []).map((r): CostRow => {
      const km = kmByVehicle.get(r.vehicle_id) ?? 0;
      const distance = kmToDisplay(km, tenant.distance_unit);
      return {
        vehicleId: r.vehicle_id,
        name: r.vehicle_name,
        fuel: r.fuel_cost,
        maintenance: r.maintenance_net + r.maintenance_tax,
        total: r.total_cost,
        costPerDistance: distance > 0 ? r.total_cost / distance : null,
      };
    });
  }, [costQ.data, efficiencyQ.data, tenant.distance_unit]);

  /** Section 2: fuel volume and efficiency per vehicle. The RPC returns
   *  canonical km/liters; conversion to tenant units happens on display.
   *  Volume covers ALL fuel logged in the window; the efficiency math uses
   *  only full-tank-to-full-tank segments (pair_liters over total_km) and is
   *  null for vehicles without a complete pair — rendered as a dash. */
  const efficiencyRows = useMemo(
    () =>
      (efficiencyQ.data ?? []).map(
        (r): EfficiencyRow => ({
          vehicleId: r.vehicle_id,
          name: r.vehicle_name,
          liters: r.total_liters,
          avgEfficiency:
            r.pair_liters != null && r.total_km > 0
              ? computeEfficiency(r.total_km, r.pair_liters, tenant)
              : null,
        }),
      ),
    [efficiencyQ.data, tenant],
  );

  const chartHeight = Math.min(400, 60 + 36 * costRows.length);

  function exportCostCsv() {
    downloadCsv("cost-per-vehicle.csv", [
      ["Vehicle", "Fuel", maintenanceCsvHeader, "Total", `Cost per ${tenant.distance_unit}`],
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
        `Volume (${tenant.volume_unit})`,
        `Avg efficiency (${efficiencyLabel(tenant)})`,
      ],
      ...efficiencyRows.map((r) => [
        r.name,
        litersToDisplay(r.liters, tenant.volume_unit).toFixed(2),
        r.avgEfficiency === null ? "" : r.avgEfficiency.toFixed(1),
      ]),
    ]);
  }

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="max-w-xs"
        >
          <option value="30">{t("reports.period30")}</option>
          <option value="90">{t("reports.period90")}</option>
          <option value="365">{t("reports.period365")}</option>
        </Select>
        {customersOn && (
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="max-w-44">
            <option value="company">{t("vehicles.ownerCompany")}</option>
            <option value="customer">{t("vehicles.ownerCustomer")}</option>
            <option value="all">{t("vehicles.allOwners")}</option>
          </Select>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{t("reports.costPerVehicle")}</h2>
              {costRows.length > 0 && (
                <Button variant="secondary" onClick={exportCostCsv}>
                  <Download className="h-4 w-4" /> {t("action.export")}
                </Button>
              )}
            </div>

            {costRows.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="h-10 w-10" />}
                title={t("reports.noCostsTitle")}
                description={t("reports.noCostsDesc")}
              />
            ) : (
              <>
                <Card className="mb-4 p-4">
                  <div dir="ltr">
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart
                      data={costRows}
                      layout="vertical"
                      margin={{ top: 5, right: 20, bottom: 5, left: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                      <XAxis
                        type="number"
                        tick={TICK_STYLE}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        tick={TICK_STYLE}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: CURSOR_FILL }} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                        formatter={(value) => formatMoney(Number(value), tenant.currency)}
                      />
                      <Bar
                        dataKey="total"
                        name={t("reports.totalCost")}
                        fill="#1d67f1"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  </div>
                </Card>

                <Table
                  headers={[
                    t("field.vehicle"),
                    t("reports.fuel"),
                    maintenanceHeader,
                    t("reports.total"),
                    t("reports.costPerDistance", { unit: tenant.distance_unit }),
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
              <h2 className="text-base font-semibold text-slate-900">{t("reports.fuelEfficiency")}</h2>
              {efficiencyRows.length > 0 && (
                <Button variant="secondary" onClick={exportEfficiencyCsv}>
                  <Download className="h-4 w-4" /> {t("action.export")}
                </Button>
              )}
            </div>

            {efficiencyRows.length === 0 ? (
              <EmptyState
                icon={<Fuel className="h-10 w-10" />}
                title={t("reports.noFuelTitle")}
                description={t("reports.noFuelDesc")}
              />
            ) : (
              <Table
                headers={[
                  t("field.vehicle"),
                  t("reports.volume"),
                  t("reports.avgEfficiency"),
                ]}
              >
                {efficiencyRows.map((r) => (
                  <tr key={r.vehicleId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
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

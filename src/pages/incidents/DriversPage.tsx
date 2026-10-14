import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { listRows } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { driverStats, type DriverRow, type DriverStats } from "../../../shared/incidents";
import { useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Bdi, EmptyState, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { driverName } from "./labels";

const YEARS = 3;

interface Row extends DriverStats {
  name: string;
}

export default function DriversPage() {
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const since = useMemo(() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - YEARS);
    return d.toISOString().slice(0, 10);
  }, []);

  const q = useQuery({
    queryKey: ["incidents", "drivers", since],
    queryFn: () =>
      listRows<DriverRow & { driver: { first_name: string; last_name: string } | null }>("incidents", (b) =>
        b.select("occurred_at, incident_type, severity, injuries, actual_cost, estimated_damage, driver_id, at_fault, " +
                 "driver:drivers!incidents_driver_id_fkey(first_name, last_name)")
          .not("driver_id", "is", null).gte("occurred_at", since).limit(10000)),
  });

  const rows = useMemo<Row[]>(() => {
    const names = new Map((q.data ?? []).map((r) => [r.driver_id, driverName(r.driver)]));
    return driverStats(q.data ?? []).map((s) => ({ ...s, name: names.get(s.driverId) ?? "" }));
  }, [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;

  const columns: Array<DataTableColumn<Row>> = [
    {
      id: "driver",
      header: t("incidents.dr.driver"),
      cell: (r) => <Bdi className="font-medium text-ink">{r.name}</Bdi>,
      sortValue: (r) => r.name,
      exportValue: (r) => r.name,
    },
    {
      id: "count",
      header: t("incidents.dr.count"),
      align: "end",
      cell: (r) => <Ltr>{String(r.count)}</Ltr>,
      sortValue: (r) => r.count,
      exportValue: (r) => r.count,
    },
    {
      id: "atFault",
      header: t("incidents.dr.atFault"),
      align: "end",
      cell: (r) => <Ltr className={r.atFault > 0 ? "font-semibold text-serious" : "text-ink-3"}>{String(r.atFault)}</Ltr>,
      sortValue: (r) => r.atFault,
      exportValue: (r) => r.atFault,
    },
    {
      id: "serious",
      header: t("incidents.dr.serious"),
      minBreakpoint: "sm",
      align: "end",
      cell: (r) => <Ltr>{String(r.serious)}</Ltr>,
      sortValue: (r) => r.serious,
      exportValue: (r) => r.serious,
    },
    {
      id: "injuries",
      header: t("incidents.dr.injuries"),
      minBreakpoint: "md",
      align: "end",
      cell: (r) => <Ltr>{String(r.injuries)}</Ltr>,
      sortValue: (r) => r.injuries,
      exportValue: (r) => r.injuries,
    },
    {
      id: "cost",
      header: t("incidents.dr.cost"),
      minBreakpoint: "md",
      align: "end",
      cell: (r) => <span className="whitespace-nowrap">{formatMoney(r.cost, tenant.currency)}</span>,
      sortValue: (r) => r.cost,
      exportValue: (r) => r.cost,
    },
    {
      id: "last",
      header: t("incidents.dr.last"),
      minBreakpoint: "lg",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{formatDate(r.last, tenant.timezone)}</span>,
      sortValue: (r) => r.last,
      exportValue: (r) => r.last,
    },
  ];

  return (
    <div>
      <p className="mb-3 text-sm text-ink-3">{t("incidents.dr.hint")}</p>
      <DataTable<Row>
        tableId="incident_drivers"
        exportName="incident-drivers"
        rows={rows}
        rowKey={(r) => r.driverId}
        columns={columns}
        onRowClick={(r) => navigate(`/incidents/list?driver=${r.driverId}`)}
        empty={<EmptyState icon={<Users className="h-10 w-10" />} title={t("incidents.dr.empty")} description={t("incidents.dr.emptyHint")} />}
      />
    </div>
  );
}

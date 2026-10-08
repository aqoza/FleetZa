import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CalendarClock, Gauge, Info } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Pagination, Select, StatCard } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useHealth } from "./hooks";
import { bandTone, serviceText } from "./labels";
import type { HealthRow } from "./types";

const PAGE_SIZE = 25;

export default function RiskPage() {
  const t = useT();
  const tp = useTp();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const healthQ = useHealth();
  const [band, setBand] = useState("all");
  const [page, setPage] = useState(0);

  const rows = useMemo(
    () =>
      (healthQ.data ?? [])
        .filter((r) => band === "all" || r.band === band)
        .sort((a, b) => b.risk_score - a.risk_score || (a.days_to_service ?? 1e9) - (b.days_to_service ?? 1e9)),
    [healthQ.data, band],
  );
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const ids = pageRows.map((r) => r.vehicle_id).sort();
  const namesQ = useQuery({
    queryKey: ["vehicles", "names", ids],
    enabled: ids.length > 0,
    queryFn: async () =>
      new Map(
        (
          await listRows<{ id: string; name: string; license_plate: string | null }>("vehicles", (q) =>
            q.select("id, name, license_plate").in("id", ids).limit(ids.length),
          )
        ).map((v) => [v.id, v]),
      ),
  });

  const kpi = useMemo(() => {
    const all = healthQ.data ?? [];
    return {
      total: all.length,
      high: all.filter((r) => r.band === "high").length,
      medium: all.filter((r) => r.band === "medium").length,
      dueSoon: all.filter((r) => r.service_overdue || (r.days_to_service != null && r.days_to_service <= 30)).length,
      overdue: all.filter((r) => r.service_overdue).length,
    };
  }, [healthQ.data]);

  const snapshot = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("predictive_snapshot");
      if (error) throw wrapDbError(error);
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ["maintenance_predictions"] });
      toast.success(tp("predictive.snapshotDone", n));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: Array<DataTableColumn<HealthRow>> = [
    {
      id: "vehicle",
      header: t("predictive.col.vehicle"),
      cell: (r) => {
        const v = namesQ.data?.get(r.vehicle_id);
        return (
          <div className="min-w-0">
            <Bdi className="font-medium text-ink">{v?.name ?? "…"}</Bdi>
            {v?.license_plate && <div dir="ltr" className="text-xs text-ink-3 rtl:text-end">{v.license_plate}</div>}
          </div>
        );
      },
      exportValue: (r) => namesQ.data?.get(r.vehicle_id)?.name ?? r.vehicle_id,
    },
    {
      id: "score",
      header: t("predictive.col.score"),
      align: "end",
      cell: (r) => <span className="font-semibold tabular-nums text-ink">{r.risk_score}</span>,
      sortValue: (r) => r.risk_score,
    },
    {
      id: "band",
      header: t("predictive.col.band"),
      cell: (r) => <Badge tone={bandTone[r.band]}>{t(`predictive.band.${r.band}`)}</Badge>,
      sortValue: (r) => r.risk_score,
      exportValue: (r) => r.band,
    },
    {
      id: "factors",
      header: t("predictive.col.factors"),
      minBreakpoint: "md",
      cell: (r) =>
        r.factors.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="text-ink-2">
            {r.factors.slice(0, 2).map((f) => t(`predictive.f.${f.code}`)).join(t("common.listSeparator"))}
            {r.factors.length > 2 && <span className="text-ink-3"> {t("predictive.moreFactors", { count: r.factors.length - 2 })}</span>}
          </span>
        ),
      exportValue: (r) => r.factors.map((f) => f.code).join(" "),
    },
    {
      id: "service",
      header: t("predictive.col.service"),
      minBreakpoint: "sm",
      cell: (r) => (
        <span className={r.service_overdue ? "whitespace-nowrap font-medium text-serious" : "whitespace-nowrap text-ink-2"}>
          {serviceText(r.days_to_service, r.service_overdue, t, tp)}
        </span>
      ),
      sortValue: (r) => r.days_to_service,
      exportValue: (r) => r.days_to_service ?? "",
    },
    {
      id: "usage",
      header: t("predictive.col.usage"),
      align: "end",
      minBreakpoint: "lg",
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums text-ink-2">
          {r.avg_daily_km == null ? t("predictive.noUsage") : t("predictive.kmPerDay", { km: r.avg_daily_km })}
        </span>
      ),
      sortValue: (r) => r.avg_daily_km,
      exportValue: (r) => r.avg_daily_km ?? "",
    },
  ];

  if (healthQ.isLoading) return <LoadingState />;
  if (healthQ.error) return <ErrorState message={(healthQ.error as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="red"
          label={t("predictive.kpi.high")}
          value={kpi.high}
          sub={tp("predictive.kpi.vehicles", kpi.total)}
        />
        <StatCard
          icon={<Gauge className="h-5 w-5" />}
          tone="amber"
          label={t("predictive.kpi.medium")}
          value={kpi.medium}
          sub={tp("predictive.kpi.vehicles", kpi.total)}
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label={t("predictive.kpi.dueSoon")}
          value={kpi.dueSoon}
          sub={kpi.overdue > 0 ? tp("predictive.kpi.overdue", kpi.overdue) : undefined}
          subTone="serious"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={band}
          onChange={(e) => {
            setBand(e.target.value);
            setPage(0);
          }}
          className="max-w-48"
        >
          <option value="all">{t("predictive.allBands")}</option>
          {(["high", "medium", "low"] as const).map((b) => (
            <option key={b} value={b}>{t(`predictive.band.${b}`)}</option>
          ))}
        </Select>
        {isManager && (
          <Button className="ms-auto" variant="secondary" onClick={() => snapshot.mutate()} loading={snapshot.isPending} title={t("predictive.snapshotHint")}>
            <Camera className="h-4 w-4" /> {t("predictive.snapshot")}
          </Button>
        )}
      </div>

      <DataTable<HealthRow>
        tableId="predictive-risk"
        exportName="predictive-risk"
        rows={pageRows}
        rowKey={(r) => r.vehicle_id}
        columns={columns}
        onRowClick={(r) => navigate(`/predictive/vehicles/${r.vehicle_id}`)}
        empty={<EmptyState icon={<Gauge className="h-10 w-10" />} title={t("predictive.riskEmpty")} description={t("predictive.riskEmptyHint")} />}
        footer={<Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />}
      />

      <Card className="flex items-start gap-2 p-4 text-xs text-ink-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{t("predictive.method")}</p>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, CheckCheck } from "lucide-react";
import { listPage, updateRow } from "../../lib/db";
import { OP_SYMBOL } from "../../lib/iot";
import { formatDateTime } from "../../lib/format";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, LoadingState, Modal, Pagination, Select, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useFormatReading } from "./shared";
import { alertStatusTone, severityTone } from "./labels";
import { ALERT_SELECT, type AlertStatus, type IotAlert } from "./types";

const PAGE_SIZE = 25;
const STATUSES: AlertStatus[] = ["open", "acknowledged", "resolved"];

/** Alerts inbox. With `deviceId` it lists that device's alerts (device page). */
export function AlertsTable({ deviceId }: { deviceId?: string }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fmt = useFormatReading();
  // The inbox opens on what needs attention; a device's history shows everything.
  const [status, setStatus] = useState(deviceId ? "all" : "unresolved");
  const [severity, setSeverity] = useState("all");
  const [page, setPage] = useState(0);
  const [resolving, setResolving] = useState<IotAlert | null>(null);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");

  const listQ = useQuery({
    queryKey: ["iot_alerts", { page, status, severity, deviceId }],
    queryFn: () =>
      listPage<IotAlert>("iot_alerts", page, PAGE_SIZE, (q) => {
        let f = q.select(ALERT_SELECT);
        if (status === "unresolved") f = f.in("status", ["open", "acknowledged"]);
        else if (status !== "all") f = f.eq("status", status);
        if (severity !== "all") f = f.eq("severity", severity);
        if (deviceId) f = f.eq("device_id", deviceId);
        return f.order("triggered_at", { ascending: false });
      }),
  });

  const move = useMutation({
    mutationFn: (v: { id: string; status: AlertStatus; note?: string | null }) =>
      updateRow("iot_alerts", v.id, v.note !== undefined ? { status: v.status, note: v.note } : { status: v.status }),
    onSuccess: (_d, v) => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["iot_alerts"] });
      toast.success(t(v.status === "resolved" ? "iot.alertResolved" : "iot.alertAcknowledged"));
      setResolving(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setResolving(null);
    },
  });

  const columns: Array<DataTableColumn<IotAlert>> = [
    {
      id: "time",
      header: t("iot.col.triggered"),
      cell: (a) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(a.triggered_at, tenant.timezone)}</span>,
      sortValue: (a) => a.triggered_at,
      exportValue: (a) => a.triggered_at,
    },
    {
      id: "severity",
      header: t("iot.col.severity"),
      cell: (a) => <Badge tone={severityTone[a.severity]}>{t(`iot.severity.${a.severity}`)}</Badge>,
      sortValue: (a) => ["info", "warning", "critical"].indexOf(a.severity),
      exportValue: (a) => a.severity,
    },
    {
      id: "rule",
      header: t("iot.col.rule"),
      cell: (a) => (
        <div className="min-w-0">
          <Bdi className="font-medium text-ink">{a.rule_name}</Bdi>
          {!deviceId && a.device && (
            <div className="text-xs">
              <Link to={`/iot/devices/${a.device_id}`} className="text-brand-700 hover:underline">
                <Bdi>{a.device.name}</Bdi>
              </Link>
            </div>
          )}
        </div>
      ),
      sortValue: (a) => a.rule_name,
      exportValue: (a) => `${a.rule_name} / ${a.device?.name ?? ""}`,
    },
    {
      id: "value",
      header: t("iot.col.value"),
      minBreakpoint: "sm",
      cell: (a) => (
        <div dir="ltr" className="text-start rtl:text-end">
          <span className="text-xs text-ink-3">{a.metric}</span>{" "}
          <span className="font-semibold tabular-nums text-ink">{fmt(Number(a.value), a.unit)}</span>
          <div className="text-xs text-ink-3">
            {OP_SYMBOL[a.op]} {fmt(Number(a.threshold), a.unit)}
          </div>
        </div>
      ),
      sortValue: (a) => Number(a.value),
      exportValue: (a) => `${a.metric}=${a.value}`,
    },
    {
      id: "status",
      header: t("iot.col.status"),
      cell: (a) => (
        <div className="min-w-0">
          <Badge tone={alertStatusTone[a.status]}>{t(`iot.alertStatus.${a.status}`)}</Badge>
          {a.note && <Bdi className="mt-0.5 block max-w-56 truncate text-xs text-ink-3">{a.note}</Bdi>}
        </div>
      ),
      sortValue: (a) => STATUSES.indexOf(a.status),
      exportValue: (a) => a.status,
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (a) =>
              a.status === "resolved" ? null : (
                <div className="flex justify-end gap-1">
                  {a.status === "open" && (
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      onClick={() => move.mutate({ id: a.id, status: "acknowledged" })}
                      disabled={move.isPending}
                    >
                      <Check className="h-4 w-4" /> {t("iot.acknowledge")}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="px-2.5 py-1 text-xs"
                    onClick={() => {
                      setNote("");
                      setResolving(a);
                    }}
                  >
                    <CheckCheck className="h-4 w-4" /> {t("iot.resolve")}
                  </Button>
                </div>
              ),
          } satisfies DataTableColumn<IotAlert>,
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="max-w-48"
        >
          <option value="unresolved">{`${t("iot.alertStatus.open")} + ${t("iot.alertStatus.acknowledged")}`}</option>
          <option value="all">{t("iot.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`iot.alertStatus.${s}`)}</option>
          ))}
        </Select>
        <Select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(0);
          }}
          className="max-w-44"
        >
          <option value="all">{t("iot.allSeverities")}</option>
          {(["critical", "warning", "info"] as const).map((s) => (
            <option key={s} value={s}>{t(`iot.severity.${s}`)}</option>
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
        <DataTable<IotAlert>
          tableId={deviceId ? "iot-device-alerts" : "iot-alerts"}
          exportName="iot-alerts"
          rows={listQ.data.rows}
          rowKey={(a) => a.id}
          columns={columns}
          empty={<EmptyState icon={<BellRing className="h-10 w-10" />} title={t("iot.alertsEmpty")} description={t("iot.alertsEmptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}

      <Modal title={t("iot.resolveTitle")} open={!!resolving} onClose={() => setResolving(null)}>
        {resolving && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              move.mutate({ id: resolving.id, status: "resolved", note: note.trim() || null });
            }}
          >
            <p className="text-sm text-ink-2">
              <Bdi>{resolving.rule_name}</Bdi> · <Bdi>{resolving.device?.name ?? ""}</Bdi>
            </p>
            <Field label={t("iot.resolveNote")}>
              <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResolving(null)}>{t("action.cancel")}</Button>
              <Button type="submit" loading={move.isPending}>{t("iot.resolve")}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default function AlertsPage() {
  return <AlertsTable />;
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { deleteRow, listPage } from "../../lib/db";
import { OP_SYMBOL, type DeviceType } from "../../lib/iot";
import { useAuth } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, LoadingState, Modal, Pagination } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { RuleForm } from "./RuleForm";
import { severityTone } from "./labels";
import { RULE_SELECT, type AlertRule } from "./types";

const PAGE_SIZE = 25;

/** Alert rules. With `device` it lists the rules that apply to that device. */
export function RulesTable({ device }: { device?: { id: string; device_type: DeviceType } }) {
  const t = useT();
  const tp = useTp();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [actionError, setActionError] = useState("");

  const listQ = useQuery({
    queryKey: ["iot_alert_rules", { page, device: device?.id }],
    queryFn: () =>
      listPage<AlertRule>("iot_alert_rules", page, PAGE_SIZE, (q) => {
        let f = q.select(RULE_SELECT);
        if (device) {
          f = f.or(
            `device_id.eq.${device.id},and(device_id.is.null,device_type.is.null),and(device_id.is.null,device_type.eq.${device.device_type})`,
          );
        }
        return f.order("active", { ascending: false }).order("name");
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("iot_alert_rules", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["iot_alert_rules"] });
      setDeleting(null);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("common.error"));
      setDeleting(null);
    },
  });

  const appliesTo = (r: AlertRule) =>
    r.device_id ? (
      <Link to={`/iot/devices/${r.device_id}`} className="text-brand-700 hover:underline">
        <Bdi>{r.device?.name ?? ""}</Bdi>
      </Link>
    ) : r.device_type ? (
      <span className="text-ink-2">{t("iot.scope.typeLabel", { type: t(`iot.type.${r.device_type}`) })}</span>
    ) : (
      <span className="text-ink-2">{t("iot.scope.all")}</span>
    );

  const columns: Array<DataTableColumn<AlertRule>> = [
    {
      id: "rule",
      header: t("iot.col.rule"),
      cell: (r) => <Bdi className={r.active ? "font-medium text-ink" : "font-medium text-ink-3 line-through"}>{r.name}</Bdi>,
      sortValue: (r) => r.name,
      exportValue: (r) => r.name,
    },
    {
      id: "appliesTo",
      header: t("iot.col.appliesTo"),
      minBreakpoint: "md",
      cell: appliesTo,
      exportValue: (r) => r.device?.name ?? r.device_type ?? "all",
    },
    {
      id: "condition",
      header: t("iot.col.condition"),
      cell: (r) => (
        <span dir="ltr" className="whitespace-nowrap tabular-nums text-ink-2">
          {r.metric} {OP_SYMBOL[r.op]} {Number(r.threshold)}
        </span>
      ),
      exportValue: (r) => `${r.metric} ${r.op} ${r.threshold}`,
    },
    {
      id: "severity",
      header: t("iot.col.severity"),
      cell: (r) => <Badge tone={severityTone[r.severity]}>{t(`iot.severity.${r.severity}`)}</Badge>,
      sortValue: (r) => ["info", "warning", "critical"].indexOf(r.severity),
      exportValue: (r) => r.severity,
    },
    {
      id: "cooldown",
      header: t("iot.col.cooldown"),
      minBreakpoint: "lg",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{tp("iot.cooldownMin", r.cooldown_minutes)}</span>,
      sortValue: (r) => r.cooldown_minutes,
      exportValue: (r) => r.cooldown_minutes,
    },
    {
      id: "active",
      header: t("iot.col.active"),
      minBreakpoint: "sm",
      cell: (r) => <Badge tone={r.active ? "green" : "slate"}>{t(r.active ? "iot.yes" : "iot.no")}</Badge>,
      sortValue: (r) => (r.active ? 1 : 0),
      exportValue: (r) => (r.active ? "yes" : "no"),
    },
    ...(isManager
      ? [
          {
            id: "actions",
            header: "",
            align: "end",
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink"
                  onClick={() => setEditing(r)}
                  aria-label={t("iot.editRule")}
                  title={t("action.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                  onClick={() => setDeleting(r)}
                  aria-label={t("iot.deleteRule")}
                  title={t("action.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ),
          } satisfies DataTableColumn<AlertRule>,
        ]
      : []),
  ];

  return (
    <div>
      {isManager && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("iot.addRule")}
          </Button>
        </div>
      )}
      {actionError && (
        <div className="mb-3">
          <ErrorState message={actionError} />
        </div>
      )}
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<AlertRule>
          tableId={device ? "iot-device-rules" : "iot-rules"}
          exportName="iot-alert-rules"
          rows={listQ.data.rows}
          rowKey={(r) => r.id}
          columns={columns}
          empty={
            <EmptyState icon={<SlidersHorizontal className="h-10 w-10" />} title={t("iot.rulesEmpty")} description={t("iot.rulesEmptyHint")} />
          }
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}

      {(adding || editing) && (
        <RuleForm
          rule={editing}
          device={device}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      <Modal title={t("iot.deleteRule")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-ink-2">{t("iot.confirmDeleteRule")}</p>
            <p className="mt-2 text-xs text-ink-3">
              <Bdi>{deleting.name}</Bdi>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("iot.deleteRule")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default function RulesPage() {
  return <RulesTable />;
}

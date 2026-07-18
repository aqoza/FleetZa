import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { issueStatus, priority } from "../../lib/labels";
import type { Issue, Vehicle, WorkOrder } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";

type IssueRow = Issue & { vehicles: Pick<Vehicle, "name"> | null };

function RowAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ReportIssueForm({ vehicles, onDone }: { vehicles: Vehicle[]; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    vehicle_id: "",
    title: "",
    description: "",
    priority: "normal",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      insertRow<Issue>("issues", {
        vehicle_id: form.vehicle_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["issues"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("issues.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("field.vehicle")} required>
        <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
          <option value="">{t("issues.selectVehicle")}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("issues.fieldTitle")} required>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
      </Field>
      <Field label={t("issues.fieldDescription")}>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label={t("field.priority")}>
        <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
          {Object.entries(priority).map(([v, p]) => (
            <option key={v} value={v}>{t(p.labelKey)}</option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("issues.report")}</Button>
      </div>
    </form>
  );
}

export default function IssuesPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [vehicleId, setVehicleId] = useState("all");
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState<IssueRow | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: issues, isLoading, error } = useQuery({
    queryKey: ["issues"],
    queryFn: () =>
      listRows<IssueRow>("issues", (q) =>
        q.select("*, vehicles(name)").order("reported_at", { ascending: false }),
      ),
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const transition = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      updateRow<Issue>("issues", id, values),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["issues"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : t("issues.updateFailed")),
  });

  const createWo = useMutation({
    mutationFn: async (issue: IssueRow) => {
      const existing = await listRows<WorkOrder>("work_orders", (q) =>
        q.eq("issue_id", issue.id).limit(1),
      );
      const workOrderId =
        existing[0]?.id ??
        (
          await insertRow<WorkOrder>("work_orders", {
            vehicle_id: issue.vehicle_id,
            title: issue.title,
            description: issue.description,
            priority: issue.priority,
            issue_id: issue.id,
          })
        ).id;
      await updateRow<Issue>("issues", issue.id, {
        work_order_id: workOrderId,
        status: "in_progress",
      });
    },
    onSuccess: () => setActionError(""),
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : t("issues.createWoFailed")),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      void qc.invalidateQueries({ queryKey: ["issues"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("issues", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["issues"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("issues.deleteFailed"));
      setDeleting(null);
    },
  });

  const filtered = useMemo(
    () =>
      (issues ?? []).filter((i) => {
        if (status !== "all" && i.status !== status) return false;
        if (vehicleId !== "all" && i.vehicle_id !== vehicleId) return false;
        return true;
      }),
    [issues, status, vehicleId],
  );

  const busy = transition.isPending || createWo.isPending;

  return (
    <>
      <PageHeader
        title={t("issues.title")}
        description={t("issues.reportedCount", { count: issues?.length ?? 0 })}
        actions={
          isManager && (
            <Button onClick={() => setReporting(true)}>
              <Plus className="h-4 w-4" /> {t("issues.report")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-44">
          <option value="all">{t("common.all")}</option>
          {Object.entries(issueStatus).map(([v, s]) => (
            <option key={v} value={v}>{t(s.labelKey)}</option>
          ))}
        </Select>
        <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="max-w-52">
          <option value="all">{t("issues.allVehicles")}</option>
          {vehicles?.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && <ErrorState message={actionError} />}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<AlertTriangle className="h-10 w-10" />}
          title={issues?.length ? t("issues.emptyFilteredTitle") : t("issues.emptyTitle")}
          description={
            issues?.length ? t("issues.emptyFilteredDesc") : t("issues.emptyDesc")
          }
          action={
            isManager && !issues?.length ? (
              <Button onClick={() => setReporting(true)}>
                <Plus className="h-4 w-4" /> {t("issues.report")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table headers={[t("issues.colIssue"), t("field.priority"), t("common.status"), t("issues.colReported"), ""]}>
          {filtered.map((i) => (
            <tr key={i.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800">{i.title}</span>
                  {i.source === "inspection" && <Badge tone="purple">{t("issues.fromInspection")}</Badge>}
                </div>
                <div className="text-xs text-slate-500">{i.vehicles?.name ?? "—"}</div>
              </td>
              <td className="px-4 py-3">
                <Badge tone={priority[i.priority].tone}>{t(priority[i.priority].labelKey)}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge tone={issueStatus[i.status].tone}>{t(issueStatus[i.status].labelKey)}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatDate(i.reported_at, tenant.timezone)}
              </td>
              <td className="px-4 py-3 text-end">
                <div className="flex items-center justify-end gap-1">
                  {i.work_order_id && (
                    <Link
                      to={`/maintenance/work-orders/${i.work_order_id}`}
                      className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:underline"
                    >
                      {t("issues.workOrderLink")}
                    </Link>
                  )}
                  {isManager && (
                    <>
                      {i.status === "open" && (
                        <RowAction
                          disabled={busy}
                          onClick={() =>
                            transition.mutate({ id: i.id, values: { status: "in_progress" } })
                          }
                        >
                          {t("issues.start")}
                        </RowAction>
                      )}
                      {(i.status === "open" || i.status === "in_progress") && (
                        <RowAction
                          disabled={busy}
                          onClick={() =>
                            transition.mutate({
                              id: i.id,
                              values: {
                                status: "resolved",
                                resolved_at: new Date().toISOString(),
                              },
                            })
                          }
                        >
                          {t("issues.resolve")}
                        </RowAction>
                      )}
                      {i.status === "resolved" && (
                        <RowAction
                          disabled={busy}
                          onClick={() =>
                            transition.mutate({ id: i.id, values: { status: "closed" } })
                          }
                        >
                          {t("action.close")}
                        </RowAction>
                      )}
                      {(i.status === "open" || i.status === "in_progress") &&
                        !i.work_order_id && (
                          <RowAction disabled={busy} onClick={() => createWo.mutate(i)}>
                            {t("issues.createWo")}
                          </RowAction>
                        )}
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(i)}
                        aria-label={t("issues.deleteAria", { title: i.title })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal title={t("issues.report")} open={reporting} onClose={() => setReporting(false)} wide>
        <ReportIssueForm vehicles={vehicles ?? []} onDone={() => setReporting(false)} />
      </Modal>

      <Modal title={t("issues.deleteTitle")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("issues.deleteConfirm")} <span className="font-semibold">{deleting.title}</span>
              {t("issues.deleteConfirmUndone")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(deleting.id)}
                loading={remove.isPending}
              >
                {t("issues.deleteTitle")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

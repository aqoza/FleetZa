import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { getCountry, taxBreakdown } from "../../../shared/countries";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import {
  displayToKm, formatDate, formatDateTime, formatDistance, formatMoney, kmToDisplay,
} from "../../lib/format";
import { priority, workOrderStatus } from "../../lib/labels";
import type { WorkOrder, WorkOrderLine } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Badge, Button, Card, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";
import { useT, type MessageKey } from "../../i18n";

type WorkOrderWithVehicle = WorkOrder & {
  vehicles: { name: string; odometer: number } | null;
};

const lineCategories: Record<WorkOrderLine["category"], MessageKey> = {
  labor: "maintenance.lineCategory.labor",
  part: "maintenance.lineCategory.part",
  fee: "maintenance.lineCategory.fee",
  other: "maintenance.lineCategory.other",
};

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-end font-medium text-slate-800">{value}</span>
    </div>
  );
}

function WorkOrderEditForm({
  workOrder,
  onDone,
}: {
  workOrder: WorkOrderWithVehicle;
  onDone: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: workOrder.title,
    description: workOrder.description ?? "",
    priority: workOrder.priority,
    vendor: workOrder.vendor ?? "",
    scheduled_date: workOrder.scheduled_date ?? "",
    odometer:
      workOrder.odometer !== null
        ? Math.round(kmToDisplay(workOrder.odometer, tenant.distance_unit)).toString()
        : "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      updateRow<WorkOrder>("work_orders", workOrder.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        vendor: form.vendor.trim() || null,
        scheduled_date: form.scheduled_date || null,
        odometer: form.odometer
          ? displayToKm(Number(form.odometer), tenant.distance_unit)
          : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      void qc.invalidateQueries({ queryKey: ["service_reminders"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("maintenance.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("maintenance.woTitle")} required>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
      </Field>
      <Field label={t("maintenance.description")}>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.priority")}>
          <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {Object.entries(priority).map(([v, p]) => (
              <option key={v} value={v}>{t(p.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.vendor")}>
          <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
        </Field>
        <Field label={t("maintenance.scheduledDate")}>
          <Input
            type="date"
            value={form.scheduled_date} onChange={(e) => set("scheduled_date", e.target.value)}
          />
        </Field>
        <Field
          label={t("maintenance.odometerUnit", { unit: tenant.distance_unit })}
          hint={
            workOrder.vehicles
              ? t("maintenance.vehicleCurrentlyAt", {
                  distance: formatDistance(workOrder.vehicles.odometer, tenant.distance_unit),
                })
              : undefined
          }
        >
          <Input
            type="number" min={0} step="1"
            value={form.odometer} onChange={(e) => set("odometer", e.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("action.saveChanges")}</Button>
      </div>
    </form>
  );
}

export default function WorkOrderDetailPage() {
  const t = useT();
  const { id = "" } = useParams();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingLine, setDeletingLine] = useState<WorkOrderLine | null>(null);
  const [actionError, setActionError] = useState("");
  const [lineForm, setLineForm] = useState({
    category: "labor",
    description: "",
    quantity: "1",
    unit_cost: "",
  });
  const [lineError, setLineError] = useState("");

  function setLine<K extends keyof typeof lineForm>(key: K, value: string) {
    setLineForm((f) => ({ ...f, [key]: value }));
  }

  const { data: workOrder, isLoading, error } = useQuery({
    queryKey: ["work_orders", id],
    queryFn: async () => {
      const rows = await listRows<WorkOrderWithVehicle>("work_orders", (q) =>
        q.select("*, vehicles(name, odometer)").eq("id", id).limit(1),
      );
      return rows[0] ?? null;
    },
  });

  const { data: lines, isLoading: linesLoading, error: linesError } = useQuery({
    queryKey: ["work_order_lines", id],
    queryFn: () =>
      listRows<WorkOrderLine>("work_order_lines", (q) =>
        q.eq("work_order_id", id).order("created_at"),
      ),
  });

  const setStatus = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      updateRow<WorkOrder>("work_orders", id, values),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : t("maintenance.statusUpdateFailed")),
  });

  const addLine = useMutation({
    mutationFn: () =>
      insertRow<WorkOrderLine>("work_order_lines", {
        work_order_id: id,
        category: lineForm.category,
        description: lineForm.description.trim(),
        quantity: Number(lineForm.quantity) || 0,
        unit_cost: Number(lineForm.unit_cost) || 0,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work_order_lines", id] });
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      setLineForm((f) => ({ ...f, description: "", quantity: "1", unit_cost: "" }));
      setLineError("");
    },
    onError: (err) => setLineError(err instanceof Error ? err.message : t("maintenance.lineAddFailed")),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => deleteRow("work_order_lines", lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work_order_lines", id] });
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      setDeletingLine(null);
    },
    onError: (err) => {
      setLineError(err instanceof Error ? err.message : t("maintenance.lineDeleteFailed"));
      setDeletingLine(null);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRow("work_orders", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["work_orders"] });
      void qc.invalidateQueries({ queryKey: ["issues"] });
      navigate("/maintenance");
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("maintenance.deleteFailed"));
      setConfirmDelete(false);
    },
  });

  function onAddLine(e: FormEvent) {
    e.preventDefault();
    setLineError("");
    addLine.mutate();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!workOrder) return <ErrorState message={t("maintenance.workOrderNotFound")} />;

  const st = workOrderStatus[workOrder.status];
  const pr = priority[workOrder.priority];
  const subtotal = (lines ?? []).reduce((sum, l) => sum + l.quantity * l.unit_cost, 0);
  const currencyDecimals = getCountry(tenant.country).currencyDecimals;
  const { taxAmount, total } = taxBreakdown(subtotal, workOrder.tax_rate, currencyDecimals);
  const taxLabel = getCountry(tenant.country).tax.label;

  return (
    <>
      <Link
        to="/maintenance"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("nav.maintenance")}
      </Link>
      <PageHeader
        title={t("maintenance.workOrderNumber", { number: workOrder.number })}
        description={workOrder.vehicles?.name}
        actions={
          <>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            <Badge tone={pr.tone}>{t(pr.labelKey)}</Badge>
            {isManager && (
              <>
                {workOrder.status === "open" && (
                  <>
                    <Button
                      onClick={() => setStatus.mutate({ status: "in_progress" })}
                      loading={setStatus.isPending}
                    >
                      <Play className="h-4 w-4" /> {t("maintenance.startWork")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ status: "canceled" })}
                    >
                      <Ban className="h-4 w-4" /> {t("action.cancel")}
                    </Button>
                  </>
                )}
                {workOrder.status === "in_progress" && (
                  <>
                    <Button
                      onClick={() =>
                        setStatus.mutate({
                          status: "completed",
                          completed_at: new Date().toISOString(),
                        })
                      }
                      loading={setStatus.isPending}
                    >
                      <Check className="h-4 w-4" /> {t("maintenance.complete")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ status: "canceled" })}
                    >
                      <Ban className="h-4 w-4" /> {t("action.cancel")}
                    </Button>
                  </>
                )}
                {(workOrder.status === "completed" || workOrder.status === "canceled") && (
                  <Button
                    variant="secondary"
                    onClick={() => setStatus.mutate({ status: "open", completed_at: null })}
                    loading={setStatus.isPending}
                  >
                    <RotateCcw className="h-4 w-4" /> {t("maintenance.reopen")}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> {t("action.edit")}
                </Button>
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" /> {t("action.delete")}
                </Button>
              </>
            )}
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{t("maintenance.details")}</h3>
          <InfoRow label={t("maintenance.woTitle")} value={workOrder.title} />
          <InfoRow
            label={t("field.vehicle")}
            value={
              workOrder.vehicles ? (
                <Link
                  to={`/vehicles/${workOrder.vehicle_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {workOrder.vehicles.name}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <InfoRow label={t("field.vendor")} value={workOrder.vendor ?? "—"} />
          <InfoRow label={t("maintenance.scheduled")} value={formatDate(workOrder.scheduled_date)} />
          <InfoRow label={t("field.odometer")} value={formatDistance(workOrder.odometer, tenant.distance_unit)} />
          <InfoRow label={t("maintenance.completed")} value={formatDateTime(workOrder.completed_at, tenant.timezone)} />
          {workOrder.description && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              {workOrder.description}
            </p>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("maintenance.lineItems")}</h3>
          {lineError && (
            <div className="mb-3">
              <ErrorState message={lineError} />
            </div>
          )}
          {linesLoading ? (
            <LoadingState />
          ) : linesError ? (
            <ErrorState message={(linesError as Error).message} />
          ) : (
            <Table
              headers={[
                t("maintenance.category"),
                t("maintenance.description"),
                t("maintenance.qty"),
                t("maintenance.unitCost"),
                t("maintenance.lineTotal"),
                "",
              ]}
            >
              {(lines ?? []).map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{t(lineCategories[l.category])}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{l.description}</td>
                  <td className="px-4 py-3 text-slate-600">{l.quantity}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatMoney(l.unit_cost, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {formatMoney(l.quantity * l.unit_cost, tenant.currency)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {isManager && (
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => setDeletingLine(l)}
                        disabled={removeLine.isPending}
                        aria-label={t("maintenance.deleteAria", { name: l.description })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    {t("maintenance.noLineItems")}
                  </td>
                </tr>
              )}
              {(lines ?? []).length > 0 &&
                (workOrder.tax_rate > 0 ? (
                  <>
                    <tr className="bg-slate-50">
                      <td colSpan={4} className="px-4 py-2 text-end text-slate-600">
                        {t("maintenance.subtotal")}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {formatMoney(subtotal, tenant.currency)}
                      </td>
                      <td />
                    </tr>
                    <tr className="bg-slate-50">
                      <td colSpan={4} className="px-4 py-2 text-end text-slate-600">
                        {t("maintenance.taxLine", { label: taxLabel, rate: workOrder.tax_rate })}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {formatMoney(taxAmount, tenant.currency)}
                      </td>
                      <td />
                    </tr>
                    <tr className="bg-slate-50">
                      <td colSpan={4} className="px-4 py-3 text-end font-semibold text-slate-700">
                        {t("maintenance.total")}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {formatMoney(total, tenant.currency)}
                      </td>
                      <td />
                    </tr>
                  </>
                ) : (
                  <tr className="bg-slate-50">
                    <td colSpan={4} className="px-4 py-3 text-end font-semibold text-slate-700">
                      {t("maintenance.total")}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {formatMoney(total, tenant.currency)}
                    </td>
                    <td />
                  </tr>
                ))}
            </Table>
          )}
          {isManager && (
            <form onSubmit={onAddLine} className="mt-4 flex flex-wrap items-end gap-2">
              <div className="w-32">
                <Field label={t("maintenance.category")}>
                  <Select value={lineForm.category} onChange={(e) => setLine("category", e.target.value)}>
                    {Object.entries(lineCategories).map(([v, labelKey]) => (
                      <option key={v} value={v}>{t(labelKey)}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="min-w-40 flex-1">
                <Field label={t("maintenance.description")}>
                  <Input
                    value={lineForm.description}
                    onChange={(e) => setLine("description", e.target.value)}
                    placeholder={t("maintenance.linePlaceholder")}
                    required
                  />
                </Field>
              </div>
              <div className="w-20">
                <Field label={t("maintenance.qty")}>
                  <Input
                    type="number" min={0} step="0.01" required
                    value={lineForm.quantity}
                    onChange={(e) => setLine("quantity", e.target.value)}
                  />
                </Field>
              </div>
              <div className="w-32">
                <Field label={t("maintenance.unitCostCurrency", { currency: tenant.currency })}>
                  <Input
                    type="number" min={0} step="0.01" required
                    value={lineForm.unit_cost}
                    onChange={(e) => setLine("unit_cost", e.target.value)}
                  />
                </Field>
              </div>
              <Button type="submit" loading={addLine.isPending}>
                <Plus className="h-4 w-4" /> {t("action.add")}
              </Button>
            </form>
          )}
        </Card>
      </div>

      <Modal title={t("maintenance.editWorkOrder")} open={editing} onClose={() => setEditing(false)} wide>
        <WorkOrderEditForm workOrder={workOrder} onDone={() => setEditing(false)} />
      </Modal>

      <Modal title={t("maintenance.deleteWorkOrder")} open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-slate-600">
          {t("maintenance.deleteWorkOrderConfirm", { number: workOrder.number })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
            {t("maintenance.deleteWorkOrder")}
          </Button>
        </div>
      </Modal>

      <Modal
        title={t("maintenance.deleteLineItem")}
        open={deletingLine !== null}
        onClose={() => setDeletingLine(null)}
      >
        <p className="text-sm text-slate-600">
          {t("maintenance.deleteLineConfirm", { description: deletingLine?.description ?? "" })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeletingLine(null)}>{t("action.cancel")}</Button>
          <Button
            variant="danger"
            onClick={() => deletingLine && removeLine.mutate(deletingLine.id)}
            loading={removeLine.isPending}
          >
            {t("maintenance.deleteLineItem")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

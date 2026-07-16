import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { CalendarClock, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate, formatMoney } from "../../lib/format";
import { renewalTypes } from "../../lib/labels";
import type { Renewal, Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";

type RenewalRow = Renewal & { vehicles: Pick<Vehicle, "name"> | null };

function dueDateCell(r: RenewalRow) {
  if (r.completed_at) return <span className="text-slate-600">{formatDate(r.due_date)}</span>;
  const days = daysUntil(r.due_date);
  if (days < 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="red">Overdue</Badge>
        <span className="text-xs text-slate-500">{formatDate(r.due_date)}</span>
      </div>
    );
  }
  if (days <= 30) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="yellow">Due in {days} d</Badge>
        <span className="text-xs text-slate-500">{formatDate(r.due_date)}</span>
      </div>
    );
  }
  return <span className="text-slate-600">{formatDate(r.due_date)}</span>;
}

function RenewalForm({
  renewal,
  vehicles,
  onDone,
}: {
  renewal?: Renewal;
  vehicles: Vehicle[];
  onDone: () => void;
}) {
  const tenant = useTenant();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    vehicle_id: renewal?.vehicle_id ?? "",
    renewal_type: renewal?.renewal_type ?? "registration",
    name: renewal?.name ?? "",
    due_date: renewal?.due_date ?? "",
    amount: renewal?.amount != null ? String(renewal.amount) : "",
    recurrence_months: renewal?.recurrence_months != null ? String(renewal.recurrence_months) : "",
    notes: renewal?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        vehicle_id: form.vehicle_id,
        renewal_type: form.renewal_type,
        name: form.name.trim() || null,
        due_date: form.due_date,
        amount: form.amount === "" ? null : Number(form.amount),
        recurrence_months: form.recurrence_months === "" ? null : Number(form.recurrence_months),
        notes: form.notes.trim() || null,
      };
      return renewal
        ? updateRow<Renewal>("renewals", renewal.id, values)
        : insertRow<Renewal>("renewals", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["renewals"] });
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
          <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
            <option value="">Select vehicle…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={form.renewal_type} onChange={(e) => set("renewal_type", e.target.value)}>
            {Object.entries(renewalTypes).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Name" hint="Optional custom label, e.g. insurer or permit name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Due date" required>
          <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} required />
        </Field>
        <Field label={`Amount (${tenant.currency})`}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field label="Recurs every (months)" hint="Leave empty for one-time">
          <Input
            type="number"
            min="1"
            step="1"
            value={form.recurrence_months}
            onChange={(e) => set("recurrence_months", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {renewal ? "Save changes" : "Add renewal"}
        </Button>
      </div>
    </form>
  );
}

export default function RenewalsPage() {
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RenewalRow | null>(null);
  const [deleting, setDeleting] = useState<RenewalRow | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: renewals, isLoading, error } = useQuery({
    queryKey: ["renewals"],
    queryFn: () =>
      listRows<RenewalRow>("renewals", (q) => q.select("*, vehicles(name)").order("due_date")),
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.order("name")),
  });

  const complete = useMutation({
    mutationFn: async (r: RenewalRow) => {
      if (r.recurrence_months) {
        const nextDue = format(
          addMonths(new Date(`${r.due_date.slice(0, 10)}T00:00:00`), r.recurrence_months),
          "yyyy-MM-dd",
        );
        // Idempotency guard: a retried completion (insert ok, update failed)
        // must not insert a duplicate next occurrence.
        const existing = await listRows<Renewal>("renewals", (q) =>
          q
            .eq("vehicle_id", r.vehicle_id)
            .eq("renewal_type", r.renewal_type)
            .eq("due_date", nextDue)
            .limit(1),
        );
        if (existing.length === 0) {
          await insertRow<Renewal>("renewals", {
            vehicle_id: r.vehicle_id,
            renewal_type: r.renewal_type,
            name: r.name,
            amount: r.amount,
            recurrence_months: r.recurrence_months,
            notes: r.notes,
            due_date: nextDue,
          });
        }
      }
      await updateRow<Renewal>("renewals", r.id, {
        completed_at: format(new Date(), "yyyy-MM-dd"),
      });
    },
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["renewals"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Failed to mark renewal complete"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("renewals", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["renewals"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to delete renewal");
      setDeleting(null);
    },
  });

  const filtered = useMemo(
    () =>
      (renewals ?? []).filter((r) => {
        if (statusFilter === "pending" && r.completed_at) return false;
        if (statusFilter === "completed" && !r.completed_at) return false;
        if (vehicleFilter !== "all" && r.vehicle_id !== vehicleFilter) return false;
        return true;
      }),
    [renewals, statusFilter, vehicleFilter],
  );

  return (
    <>
      <PageHeader
        title="Renewals"
        description="Registrations, insurance, permits and other expiring documents"
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add renewal
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-44">
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="all">All</option>
        </Select>
        <Select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="max-w-44">
          <option value="all">All vehicles</option>
          {vehicles?.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<CalendarClock className="h-10 w-10" />}
          title={renewals?.length ? "No renewals match your filters" : "No renewals yet"}
          description={
            renewals?.length
              ? "Try a different status or vehicle filter."
              : "Track registrations, insurance and permits so nothing expires unnoticed."
          }
          action={
            isManager && !renewals?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add renewal
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table headers={["Type", "Vehicle", "Due date", "Amount", "Recurs", "Status", ""]}>
          {filtered.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">
                  {r.name ?? renewalTypes[r.renewal_type]}
                </div>
                {r.name && (
                  <div className="text-xs text-slate-500">{renewalTypes[r.renewal_type]}</div>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{r.vehicles?.name ?? "—"}</td>
              <td className="px-4 py-3">{dueDateCell(r)}</td>
              <td className="px-4 py-3 text-slate-600">{formatMoney(r.amount, tenant.currency)}</td>
              <td className="px-4 py-3 text-slate-600">
                {r.recurrence_months ? `Every ${r.recurrence_months} mo` : "—"}
              </td>
              <td className="px-4 py-3">
                {r.completed_at ? (
                  <Badge tone="green">Completed {formatDate(r.completed_at)}</Badge>
                ) : (
                  <Badge tone="blue">Pending</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {isManager && (
                  <div className="flex justify-end gap-1">
                    {!r.completed_at && (
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50"
                        onClick={() => complete.mutate(r)}
                        disabled={complete.isPending}
                        aria-label="Mark complete"
                        title="Mark complete"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setEditing(r)}
                      aria-label="Edit renewal"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleting(r)}
                      aria-label="Delete renewal"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal title="Add renewal" open={adding} onClose={() => setAdding(false)} wide>
        <RenewalForm vehicles={vehicles ?? []} onDone={() => setAdding(false)} />
      </Modal>

      <Modal title="Edit renewal" open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <RenewalForm renewal={editing} vehicles={vehicles ?? []} onDone={() => setEditing(null)} />
        )}
      </Modal>

      <Modal title="Delete renewal" open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              Delete the{" "}
              <span className="font-semibold">
                {deleting.name ?? renewalTypes[deleting.renewal_type]}
              </span>{" "}
              renewal{deleting.vehicles ? ` for ${deleting.vehicles.name}` : ""}? This cannot be
              undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                Delete renewal
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { CalendarClock, Check, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { getCountry } from "../../../shared/countries";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate, formatMoney } from "../../lib/format";
import { renewalTypes } from "../../lib/labels";
import type { Renewal, Vehicle } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, type Translate } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";

type RenewalRow = Renewal & { vehicles: Pick<Vehicle, "name"> | null };

function dueDateCell(r: RenewalRow, t: Translate) {
  if (r.completed_at) return <span className="text-slate-600">{formatDate(r.due_date)}</span>;
  const days = daysUntil(r.due_date);
  if (days < 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="red">{t("renewals.overdue")}</Badge>
        <span className="text-xs text-slate-500">{formatDate(r.due_date)}</span>
      </div>
    );
  }
  if (days <= 30) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="yellow">{t("renewals.dueInDays", { count: days })}</Badge>
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
  const t = useT();
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
    onError: (err) => setError(err instanceof Error ? err.message : t("renewals.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.vehicle")} required>
          <Select value={form.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} required>
            <option value="">{t("renewals.selectVehicle")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("renewals.type")}>
          <Select value={form.renewal_type} onChange={(e) => set("renewal_type", e.target.value)}>
            {Object.entries(renewalTypes).map(([v, labelKey]) => (
              <option key={v} value={v}>{t(labelKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("field.name")} hint={t("renewals.nameHint")}>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("field.dueDate")} required>
          <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} required />
        </Field>
        <Field label={t("renewals.amountLabel", { currency: tenant.currency })}>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field label={t("renewals.recurEvery")} hint={t("renewals.recurHint")}>
          <Input
            type="number"
            min="1"
            step="1"
            value={form.recurrence_months}
            onChange={(e) => set("recurrence_months", e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {renewal ? t("action.saveChanges") : t("renewals.addRenewal")}
        </Button>
      </div>
    </form>
  );
}

function CountryDefaultsForm({
  vehicles,
  onDone,
}: {
  vehicles: Vehicle[];
  onDone: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const country = getCountry(tenant.country);
  const catalog = country.regulations.renewals;
  const notes = country.regulations.notes;
  const [vehicleId, setVehicleId] = useState("");
  const [result, setResult] = useState<{ added: number } | null>(null);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      // Dedup against the server, not the client cache: the `renewals` query can
      // be empty or stale here, which would cause duplicate inserts.
      const current = await listRows<Renewal>("renewals", (q) =>
        q.eq("vehicle_id", vehicleId).is("completed_at", null),
      );
      const missing = catalog.filter(
        (entry) => !current.some((r) => r.renewal_type === entry.type),
      );
      for (const entry of missing) {
        await insertRow<Renewal>("renewals", {
          vehicle_id: vehicleId,
          renewal_type: entry.type,
          name: entry.label,
          due_date: format(addMonths(new Date(), entry.months), "yyyy-MM-dd"),
          recurrence_months: entry.months,
        });
      }
      return missing.length;
    },
    onSuccess: (added) => {
      setError("");
      setResult({ added });
      if (added > 0) void qc.invalidateQueries({ queryKey: ["renewals"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("renewals.addDefaultsFailed"));
      // Some inserts may have landed before the failure — refresh the list.
      void qc.invalidateQueries({ queryKey: ["renewals"] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("field.vehicle")} required>
        <Select
          value={vehicleId}
          onChange={(e) => {
            setVehicleId(e.target.value);
            setResult(null);
          }}
          required
        >
          <option value="">{t("renewals.selectVehicle")}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </Select>
      </Field>
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {t("renewals.standardFor", { country: country.name })}
        </span>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50">
          {catalog.map((entry) => (
            <li key={entry.type} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-slate-700">{entry.label}</span>
              <span className="whitespace-nowrap text-xs text-slate-500">
                {t("renewals.everyMonthsLong", { count: entry.months })}
              </span>
            </li>
          ))}
        </ul>
        {notes?.map((note) => (
          <p key={note} className="mt-2 text-xs text-slate-500">{note}</p>
        ))}
      </div>
      {result && (
        <p
          className={
            result.added > 0 ? "text-sm font-medium text-emerald-700" : "text-sm text-slate-600"
          }
        >
          {result.added > 0
            ? t("renewals.addedN", { count: result.added })
            : t("renewals.allExist")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.close")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("action.create")}</Button>
      </div>
    </form>
  );
}

export default function RenewalsPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [addingDefaults, setAddingDefaults] = useState(false);
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
        // must not insert a duplicate next occurrence. Match on name too so two
        // same-type chains with different names both roll over.
        const existing = await listRows<Renewal>("renewals", (q) => {
          let query = q
            .eq("vehicle_id", r.vehicle_id)
            .eq("renewal_type", r.renewal_type)
            .eq("due_date", nextDue);
          query = r.name !== null ? query.eq("name", r.name) : query.is("name", null);
          return query.limit(1);
        });
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
      setActionError(err instanceof Error ? err.message : t("renewals.completeFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("renewals", id),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["renewals"] });
      setDeleting(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("renewals.deleteFailed"));
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
        title={t("renewals.title")}
        description={t("renewals.description")}
        actions={
          isManager && (
            <>
              <Button variant="secondary" onClick={() => setAddingDefaults(true)}>
                <ShieldCheck className="h-4 w-4" /> {t("renewals.addDefaults")}
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("renewals.addRenewal")}
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-44">
          <option value="pending">{t("renewals.statusPending")}</option>
          <option value="completed">{t("renewals.statusCompleted")}</option>
          <option value="all">{t("common.all")}</option>
        </Select>
        <Select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="max-w-44">
          <option value="all">{t("renewals.allVehicles")}</option>
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
          title={renewals?.length ? t("renewals.emptyFilteredTitle") : t("renewals.emptyTitle")}
          description={
            renewals?.length
              ? t("renewals.emptyFilteredDesc")
              : t("renewals.emptyDesc")
          }
          action={
            isManager && !renewals?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("renewals.addRenewal")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            t("renewals.type"),
            t("field.vehicle"),
            t("field.dueDate"),
            t("field.amount"),
            t("renewals.recurs"),
            t("common.status"),
            "",
          ]}
        >
          {filtered.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">
                  {r.name ?? t(renewalTypes[r.renewal_type])}
                </div>
                {r.name && (
                  <div className="text-xs text-slate-500">{t(renewalTypes[r.renewal_type])}</div>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{r.vehicles?.name ?? "—"}</td>
              <td className="px-4 py-3">{dueDateCell(r, t)}</td>
              <td className="px-4 py-3 text-slate-600">{formatMoney(r.amount, tenant.currency)}</td>
              <td className="px-4 py-3 text-slate-600">
                {r.recurrence_months
                  ? t("renewals.everyMonthsShort", { count: r.recurrence_months })
                  : "—"}
              </td>
              <td className="px-4 py-3">
                {r.completed_at ? (
                  <Badge tone="green">
                    {t("renewals.completedOn", { date: formatDate(r.completed_at) })}
                  </Badge>
                ) : (
                  <Badge tone="blue">{t("renewals.statusPending")}</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-end">
                {isManager && (
                  <div className="flex justify-end gap-1">
                    {!r.completed_at && (
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50"
                        onClick={() => complete.mutate(r)}
                        disabled={complete.isPending}
                        aria-label={t("action.markComplete")}
                        title={t("action.markComplete")}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setEditing(r)}
                      aria-label={t("renewals.editRenewal")}
                      title={t("action.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleting(r)}
                      aria-label={t("renewals.deleteRenewal")}
                      title={t("action.delete")}
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

      <Modal title={t("renewals.addRenewal")} open={adding} onClose={() => setAdding(false)} wide>
        <RenewalForm vehicles={vehicles ?? []} onDone={() => setAdding(false)} />
      </Modal>

      <Modal
        title={t("renewals.addDefaults")}
        open={addingDefaults}
        onClose={() => setAddingDefaults(false)}
      >
        <CountryDefaultsForm
          vehicles={vehicles ?? []}
          onDone={() => setAddingDefaults(false)}
        />
      </Modal>

      <Modal title={t("renewals.editRenewal")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && (
          <RenewalForm renewal={editing} vehicles={vehicles ?? []} onDone={() => setEditing(null)} />
        )}
      </Modal>

      <Modal title={t("renewals.deleteRenewal")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("renewals.deleteLead")}
              <span className="font-semibold">
                {deleting.name ?? t(renewalTypes[deleting.renewal_type])}
              </span>
              {deleting.vehicles
                ? t("renewals.deleteRestVehicle", { vehicle: deleting.vehicles.name })
                : t("renewals.deleteRestNoVehicle")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("renewals.deleteRenewal")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

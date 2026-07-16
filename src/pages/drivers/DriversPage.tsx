import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate } from "../../lib/format";
import type { Driver } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";

function licenseBadge(expiry: string | null) {
  if (!expiry) return <span className="text-slate-400">—</span>;
  const days = daysUntil(expiry);
  if (days < 0) return <Badge tone="red">Expired {formatDate(expiry)}</Badge>;
  if (days <= 30) return <Badge tone="yellow">Expires {formatDate(expiry)}</Badge>;
  return <span className="text-slate-600">{formatDate(expiry)}</span>;
}

function DriverForm({ driver, onDone }: { driver?: Driver; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: driver?.first_name ?? "",
    last_name: driver?.last_name ?? "",
    email: driver?.email ?? "",
    phone: driver?.phone ?? "",
    license_number: driver?.license_number ?? "",
    license_class: driver?.license_class ?? "",
    license_expiry: driver?.license_expiry ?? "",
    hire_date: driver?.hire_date ?? "",
    status: driver?.status ?? "active",
    notes: driver?.notes ?? "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        license_number: form.license_number.trim() || null,
        license_class: form.license_class.trim() || null,
        license_expiry: form.license_expiry || null,
        hire_date: form.hire_date || null,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      return driver
        ? updateRow<Driver>("drivers", driver.id, values)
        : insertRow<Driver>("drivers", values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["drivers"] });
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
        <Field label="First name" required>
          <Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} required />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="License number">
          <Input value={form.license_number} onChange={(e) => set("license_number", e.target.value)} />
        </Field>
        <Field label="License class">
          <Input value={form.license_class} onChange={(e) => set("license_class", e.target.value)} />
        </Field>
        <Field label="License expiry">
          <Input type="date" value={form.license_expiry} onChange={(e) => set("license_expiry", e.target.value)} />
        </Field>
        <Field label="Hire date">
          <Input type="date" value={form.hire_date} onChange={(e) => set("hire_date", e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {driver ? "Save changes" : "Add driver"}
        </Button>
      </div>
    </form>
  );
}

export default function DriversPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [deleting, setDeleting] = useState<Driver | null>(null);

  const { data: drivers, isLoading, error } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => listRows<Driver>("drivers", (q) => q.order("first_name")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("drivers", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["drivers"] });
      setDeleting(null);
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return drivers ?? [];
    return (drivers ?? []).filter((d) =>
      [d.first_name, d.last_name, d.email, d.phone, d.license_number]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(term)),
    );
  }, [drivers, search]);

  return (
    <>
      <PageHeader
        title="Drivers"
        description={`${drivers?.length ?? 0} drivers`}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add driver
            </Button>
          )
        }
      />

      <div className="mb-4">
        <Input
          placeholder="Search drivers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title={drivers?.length ? "No drivers match your search" : "No drivers yet"}
          description={
            drivers?.length ? undefined : "Add drivers so you can assign vehicles and track licenses."
          }
          action={
            isManager && !drivers?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add driver
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table headers={["Name", "Contact", "License", "License expiry", "Status", ""]}>
          {filtered.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-800">
                {d.first_name} {d.last_name}
              </td>
              <td className="px-4 py-3 text-slate-600">
                <div>{d.email ?? "—"}</div>
                <div className="text-xs text-slate-500">{d.phone ?? ""}</div>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {d.license_number ?? "—"}
                {d.license_class && <span className="text-xs text-slate-400"> ({d.license_class})</span>}
              </td>
              <td className="px-4 py-3">{licenseBadge(d.license_expiry)}</td>
              <td className="px-4 py-3">
                <Badge tone={d.status === "active" ? "green" : "slate"}>
                  {d.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                {isManager && (
                  <div className="flex justify-end gap-1">
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setEditing(d)}
                      aria-label={`Edit ${d.first_name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleting(d)}
                      aria-label={`Delete ${d.first_name}`}
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

      <Modal title="Add driver" open={adding} onClose={() => setAdding(false)} wide>
        <DriverForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal title="Edit driver" open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <DriverForm driver={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal title="Delete driver" open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              Delete <span className="font-semibold">{deleting.first_name} {deleting.last_name}</span>?
              Their assignment history will also be removed.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                Delete driver
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

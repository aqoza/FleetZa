import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { deleteRow, insertRow, listRows, updateRow } from "../../lib/db";
import { daysUntil, formatDate } from "../../lib/format";
import { driverStatus } from "../../lib/labels";
import type { Driver } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useT, type Translate } from "../../i18n";
import {
  Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table, Textarea,
} from "../../components/ui";

function licenseBadge(expiry: string | null, t: Translate) {
  if (!expiry) return <span className="text-slate-400">—</span>;
  const days = daysUntil(expiry);
  if (days < 0)
    return <Badge tone="red">{t("drivers.licenseExpired", { date: formatDate(expiry) })}</Badge>;
  if (days <= 30)
    return <Badge tone="yellow">{t("drivers.licenseExpires", { date: formatDate(expiry) })}</Badge>;
  return <span className="text-slate-600">{formatDate(expiry)}</span>;
}

function DriverForm({ driver, onDone }: { driver?: Driver; onDone: () => void }) {
  const t = useT();
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
    onError: (err) => setError(err instanceof Error ? err.message : t("drivers.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("drivers.firstName")} required>
          <Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} required />
        </Field>
        <Field label={t("drivers.lastName")}>
          <Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("drivers.licenseNumber")}>
          <Input value={form.license_number} onChange={(e) => set("license_number", e.target.value)} />
        </Field>
        <Field label={t("drivers.licenseClass")}>
          <Input value={form.license_class} onChange={(e) => set("license_class", e.target.value)} />
        </Field>
        <Field label={t("drivers.licenseExpiry")}>
          <Input type="date" value={form.license_expiry} onChange={(e) => set("license_expiry", e.target.value)} />
        </Field>
        <Field label={t("drivers.hireDate")}>
          <Input type="date" value={form.hire_date} onChange={(e) => set("hire_date", e.target.value)} />
        </Field>
        <Field label={t("field.status")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {Object.entries(driverStatus).map(([value, s]) => (
              <option key={value} value={value}>{t(s.labelKey)}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {driver ? t("action.saveChanges") : t("drivers.addDriver")}
        </Button>
      </div>
    </form>
  );
}

export default function DriversPage() {
  const t = useT();
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
        title={t("drivers.title")}
        description={t("drivers.countDrivers", { count: drivers?.length ?? 0 })}
        actions={
          isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> {t("drivers.addDriver")}
            </Button>
          )
        }
      />

      <div className="mb-4">
        <Input
          placeholder={t("drivers.searchPlaceholder")}
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
          title={drivers?.length ? t("drivers.noMatch") : t("drivers.empty")}
          description={drivers?.length ? undefined : t("drivers.emptyHint")}
          action={
            isManager && !drivers?.length ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> {t("drivers.addDriver")}
              </Button>
            ) : undefined
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Table
          headers={[
            t("field.name"),
            t("drivers.contact"),
            t("drivers.license"),
            t("drivers.licenseExpiry"),
            t("common.status"),
            "",
          ]}
        >
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
              <td className="px-4 py-3">{licenseBadge(d.license_expiry, t)}</td>
              <td className="px-4 py-3">
                <Badge tone={driverStatus[d.status].tone}>{t(driverStatus[d.status].labelKey)}</Badge>
              </td>
              <td className="px-4 py-3 text-end">
                {isManager && (
                  <div className="flex justify-end gap-1">
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => setEditing(d)}
                      aria-label={t("drivers.editAria", { name: d.first_name })}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setDeleting(d)}
                      aria-label={t("drivers.deleteAria", { name: d.first_name })}
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

      <Modal title={t("drivers.addDriver")} open={adding} onClose={() => setAdding(false)} wide>
        <DriverForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal title={t("drivers.editDriver")} open={!!editing} onClose={() => setEditing(null)} wide>
        {editing && <DriverForm driver={editing} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal title={t("drivers.deleteDriver")} open={!!deleting} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p className="text-sm text-slate-600">
              {t("drivers.deleteConfirmBefore")}{" "}
              <span className="font-semibold">{deleting.first_name} {deleting.last_name}</span>
              {t("drivers.deleteConfirmAfter")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate(deleting.id)} loading={remove.isPending}>
                {t("drivers.deleteDriver")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

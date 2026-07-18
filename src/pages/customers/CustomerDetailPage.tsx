import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Star, Trash2, Unlink } from "lucide-react";
import { deleteRow, getRow, insertRow, listRows, updateRow } from "../../lib/db";
import { recordRecent } from "../../lib/recent";
import { daysUntil, formatDate } from "../../lib/format";
import type {
  Contact, Customer, SlJob, SlJobStatus, SlJobType, SpeedLimiterCertificate,
  SpeedLimiterInstallation, Vehicle,
} from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey } from "../../i18n";
import {
  Badge, Button, Card, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table,
  Textarea, type BadgeTone,
} from "../../components/ui";
import { CustomerForm, customerStatusMeta } from "./CustomersPage";

type JobRow = SlJob & { vehicles: Pick<Vehicle, "name"> | null };
type CertRow = SpeedLimiterCertificate & { vehicles: Pick<Vehicle, "name"> | null };

// Shared enum keys — defined in the speedLimiters namespace by the hub.
const jobTypeKeys: Record<SlJobType, MessageKey> = {
  installation: "speedLimiters.jobType.installation",
  inspection: "speedLimiters.jobType.inspection",
  maintenance: "speedLimiters.jobType.maintenance",
  removal: "speedLimiters.jobType.removal",
  replacement: "speedLimiters.jobType.replacement",
  emergency: "speedLimiters.jobType.emergency",
};

const jobStatusMeta: Record<SlJobStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  scheduled: { labelKey: "speedLimiters.jobStatus.scheduled", tone: "blue" },
  in_progress: { labelKey: "speedLimiters.jobStatus.in_progress", tone: "yellow" },
  completed: { labelKey: "speedLimiters.jobStatus.completed", tone: "green" },
  qc_approved: { labelKey: "speedLimiters.jobStatus.qc_approved", tone: "purple" },
  closed: { labelKey: "speedLimiters.jobStatus.closed", tone: "slate" },
  canceled: { labelKey: "speedLimiters.jobStatus.canceled", tone: "red" },
};

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </Card>
  );
}

function ContactForm({
  customerId,
  contact,
  contacts,
  onDone,
}: {
  customerId: string;
  contact?: Contact;
  contacts: Contact[];
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    department: contact?.department ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    whatsapp: contact?.whatsapp ?? "",
    notes: contact?.notes ?? "",
  });
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? contacts.length === 0);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Only one primary per customer: demote the previous primary first.
      if (isPrimary) {
        const others = contacts.filter((c) => c.is_primary && c.id !== contact?.id);
        for (const prev of others) {
          await updateRow<Contact>("contacts", prev.id, { is_primary: false });
        }
      }
      const values = {
        name: form.name.trim(),
        title: form.title.trim() || null,
        department: form.department.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        is_primary: isPrimary,
        notes: form.notes.trim() || null,
      };
      return contact
        ? updateRow<Contact>("contacts", contact.id, values)
        : insertRow<Contact>("contacts", { ...values, customer_id: customerId });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("customers.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("field.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label={t("customers.contactTitle")}>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label={t("customers.department")}>
          <Input value={form.department} onChange={(e) => set("department", e.target.value)} />
        </Field>
        <Field label={t("field.email")}>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t("field.phone")}>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t("customers.whatsapp")}>
          <Input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        {t("customers.primaryContact")}
      </label>
      <Field label={t("field.notes")}>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>
          {contact ? t("action.saveChanges") : t("customers.addContact")}
        </Button>
      </div>
    </form>
  );
}

function AttachVehicleForm({
  customerId,
  onDone,
}: {
  customerId: string;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState("");

  const { data: unassigned, isLoading, error: loadError } = useQuery({
    queryKey: ["vehicles", "unassigned"],
    queryFn: () => listRows<Vehicle>("vehicles", (q) => q.is("customer_id", null).order("name")),
  });

  const mutation = useMutation({
    mutationFn: () => updateRow<Vehicle>("vehicles", vehicleId, { customer_id: customerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("customers.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  if (isLoading) return <LoadingState />;
  if (loadError) return <ErrorState message={(loadError as Error).message} />;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      {(unassigned ?? []).length === 0 ? (
        <p className="text-sm text-slate-600">{t("customers.noUnassignedVehicles")}</p>
      ) : (
        <Field label={t("customers.attachExistingLabel")} required>
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">{t("customers.selectVehicle")}</option>
            {(unassigned ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{v.license_plate ? ` — ${v.license_plate}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-xs text-slate-500">
        {t("customers.createVehicleHint")}{" "}
        <Link to="/vehicles" className="font-medium text-brand-700 hover:underline">
          {t("customers.goToVehicles")}
        </Link>
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        {(unassigned ?? []).length > 0 && (
          <Button type="submit" loading={mutation.isPending}>{t("customers.attach")}</Button>
        )}
      </div>
    </form>
  );
}

export default function CustomerDetailPage() {
  const t = useT();
  const { customerId = "" } = useParams();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  // Customers is standalone master data — only surface speed-limiter panels
  // for tenants that actually run that module.
  const slEnabled = isEnabled("speed_limiters");
  const certificatesEnabled = slEnabled && isEnabled("sl_certificates");

  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [detaching, setDetaching] = useState<Vehicle | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => getRow<Customer>("customers", customerId),
  });

  useEffect(() => {
    if (customer) recordRecent(customer.name, `/customers/${customer.id}`);
  }, [customer]);

  const contactsQ = useQuery({
    queryKey: ["contacts", customerId],
    queryFn: () =>
      listRows<Contact>("contacts", (q) =>
        q.eq("customer_id", customerId).order("created_at"),
      ),
  });

  const vehiclesQ = useQuery({
    queryKey: ["vehicles", "customer", customerId],
    queryFn: () =>
      listRows<Vehicle>("vehicles", (q) => q.eq("customer_id", customerId).order("name")),
  });

  const installationsQ = useQuery({
    queryKey: ["speed_limiter_installations", "customer", customerId],
    queryFn: () =>
      listRows<SpeedLimiterInstallation>("speed_limiter_installations", (q) =>
        q.eq("customer_id", customerId).eq("status", "active"),
      ),
    enabled: slEnabled,
  });

  const jobsQ = useQuery({
    queryKey: ["sl_jobs", "customer", customerId],
    queryFn: () =>
      listRows<JobRow>("sl_jobs", (q) =>
        q
          .select("*, vehicles(name)")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false }),
      ),
    enabled: slEnabled,
  });

  const certsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "customer", customerId],
    queryFn: () =>
      listRows<CertRow>("speed_limiter_certificates", (q) =>
        q.select("*, vehicles(name)").eq("customer_id", customerId).order("expires_at"),
      ),
    enabled: certificatesEnabled,
  });

  const removeContact = useMutation({
    mutationFn: (contactId: string) => deleteRow("contacts", contactId),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      setDeletingContact(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("customers.deleteFailed"));
      setDeletingContact(null);
    },
  });

  const detach = useMutation({
    mutationFn: (vehicleId: string) =>
      updateRow<Vehicle>("vehicles", vehicleId, { customer_id: null }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["vehicles"] });
      setDetaching(null);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : t("customers.saveFailed"));
      setDetaching(null);
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!customer) return <ErrorState message={t("customers.notFound")} />;

  const vehicles = vehiclesQ.data ?? [];
  const contacts = [...(contactsQ.data ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary),
  );
  const jobs = jobsQ.data ?? [];
  const certs = certsQ.data ?? [];

  const activeLimiters = (installationsQ.data ?? []).length;
  const completedJobs = jobs.filter(
    (j) => j.status === "completed" || j.status === "qc_approved" || j.status === "closed",
  ).length;
  const pendingJobs = jobs.filter(
    (j) => j.status === "scheduled" || j.status === "in_progress",
  ).length;
  const expiringCerts = certs.filter((c) => {
    if (c.status !== "valid") return false;
    const days = daysUntil(c.expires_at);
    return days >= 0 && days <= 60;
  }).length;
  const expiredCerts = certs.filter(
    (c) => c.status === "valid" && daysUntil(c.expires_at) < 0,
  ).length;
  const coveredVehicleIds = new Set(
    certs
      .filter((c) => c.status === "valid" && daysUntil(c.expires_at) >= 0)
      .map((c) => c.vehicle_id),
  );
  const coveredCount = vehicles.filter((v) => coveredVehicleIds.has(v.id)).length;
  const compliance =
    vehicles.length === 0 ? "—" : `${Math.round((coveredCount / vehicles.length) * 100)}%`;
  const st = customerStatusMeta[customer.status];

  function certBadge(c: CertRow) {
    if (c.status === "revoked") {
      return <Badge tone="red">{t("speedLimiters.certStatus.revoked")}</Badge>;
    }
    const days = daysUntil(c.expires_at);
    if (days < 0) return <Badge tone="red">{t("speedLimiters.certStatus.expired")}</Badge>;
    if (days <= 60) return <Badge tone="yellow">{t("speedLimiters.certStatus.expiring")}</Badge>;
    return <Badge tone="green">{t("speedLimiters.certStatus.valid")}</Badge>;
  }

  return (
    <>
      <Link
        to="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("customers.title")}
      </Link>
      <PageHeader
        title={customer.name}
        description={customer.cr_number ?? undefined}
        actions={
          <>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            {isManager && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t("customers.vehicles")} value={vehicles.length} />
        {slEnabled && (
          <>
            <Kpi label={t("customers.kpiActiveLimiters")} value={activeLimiters} />
            <Kpi label={t("customers.kpiJobsCompleted")} value={completedJobs} />
            <Kpi label={t("customers.kpiJobsPending")} value={pendingJobs} />
          </>
        )}
        {certificatesEnabled && (
          <>
            <Kpi label={t("customers.kpiCertsIssued")} value={certs.length} />
            <Kpi label={t("customers.kpiCertsExpiring")} value={expiringCerts} />
            <Kpi label={t("customers.kpiCertsExpired")} value={expiredCerts} />
            <Kpi
              label={t("customers.kpiCompliance")}
              value={compliance}
              hint={t("customers.complianceHint")}
            />
          </>
        )}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{t("customers.contacts")}</h3>
            {isManager && (
              <Button variant="secondary" onClick={() => setAddingContact(true)}>
                <Plus className="h-4 w-4" /> {t("action.add")}
              </Button>
            )}
          </div>
          {contactsQ.isLoading ? (
            <LoadingState />
          ) : contactsQ.error ? (
            <ErrorState message={(contactsQ.error as Error).message} />
          ) : contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {t("customers.noContacts")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {c.is_primary && (
                        <Star
                          className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                          aria-label={t("customers.primaryContact")}
                        />
                      )}
                      <span className="truncate text-sm font-medium text-slate-800">{c.name}</span>
                    </div>
                    {(c.title || c.department) && (
                      <div className="text-xs text-slate-500">
                        {[c.title, c.department].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    <div className="mt-0.5 space-y-0.5 text-xs text-slate-500">
                      {c.phone && <div>{c.phone}</div>}
                      {c.whatsapp && (
                        <div>{t("customers.whatsapp")}: {c.whatsapp}</div>
                      )}
                      {c.email && <div className="truncate">{c.email}</div>}
                    </div>
                  </div>
                  {isManager && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() => setEditingContact(c)}
                        aria-label={t("customers.editContact")}
                        title={t("action.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeletingContact(c)}
                        aria-label={t("customers.deleteContact")}
                        title={t("action.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{t("customers.vehicles")}</h3>
            {isManager && (
              <Button variant="secondary" onClick={() => setAttaching(true)}>
                <Plus className="h-4 w-4" /> {t("customers.attachVehicle")}
              </Button>
            )}
          </div>
          {vehiclesQ.isLoading ? (
            <LoadingState />
          ) : vehiclesQ.error ? (
            <ErrorState message={(vehiclesQ.error as Error).message} />
          ) : vehicles.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {t("customers.noVehicles")}
            </p>
          ) : (
            <Table
              headers={[
                t("field.name"),
                t("field.licensePlate"),
                t("customers.fleetNumber"),
                t("customers.chassisNumber"),
                "",
              ]}
            >
              {vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/vehicles/${v.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{v.license_plate ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{v.fleet_number ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{v.chassis_number ?? "—"}</td>
                  <td className="px-4 py-3 text-end">
                    {isManager && (
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDetaching(v)}
                        aria-label={t("customers.detachVehicle")}
                        title={t("customers.detachVehicle")}
                      >
                        <Unlink className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {slEnabled && (
      <div className={`grid gap-4 ${certificatesEnabled ? "lg:grid-cols-2" : ""}`}>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{t("customers.jobs")}</h3>
            <Link
              to="/speed-limiters/jobs"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {t("customers.viewAllJobs")}
            </Link>
          </div>
          {jobsQ.isLoading ? (
            <LoadingState />
          ) : jobsQ.error ? (
            <ErrorState message={(jobsQ.error as Error).message} />
          ) : jobs.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{t("customers.noJobs")}</p>
          ) : (
            <Table
              headers={[
                t("customers.jobNumber"),
                t("customers.type"),
                t("common.status"),
                t("field.vehicle"),
                t("customers.scheduled"),
              ]}
            >
              {jobs.slice(0, 8).map((j) => {
                const jm = jobStatusMeta[j.status];
                return (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/speed-limiters/jobs/${j.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        #{j.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t(jobTypeKeys[j.job_type])}</td>
                    <td className="px-4 py-3">
                      <Badge tone={jm.tone}>{t(jm.labelKey)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{j.vehicles?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(j.scheduled_date)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        {certificatesEnabled && (
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {t("customers.certificates")}
              </h3>
              <Link
                to="/speed-limiters/certificates"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                {t("customers.viewAllCertificates")}
              </Link>
            </div>
            {certsQ.isLoading ? (
              <LoadingState />
            ) : certsQ.error ? (
              <ErrorState message={(certsQ.error as Error).message} />
            ) : certs.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                {t("customers.noCertificates")}
              </p>
            ) : (
              <Table
                headers={[
                  t("customers.certificateNumber"),
                  t("field.vehicle"),
                  t("customers.expires"),
                ]}
              >
                {certs.slice(0, 8).map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to="/speed-limiters/certificates"
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {c.certificate_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.vehicles?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {certBadge(c)}
                        <span className="text-xs text-slate-500">{formatDate(c.expires_at)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
      )}

      <Modal
        title={t("customers.editCustomer")}
        open={editing}
        onClose={() => setEditing(false)}
        wide
      >
        {editing && <CustomerForm customer={customer} onDone={() => setEditing(false)} />}
      </Modal>

      <Modal
        title={t("customers.addContact")}
        open={addingContact}
        onClose={() => setAddingContact(false)}
        wide
      >
        {addingContact && (
          <ContactForm
            customerId={customerId}
            contacts={contactsQ.data ?? []}
            onDone={() => setAddingContact(false)}
          />
        )}
      </Modal>

      <Modal
        title={t("customers.editContact")}
        open={!!editingContact}
        onClose={() => setEditingContact(null)}
        wide
      >
        {editingContact && (
          <ContactForm
            customerId={customerId}
            contact={editingContact}
            contacts={contactsQ.data ?? []}
            onDone={() => setEditingContact(null)}
          />
        )}
      </Modal>

      <Modal
        title={t("customers.deleteContact")}
        open={!!deletingContact}
        onClose={() => setDeletingContact(null)}
      >
        {deletingContact && (
          <>
            <p className="text-sm text-slate-600">
              {t("customers.deleteContactConfirm", { name: deletingContact.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeletingContact(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => removeContact.mutate(deletingContact.id)}
                loading={removeContact.isPending}
              >
                {t("customers.deleteContact")}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        title={t("customers.attachVehicle")}
        open={attaching}
        onClose={() => setAttaching(false)}
      >
        {attaching && (
          <AttachVehicleForm customerId={customerId} onDone={() => setAttaching(false)} />
        )}
      </Modal>

      <Modal
        title={t("customers.detachVehicle")}
        open={!!detaching}
        onClose={() => setDetaching(null)}
      >
        {detaching && (
          <>
            <p className="text-sm text-slate-600">
              {t("customers.detachConfirm", {
                vehicle: detaching.name,
                customer: customer.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetaching(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => detach.mutate(detaching.id)}
                loading={detach.isPending}
              >
                {t("customers.detachVehicle")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus, Users } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { formatDate } from "../../lib/format";
import type {
  DistanceUnit,
  Invitation,
  Profile,
  Role,
  Tenant,
  VolumeUnit,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table,
} from "../../components/ui";
import type { BadgeTone } from "../../components/ui";

// --- shared helpers (option lists mirror SignupPage) ---

const COMMON_CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "CNY", "AED", "SAR",
  "SGD", "CHF", "SEK", "NOK", "DKK", "NZD", "ZAR", "BRL", "MXN", "NGN",
  "KES", "EGP", "TRY", "PLN", "IDR", "MYR", "THB", "PHP", "VND", "KRW",
];

function browserTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

function countryOptions(): Array<{ code: string; name: string }> {
  const codes = [
    "US", "GB", "IN", "AU", "CA", "DE", "FR", "ES", "IT", "NL", "AE", "SA",
    "SG", "CH", "SE", "NO", "DK", "NZ", "ZA", "BR", "MX", "NG", "KE", "EG",
    "TR", "PL", "ID", "MY", "TH", "PH", "VN", "KR", "JP", "CN",
  ];
  try {
    const dn = new Intl.DisplayNames(undefined, { type: "region" });
    return codes
      .map((code) => ({ code, name: dn.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return codes.map((code) => ({ code, name: code }));
  }
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const roleTone: Record<Role, BadgeTone> = {
  owner: "purple",
  admin: "blue",
  manager: "green",
  viewer: "slate",
};

// --- Organization tab ---

function OrganizationTab() {
  const tenant = useTenant();
  const { isAdmin, refresh } = useAuth();

  const timezones = useMemo(() => {
    const list = browserTimezones();
    return list.includes(tenant.timezone) ? list : [tenant.timezone, ...list];
  }, [tenant.timezone]);
  const countries = useMemo(() => {
    const list = countryOptions();
    return list.some((c) => c.code === tenant.country)
      ? list
      : [{ code: tenant.country, name: countryName(tenant.country) }, ...list];
  }, [tenant.country]);
  const currencies = useMemo(
    () =>
      COMMON_CURRENCIES.includes(tenant.currency)
        ? COMMON_CURRENCIES
        : [tenant.currency, ...COMMON_CURRENCIES],
    [tenant.currency],
  );

  const [form, setForm] = useState({
    name: tenant.name,
    country: tenant.country,
    currency: tenant.currency,
    timezone: tenant.timezone,
    distance_unit: tenant.distance_unit,
    volume_unit: tenant.volume_unit,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  const save = useMutation({
    mutationFn: async () => {
      await updateRow<Tenant>("tenants", tenant.id, {
        name: form.name.trim(),
        country: form.country,
        currency: form.currency,
        timezone: form.timezone,
        distance_unit: form.distance_unit,
        volume_unit: form.volume_unit,
      });
      await refresh();
    },
    onSuccess: () => setSaved(true),
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  if (!isAdmin) {
    const rows: Array<[string, string]> = [
      ["Name", tenant.name],
      ["Country", countryName(tenant.country)],
      ["Currency", tenant.currency],
      ["Timezone", tenant.timezone],
      ["Distance unit", tenant.distance_unit === "mi" ? "Miles" : "Kilometers"],
      ["Volume unit", tenant.volume_unit === "gal" ? "Gallons (US)" : "Liters"],
      ["Created", formatDate(tenant.created_at)],
    ];
    return (
      <Card className="max-w-2xl">
        <dl className="divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
              <dt className="text-sm font-medium text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}

        <Field label="Organization name" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" required>
            <Select value={form.country} onChange={(e) => set("country", e.target.value)}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" required>
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone" required>
            <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Distance">
              <Select
                value={form.distance_unit}
                onChange={(e) => set("distance_unit", e.target.value as DistanceUnit)}
              >
                <option value="km">Kilometers</option>
                <option value="mi">Miles</option>
              </Select>
            </Field>
            <Field label="Volume">
              <Select
                value={form.volume_unit}
                onChange={(e) => set("volume_unit", e.target.value as VolumeUnit)}
              >
                <option value="L">Liters</option>
                <option value="gal">Gallons (US)</option>
              </Select>
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && !save.isPending && (
            <span className="text-sm font-medium text-emerald-600">Saved.</span>
          )}
          <Button type="submit" loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

// --- Members tab ---

function MembersTab() {
  const { profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState("");
  const [removing, setRemoving] = useState<Profile | null>(null);

  const { data: members, isLoading, error } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => listRows<Profile>("profiles", (q) => q.order("created_at")),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      apiFetch("/members/" + id + "/role", { method: "PATCH", body: { role } }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Role change failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch("/members/" + id, { method: "DELETE" }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
      setRemoving(null);
    },
    onError: (err) => {
      setRemoving(null);
      setActionError(err instanceof Error ? err.message : "Remove failed");
    },
  });

  const canManage = (m: Profile) => isAdmin && m.role !== "owner" && m.id !== profile?.id;

  return (
    <>
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (members?.length ?? 0) === 0 && (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No members yet"
          description="Invite teammates from the Invitations tab."
        />
      )}

      {!isLoading && !error && (members?.length ?? 0) > 0 && (
        <Table headers={isAdmin ? ["Name", "Role", "Joined", ""] : ["Name", "Role", "Joined"]}>
          {(members ?? []).map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{m.full_name}</div>
                <div className="text-xs text-slate-500">{m.email}</div>
              </td>
              <td className="px-4 py-3">
                {canManage(m) ? (
                  <div className="w-32">
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value as Role })}
                      disabled={changeRole.isPending}
                      aria-label={`Role for ${m.full_name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                  </div>
                ) : (
                  <Badge tone={roleTone[m.role]}>{capitalize(m.role)}</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{formatDate(m.created_at)}</td>
              {isAdmin && (
                <td className="px-4 py-3 text-right">
                  {canManage(m) && (
                    <button
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      onClick={() => setRemoving(m)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}

      <Modal title="Remove member" open={!!removing} onClose={() => setRemoving(null)}>
        {removing && (
          <>
            <p className="text-sm text-slate-600">
              Remove <span className="font-semibold">{removing.full_name}</span> from the
              organization? They will lose access immediately.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(removing.id)}
                loading={remove.isPending}
              >
                Remove member
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Invitations tab ---

function InviteForm({ onDone }: { onDone: () => void }) {
  const tenant = useTenant();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("viewer");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      insertRow<Invitation>("invitations", {
        tenant_id: tenant.id,
        invited_by: profile?.id ?? null,
        email: email.trim(),
        role,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invitations"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Invite failed"),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label="Email" required>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
      </Field>
      <Field label="Role">
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as Exclude<Role, "owner">)}
        >
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="viewer">Viewer</option>
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create invitation</Button>
      </div>
    </form>
  );
}

function invitationBadge(inv: Invitation) {
  if (inv.status === "accepted") return <Badge tone="green">Accepted</Badge>;
  if (inv.status === "revoked") return <Badge tone="slate">Revoked</Badge>;
  if (new Date(inv.expires_at).getTime() < Date.now()) return <Badge tone="red">Expired</Badge>;
  return <Badge tone="yellow">Pending</Badge>;
}

function InvitationsTab({
  inviting,
  setInviting,
}: {
  inviting: boolean;
  setInviting: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: invitations, isLoading, error } = useQuery({
    queryKey: ["invitations"],
    queryFn: () =>
      listRows<Invitation>("invitations", (q) => q.order("created_at", { ascending: false })),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      updateRow<Invitation>("invitations", id, { status: "revoked" }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["invitations"] });
      setRevoking(null);
    },
    onError: (err) => {
      setRevoking(null);
      setActionError(err instanceof Error ? err.message : "Revoke failed");
    },
  });

  function copyLink(inv: Invitation) {
    void navigator.clipboard.writeText(
      window.location.origin + "/accept-invite?token=" + inv.token,
    );
    setCopiedId(inv.id);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === inv.id ? null : cur));
    }, 2000);
  }

  return (
    <>
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (invitations?.length ?? 0) === 0 && (
        <EmptyState
          icon={<Mail className="h-10 w-10" />}
          title="No invitations yet"
          description="Invite teammates to give them access to your fleet workspace."
          action={
            <Button onClick={() => setInviting(true)}>
              <Plus className="h-4 w-4" /> Invite member
            </Button>
          }
        />
      )}

      {!isLoading && !error && (invitations?.length ?? 0) > 0 && (
        <>
          <Table headers={["Email", "Role", "Status", "Invited", ""]}>
            {(invitations ?? []).map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{inv.email}</td>
                <td className="px-4 py-3 text-slate-600">{capitalize(inv.role)}</td>
                <td className="px-4 py-3">{invitationBadge(inv)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(inv.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {inv.status === "pending" && (
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => copyLink(inv)}
                      >
                        {copiedId === inv.id ? "Copied!" : "Copy link"}
                      </button>
                      <button
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        onClick={() => setRevoking(inv)}
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            Send the invite link to your teammate — the app does not email it yet.
          </p>
        </>
      )}

      <Modal title="Invite member" open={inviting} onClose={() => setInviting(false)}>
        <InviteForm onDone={() => setInviting(false)} />
      </Modal>

      <Modal title="Revoke invitation" open={!!revoking} onClose={() => setRevoking(null)}>
        {revoking && (
          <>
            <p className="text-sm text-slate-600">
              Revoke the invitation for{" "}
              <span className="font-semibold">{revoking.email}</span>? The invite link will stop
              working.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRevoking(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => revoke.mutate(revoking.id)}
                loading={revoke.isPending}
              >
                Revoke invitation
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Page ---

type Tab = "organization" | "members" | "invitations";

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("organization");
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your organization, team members, and invitations"
        actions={
          tab === "invitations" &&
          isAdmin && (
            <Button onClick={() => setInviting(true)}>
              <Plus className="h-4 w-4" /> Invite member
            </Button>
          )
        }
      />

      <div className="mb-4 flex gap-2">
        {(
          [
            ["organization", "Organization"],
            ["members", "Members"],
            ["invitations", "Invitations"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={
              tab === value
                ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "organization" && <OrganizationTab />}
      {tab === "members" && <MembersTab />}
      {tab === "invitations" &&
        (isAdmin ? (
          <InvitationsTab inviting={inviting} setInviting={setInviting} />
        ) : (
          <Card className="max-w-2xl px-5 py-4 text-sm text-slate-500">
            Only admins manage invitations.
          </Card>
        ))}
    </>
  );
}

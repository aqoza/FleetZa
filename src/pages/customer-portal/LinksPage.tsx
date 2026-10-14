import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Pencil, Plus, RotateCcw, ShieldOff, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listPage, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { formatDate, formatDateTime } from "../../lib/format";
import { useCustomerPicker } from "../../lib/pickers";
import { PORTAL_SECTIONS, linkState, portalUrl, type PortalSection } from "../../../shared/customerPortal";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useToast } from "../../components/Toast";
import { LINK_SELECT, linkTone, type PortalLink } from "./types";

const PAGE_SIZE = 25;

/** The module each section reads; a section whose module is off stays hidden on the portal. */
const SECTION_MODULE: Record<PortalSection, string> = {
  vehicles: "fleet",
  certificates: "speed_limiters",
  invoices: "billing",
  quotes: "sales",
  contracts: "contracts",
};
const flagOf = (s: PortalSection) => `show_${s}` as const;

export default function LinksPage() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"active" | "all" | "revoked">("active");
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<PortalLink | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ link: PortalLink; action: "revoke" | "delete" } | null>(null);
  const [actionError, setActionError] = useState("");
  const picker = useCustomerPicker(customer);
  const now = new Date().toISOString();

  const { data, isLoading, error } = useQuery({
    queryKey: ["customer_portal_access", { filter, customer, page }],
    queryFn: () =>
      listPage<PortalLink>("customer_portal_access", page, PAGE_SIZE, (q) => {
        let f = q.select(LINK_SELECT);
        if (filter === "active") f = f.eq("active", true);
        else if (filter === "revoked") f = f.eq("active", false);
        if (customer) f = f.eq("customer_id", customer);
        return f.order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["customer_portal_access"] });
  const fail = (e: unknown) => {
    setConfirm(null);
    setActionError(e instanceof Error ? e.message : String(e));
  };
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateRow("customer_portal_access", id, { active }),
    onSuccess: (_d, v) => {
      setActionError("");
      setConfirm(null);
      refresh();
      toast.success(t(v.active ? "customerPortal.reactivated" : "customerPortal.revoked"));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("customer_portal_access", id),
    onSuccess: () => {
      setActionError("");
      setConfirm(null);
      refresh();
      toast.success(t("toast.deleted"));
    },
    onError: fail,
  });

  const copy = (token: string) => {
    const url = portalUrl(window.location.origin, token);
    if (!navigator.clipboard) {
      toast.error(t("customerPortal.copyFailed"));
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => toast.success(t("customerPortal.copied")),
      () => toast.error(t("customerPortal.copyFailed")),
    );
  };

  const columns: Array<DataTableColumn<PortalLink>> = [
    {
      id: "customer",
      header: t("customerPortal.col.customer"),
      cell: (l) => (
        <>
          <div className="font-medium text-ink"><Bdi>{l.customer?.name ?? "—"}</Bdi></div>
          {l.label && <div className="text-xs text-ink-3"><Bdi>{l.label}</Bdi></div>}
        </>
      ),
      sortValue: (l) => l.customer?.name ?? null,
      exportValue: (l) => l.customer?.name ?? "",
    },
    {
      id: "shows",
      header: t("customerPortal.col.shows"),
      minBreakpoint: "md",
      cell: (l) => {
        const on = PORTAL_SECTIONS.filter((s) => l[flagOf(s)]);
        return (
          <div className="flex max-w-72 flex-wrap gap-1">
            {on.map((s) => <span key={s} className="rounded-md bg-canvas px-1.5 py-0.5 text-xs text-ink-2">{t(`customerPortal.section.${s}`)}</span>)}
            {l.allow_requests && <span className="rounded-md bg-canvas px-1.5 py-0.5 text-xs text-ink-2">{t("customerPortal.section.requests")}</span>}
          </div>
        );
      },
      exportValue: (l) => [...PORTAL_SECTIONS.filter((s) => l[flagOf(s)]), ...(l.allow_requests ? ["requests"] : [])].join(" "),
    },
    {
      id: "status",
      header: t("customerPortal.col.status"),
      cell: (l) => {
        const s = linkState(l, now);
        return <span className="whitespace-nowrap"><Badge tone={linkTone[s]}>{t(`customerPortal.linkStatus.${s}`)}</Badge></span>;
      },
      sortValue: (l) => linkState(l, now),
      exportValue: (l) => linkState(l, now),
    },
    {
      id: "lastOpened",
      header: t("customerPortal.col.lastOpened"),
      minBreakpoint: "lg",
      cell: (l) =>
        l.last_accessed_at ? (
          <div className="whitespace-nowrap">
            <div className="text-ink-2 tabular-nums"><Ltr>{formatDateTime(l.last_accessed_at, tenant.timezone)}</Ltr></div>
            <div className="text-xs text-ink-3">{tp("customerPortal.opens", l.access_count)}</div>
          </div>
        ) : (
          <span className="text-ink-3">{t("customerPortal.neverOpened")}</span>
        ),
      sortValue: (l) => l.last_accessed_at,
      exportValue: (l) => l.last_accessed_at ?? "",
    },
    {
      id: "expires",
      header: t("customerPortal.col.expires"),
      minBreakpoint: "lg",
      cell: (l) =>
        l.expires_at ? (
          <span className="whitespace-nowrap text-ink-2 tabular-nums"><Ltr>{formatDate(l.expires_at)}</Ltr></span>
        ) : (
          <span className="text-ink-3">{t("customerPortal.noExpiry")}</span>
        ),
      sortValue: (l) => l.expires_at,
      exportValue: (l) => l.expires_at ?? "",
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (l) => {
        const live = linkState(l, now) === "active";
        return (
          <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {live && (
              <>
                <Button variant="secondary" onClick={() => copy(l.token)}>
                  <Copy className="h-4 w-4" /> <span className="hidden sm:inline">{t("customerPortal.copy")}</span>
                </Button>
                <a href={portalUrl(window.location.origin, l.token)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center rounded-lg p-2 text-ink-3 hover:bg-canvas hover:text-ink"
                  aria-label={t("customerPortal.preview")} title={t("customerPortal.preview")}>
                  <ExternalLink className="h-4 w-4 rtl:-scale-x-100" />
                </a>
              </>
            )}
            <Button variant="ghost" onClick={() => setEditing(l)} aria-label={t("action.edit")} title={t("action.edit")}>
              <Pencil className="h-4 w-4" />
            </Button>
            {l.active ? (
              <Button variant="ghost" onClick={() => setConfirm({ link: l, action: "revoke" })}
                aria-label={t("customerPortal.revoke")} title={t("customerPortal.revoke")}>
                <ShieldOff className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" loading={setActive.isPending && setActive.variables?.id === l.id}
                onClick={() => setActive.mutate({ id: l.id, active: true })}
                aria-label={t("customerPortal.reactivate")} title={t("customerPortal.reactivate")}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirm({ link: l, action: "delete" })}
              aria-label={t("action.delete")} title={t("action.delete")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">{t("customerPortal.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Combobox {...picker} value={customer} onChange={(v) => { setCustomer(v); setPage(0); }} placeholder={t("customerPortal.allCustomers")} />
        </div>
        <div className="w-full sm:w-48">
          <Select value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(0); }} aria-label={t("customerPortal.col.status")}>
            <option value="active">{t("customerPortal.filter.activeLinks")}</option>
            <option value="revoked">{t("customerPortal.filter.revokedLinks")}</option>
            <option value="all">{t("customerPortal.filter.all")}</option>
          </Select>
        </div>
        <Button className="ms-auto" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> {t("customerPortal.newLink")}
        </Button>
      </div>
      {actionError && <ErrorState message={actionError} />}
      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && (
        <DataTable<PortalLink>
          tableId="customer-portal-links"
          exportName="customer-portal-links"
          rows={rows}
          rowKey={(l) => l.id}
          columns={columns}
          toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("customerPortal.linkCount", total)}</span> : undefined}
          empty={<EmptyState icon={<Link2 className="h-10 w-10" />} title={t("customerPortal.linksEmpty")} description={t("customerPortal.linksEmptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
        />
      )}

      <Modal title={editing === "new" ? t("customerPortal.newLink") : t("customerPortal.editLink")} open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <LinkForm
            link={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onDone={(token) => {
              const created = editing === "new";
              setEditing(null);
              refresh();
              toast.success(t(created ? "customerPortal.created" : "customerPortal.saved"));
              if (created && token) copy(token);
            }}
          />
        )}
      </Modal>
      <Modal title={t("action.confirm")} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {t(confirm.action === "revoke" ? "customerPortal.confirmRevoke" : "customerPortal.confirmDelete", {
                customer: bdiText(confirm.link.customer?.name ?? ""),
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" loading={setActive.isPending || remove.isPending}
                onClick={() => (confirm.action === "revoke"
                  ? setActive.mutate({ id: confirm.link.id, active: false })
                  : remove.mutate(confirm.link.id))}>
                {t(confirm.action === "revoke" ? "customerPortal.revoke" : "action.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function LinkForm({ link, onDone, onCancel }: { link?: PortalLink; onDone: (token?: string) => void; onCancel: () => void }) {
  const t = useT();
  const { isEnabled } = useModules();
  const [customerId, setCustomerId] = useState(link?.customer_id ?? "");
  const [label, setLabel] = useState(link?.label ?? "");
  const [expires, setExpires] = useState(link?.expires_at ? link.expires_at.slice(0, 10) : "");
  const [flags, setFlags] = useState<Record<PortalSection | "requests", boolean>>({
    vehicles: link?.show_vehicles ?? true,
    certificates: link?.show_certificates ?? true,
    invoices: link?.show_invoices ?? true,
    quotes: link?.show_quotes ?? true,
    contracts: link?.show_contracts ?? true,
    requests: link?.allow_requests ?? true,
  });
  const [error, setError] = useState("");
  const picker = useCustomerPicker(customerId, { activeOnly: !link, enabled: !link });
  const today = new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        label: label.trim() || null,
        // End of the chosen day, so "expires on the 30th" still works on the 30th.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        show_vehicles: flags.vehicles,
        show_certificates: flags.certificates,
        show_invoices: flags.invoices,
        show_quotes: flags.quotes,
        show_contracts: flags.contracts,
        allow_requests: flags.requests,
      };
      if (link) {
        await updateRow("customer_portal_access", link.id, values);
        return undefined;
      }
      return (await insertRow<{ token: string }>("customer_portal_access", { customer_id: customerId, ...values })).token;
    },
    onSuccess: (token) => onDone(token),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!customerId) return;
    save.mutate();
  };
  const toggle = (k: PortalSection | "requests", label: string, hint?: string) => (
    <label key={k} className="flex items-start gap-2 text-sm text-ink">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line" checked={flags[k]}
        onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {link ? (
        <p className="text-sm font-medium text-ink"><Bdi>{link.customer?.name}</Bdi></p>
      ) : (
        <Field label={t("customerPortal.f.customer")} required>
          <Combobox {...picker} value={customerId} onChange={setCustomerId} required placeholder={t("customerPortal.f.selectCustomer")} />
        </Field>
      )}
      <Field label={t("customerPortal.f.label")} hint={t("customerPortal.f.labelHint")}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
      </Field>
      <Field label={t("customerPortal.f.expires")} hint={t("customerPortal.f.expiresHint")}>
        <Input type="date" value={expires} min={today} onChange={(e) => setExpires(e.target.value)} dir="ltr" />
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{t("customerPortal.f.shows")}</legend>
        {PORTAL_SECTIONS.map((s) => toggle(s, t(`customerPortal.section.${s}`),
          isEnabled(SECTION_MODULE[s]) ? undefined : t("customerPortal.f.moduleOff")))}
        {toggle("requests", t("customerPortal.f.allowRequests"), t("customerPortal.f.allowRequestsHint"))}
      </fieldset>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!customerId}>
          {link ? t("action.save") : t("customerPortal.newLink")}
        </Button>
      </div>
    </form>
  );
}


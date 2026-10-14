/**
 * Vendor portal — module `vendor_portal`. Managers create, copy, revoke and
 * delete the capability links suppliers open at /vendor/:token. The token is
 * a secret, so only managers can read these rows (RLS); the public side is
 * worker/vendorPortal.ts.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Plus, RotateCcw, ShieldOff, Trash2 } from "lucide-react";
import { deleteRow, insertRow, listPage, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { formatDate, formatDateTime } from "../../lib/format";
import { useSupplierPicker } from "../../lib/pickers";
import type { Tables } from "../../lib/database.types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, PageHeader, Pagination, Select } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useToast } from "../../components/Toast";
import { linkState, vendorLinkUrl, type LinkState } from "./links";

type Link = Tables<"supplier_portal_access"> & {
  supplier: { id: string; name: string; name_ar: string | null } | null;
};
const SELECT = "*, supplier:suppliers(id, name, name_ar)";
const PAGE_SIZE = 25;

const STATE_TONE: Record<LinkState, "green" | "slate" | "yellow"> = { active: "green", revoked: "slate", expired: "yellow" };

export default function VendorPortalHub() {
  const t = useT();
  const { isManager } = useAuth();
  if (!isManager) {
    return (
      <>
        <PageHeader title={t("vendorPortal.title")} description={t("vendorPortal.subtitle")} />
        <EmptyState icon={<Link2 className="h-10 w-10" />} title={t("vendorPortal.managersOnly")} />
      </>
    );
  }
  return <LinksPage />;
}

function LinksPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"active" | "all" | "revoked">("active");
  const [supplier, setSupplier] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ link: Link; action: "revoke" | "delete" } | null>(null);
  const [actionError, setActionError] = useState("");
  const picker = useSupplierPicker(supplier);
  const now = new Date().toISOString();
  const name = (l: Link) => (l.supplier ? (language === "ar" && l.supplier.name_ar ? l.supplier.name_ar : l.supplier.name) : "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["supplier_portal_access", { filter, supplier, page }],
    queryFn: () =>
      listPage<Link>("supplier_portal_access", page, PAGE_SIZE, (q) => {
        let f = q.select(SELECT);
        if (filter === "active") f = f.eq("active", true);
        else if (filter === "revoked") f = f.eq("active", false);
        if (supplier) f = f.eq("supplier_id", supplier);
        return f.order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["supplier_portal_access"] });
  const fail = (e: unknown) => {
    setConfirm(null);
    setActionError(e instanceof Error ? e.message : String(e));
  };
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateRow("supplier_portal_access", id, { active }),
    onSuccess: (_d, v) => {
      setActionError("");
      setConfirm(null);
      refresh();
      toast.success(t(v.active ? "vendorPortal.reactivated" : "vendorPortal.revoked"));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRow("supplier_portal_access", id),
    onSuccess: () => {
      setActionError("");
      setConfirm(null);
      refresh();
      toast.success(t("toast.deleted"));
    },
    onError: fail,
  });

  const copy = (l: Link) => {
    const url = vendorLinkUrl(l.token);
    if (!navigator.clipboard) {
      toast.error(t("vendorPortal.copyFailed"));
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => toast.success(t("vendorPortal.copied")),
      () => toast.error(t("vendorPortal.copyFailed")),
    );
  };

  const columns: Array<DataTableColumn<Link>> = [
    {
      id: "supplier",
      header: t("vendorPortal.col.supplier"),
      cell: (l) => (
        <>
          <div className="font-medium text-ink"><Bdi>{name(l)}</Bdi></div>
          {l.label && <div className="text-xs text-ink-3"><Bdi>{l.label}</Bdi></div>}
        </>
      ),
      sortValue: (l) => l.supplier?.name ?? null,
      exportValue: (l) => l.supplier?.name ?? "",
    },
    {
      id: "status",
      header: t("vendorPortal.col.status"),
      cell: (l) => {
        const s = linkState(l, now);
        return <span className="whitespace-nowrap"><Badge tone={STATE_TONE[s]}>{t(`vendorPortal.status.${s}`)}</Badge></span>;
      },
      sortValue: (l) => linkState(l, now),
      exportValue: (l) => linkState(l, now),
    },
    {
      id: "lastOpened",
      header: t("vendorPortal.col.lastOpened"),
      minBreakpoint: "md",
      cell: (l) =>
        l.last_accessed_at ? (
          <div className="whitespace-nowrap">
            <div className="text-ink-2 tabular-nums"><Ltr>{formatDateTime(l.last_accessed_at, tenant.timezone)}</Ltr></div>
            <div className="text-xs text-ink-3">{tp("vendorPortal.opens", l.access_count)}</div>
          </div>
        ) : (
          <span className="text-ink-3">{t("vendorPortal.neverOpened")}</span>
        ),
      sortValue: (l) => l.last_accessed_at,
      exportValue: (l) => l.last_accessed_at ?? "",
    },
    {
      id: "expires",
      header: t("vendorPortal.col.expires"),
      minBreakpoint: "lg",
      cell: (l) =>
        l.expires_at ? (
          <span className="whitespace-nowrap text-ink-2 tabular-nums"><Ltr>{formatDate(l.expires_at)}</Ltr></span>
        ) : (
          <span className="text-ink-3">{t("vendorPortal.noExpiry")}</span>
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
                <Button variant="secondary" onClick={() => copy(l)}>
                  <Copy className="h-4 w-4" /> <span className="hidden sm:inline">{t("vendorPortal.copy")}</span>
                </Button>
                <a href={vendorLinkUrl(l.token)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center rounded-lg p-2 text-ink-3 hover:bg-canvas hover:text-ink"
                  aria-label={t("vendorPortal.preview")} title={t("vendorPortal.preview")}>
                  <ExternalLink className="h-4 w-4 rtl:-scale-x-100" />
                </a>
              </>
            )}
            {l.active ? (
              <Button variant="ghost" onClick={() => setConfirm({ link: l, action: "revoke" })}
                aria-label={t("vendorPortal.revoke")} title={t("vendorPortal.revoke")}>
                <ShieldOff className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" loading={setActive.isPending && setActive.variables?.id === l.id}
                onClick={() => setActive.mutate({ id: l.id, active: true })}
                aria-label={t("vendorPortal.reactivate")} title={t("vendorPortal.reactivate")}>
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
    <>
      <PageHeader
        title={t("vendorPortal.title")}
        description={t("vendorPortal.subtitle")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("vendorPortal.newLink")}
          </Button>
        }
      />
      <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">{t("vendorPortal.intro")}</p>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-64">
            <Combobox {...picker} value={supplier} onChange={(v) => { setSupplier(v); setPage(0); }} placeholder={t("vendorPortal.allSuppliers")} />
          </div>
          <Select value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(0); }} className="max-w-48">
            <option value="active">{t("vendorPortal.filter.active")}</option>
            <option value="revoked">{t("vendorPortal.filter.revoked")}</option>
            <option value="all">{t("vendorPortal.filter.all")}</option>
          </Select>
        </div>
        {actionError && <ErrorState message={actionError} />}
        {isLoading && <LoadingState />}
        {error && <ErrorState message={(error as Error).message} />}
        {!isLoading && !error && (
          <DataTable<Link>
            tableId="vendor-portal-links"
            exportName="vendor-portal-links"
            rows={rows}
            rowKey={(l) => l.id}
            columns={columns}
            toolbar={total > 0 ? <span className="text-sm text-ink-3 tabular-nums">{tp("vendorPortal.linkCount", total)}</span> : undefined}
            empty={<EmptyState icon={<Link2 className="h-10 w-10" />} title={t("vendorPortal.emptyTitle")} description={t("vendorPortal.emptyDesc")} />}
            footer={<Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}
          />
        )}
      </div>

      <Modal title={t("vendorPortal.newLink")} open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <LinkForm onDone={(link) => {
            setCreating(false);
            if (link) {
              refresh();
              toast.success(t("vendorPortal.created"));
              copy(link as Link);
            }
          }} />
        )}
      </Modal>
      <Modal title={t("action.confirm")} open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {t(confirm.action === "revoke" ? "vendorPortal.confirmRevoke" : "vendorPortal.confirmDelete", {
                supplier: bdiText(name(confirm.link)),
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("action.cancel")}</Button>
              <Button variant="danger" loading={setActive.isPending || remove.isPending}
                onClick={() => (confirm.action === "revoke"
                  ? setActive.mutate({ id: confirm.link.id, active: false })
                  : remove.mutate(confirm.link.id))}>
                {t(confirm.action === "revoke" ? "vendorPortal.revoke" : "action.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function LinkForm({ onDone }: { onDone: (link?: Tables<"supplier_portal_access">) => void }) {
  const t = useT();
  const [supplierId, setSupplierId] = useState("");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");
  const picker = useSupplierPicker(supplierId, { activeOnly: true });
  const today = new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: () =>
      insertRow<Tables<"supplier_portal_access">>("supplier_portal_access", {
        supplier_id: supplierId,
        label: label.trim() || null,
        // End of the chosen day, so "expires on the 30th" still works on the 30th.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      }),
    onSuccess: (row) => onDone(row),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierId) return;
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("vendorPortal.f.supplier")} required>
        <Combobox {...picker} value={supplierId} onChange={setSupplierId} required />
      </Field>
      <Field label={t("vendorPortal.f.label")} hint={t("vendorPortal.f.labelHint")}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
      </Field>
      <Field label={t("vendorPortal.f.expires")} hint={t("vendorPortal.f.expiresHint")}>
        <Input type="date" value={expires} min={today} onChange={(e) => setExpires(e.target.value)} dir="ltr" />
      </Field>
      {error && <ErrorState message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onDone()}>{t("action.cancel")}</Button>
        <Button type="submit" loading={save.isPending} disabled={!supplierId}>{t("vendorPortal.newLink")}</Button>
      </div>
    </form>
  );
}

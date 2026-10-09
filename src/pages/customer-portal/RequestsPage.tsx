import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Phone } from "lucide-react";
import { listPage, listRows, sanitizeSearch, updateRow } from "../../lib/db";
import { useEntityPicker } from "../../lib/pickers";
import { ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime } from "../../lib/format";
import {
  OPEN_REQUEST_STATUSES, REQUEST_STATUSES, REQUEST_TYPES, nextRequestStatuses, type RequestStatus, type RequestType,
} from "../../../shared/customerPortal";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, Field, Input, LoadingState, Ltr, Modal, Pagination, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { useToast } from "../../components/Toast";
import { REQUEST_SELECT, personName, requestTone, type ServiceRequest } from "./types";

const PAGE_SIZE = 25;
type Filter = "open" | "all" | RequestStatus;

export default function RequestsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("open");
  const [type, setType] = useState<"" | RequestType>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const term = sanitizeSearch(search);
  const openId = params.get("request");

  const countsQ = useQuery({
    queryKey: ["portal_service_requests", "counts"],
    queryFn: () => listRows<{ status: RequestStatus }>("portal_service_requests", (q) => q.select("status").limit(10000)),
  });
  const counts = useMemo(() => {
    const m = new Map<RequestStatus, number>();
    for (const r of countsQ.data ?? []) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [countsQ.data]);
  const openCount = OPEN_REQUEST_STATUSES.reduce((n, s) => n + (counts.get(s) ?? 0), 0);

  const listQ = useQuery({
    queryKey: ["portal_service_requests", "list", { page, filter, type, term }],
    queryFn: () =>
      listPage<ServiceRequest>("portal_service_requests", page, PAGE_SIZE, (q) => {
        let f = q.select(REQUEST_SELECT);
        if (filter === "open") f = f.in("status", OPEN_REQUEST_STATUSES as RequestStatus[]);
        else if (filter !== "all") f = f.eq("status", filter);
        if (type) f = f.eq("request_type", type);
        if (term) f = f.or(`doc_number.ilike.%${term}%,description.ilike.%${term}%,contact_name.ilike.%${term}%,contact_phone.ilike.%${term}%`);
        return f.order("created_at", { ascending: false });
      }),
  });

  const pick = (f: Filter) => { setFilter(f); setPage(0); };
  const chip = (f: Filter, label: string, n: number) => (
    <button
      key={f}
      type="button"
      onClick={() => pick(f)}
      aria-pressed={filter === f}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
        filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
      }`}
    >
      {label}
      <Ltr className={`text-xs ${filter === f ? "text-white/80" : "text-ink-3"}`}>{String(n)}</Ltr>
    </button>
  );
  const openRequest = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("request", id);
    else next.delete("request");
    setParams(next, { replace: true });
  };

  const columns: Array<DataTableColumn<ServiceRequest>> = [
    {
      id: "number",
      header: t("customerPortal.col.number"),
      cell: (r) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{r.doc_number}</Ltr>,
      sortValue: (r) => r.number ?? 0,
      exportValue: (r) => r.doc_number ?? "",
    },
    {
      id: "request",
      header: t("customerPortal.col.request"),
      cell: (r) => (
        <div className="min-w-0 max-w-80">
          <div className="truncate text-ink"><Bdi>{r.customer?.name ?? "—"}</Bdi></div>
          <div className="truncate text-xs text-ink-3"><Bdi>{r.description}</Bdi></div>
        </div>
      ),
      exportValue: (r) => `${r.customer?.name ?? ""} · ${r.description}`,
    },
    {
      id: "type",
      header: t("customerPortal.col.type"),
      minBreakpoint: "md",
      cell: (r) => <span className="whitespace-nowrap text-ink-2">{t(`customerPortal.type.${r.request_type}`)}</span>,
      exportValue: (r) => r.request_type,
    },
    {
      id: "vehicle",
      header: t("customerPortal.col.vehicle"),
      minBreakpoint: "lg",
      cell: (r) => (r.vehicle ? <Bdi className="whitespace-nowrap text-ink-2">{r.vehicle.name}</Bdi> : <span className="text-ink-3">—</span>),
      exportValue: (r) => r.vehicle?.name ?? "",
    },
    {
      id: "date",
      header: t("customerPortal.col.when"),
      minBreakpoint: "sm",
      cell: (r) => (
        <span className="whitespace-nowrap text-ink-2">
          {r.status === "scheduled" && r.scheduled_for
            ? t("customerPortal.scheduledFor", { date: ltrText(formatDate(r.scheduled_for)) })
            : r.preferred_date ? t("customerPortal.preferred", { date: ltrText(formatDate(r.preferred_date)) }) : formatDate(r.created_at)}
        </span>
      ),
      sortValue: (r) => r.scheduled_for ?? r.preferred_date ?? r.created_at,
      exportValue: (r) => r.scheduled_for ?? r.preferred_date ?? "",
    },
    {
      id: "status",
      header: t("customerPortal.col.status"),
      cell: (r) => <span className="whitespace-nowrap"><Badge tone={requestTone[r.status]}>{t(`customerPortal.status.${r.status}`)}</Badge></span>,
      sortValue: (r) => REQUEST_STATUSES.indexOf(r.status),
      exportValue: (r) => r.status,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("open", t("customerPortal.filter.open"), openCount)}
        {REQUEST_STATUSES.map((s) => chip(s, t(`customerPortal.status.${s}`), counts.get(s) ?? 0))}
        {chip("all", t("customerPortal.filter.all"), countsQ.data?.length ?? 0)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("customerPortal.searchRequests")}
          className="w-full sm:max-w-72" />
        <div className="w-full sm:w-48">
          <Select value={type} onChange={(e) => { setType(e.target.value as "" | RequestType); setPage(0); }} aria-label={t("customerPortal.col.type")}>
            <option value="">{t("customerPortal.filter.anyType")}</option>
            {REQUEST_TYPES.map((x) => <option key={x} value={x}>{t(`customerPortal.type.${x}`)}</option>)}
          </Select>
        </div>
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<ServiceRequest>
          tableId="portal-requests"
          exportName="service-requests"
          rows={listQ.data.rows}
          rowKey={(r) => r.id}
          columns={columns}
          onRowClick={(r) => openRequest(r.id)}
          empty={<EmptyState icon={<Inbox className="h-10 w-10" />} title={t("customerPortal.requestsEmpty")} description={t("customerPortal.requestsEmptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <RequestModal id={openId} onClose={() => openRequest(null)} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

function useMemberPicker(selectedId: string) {
  return useEntityPicker<{ id: string; full_name: string; email: string }>({
    table: "profiles",
    selectedId,
    searchColumns: ["full_name", "email"],
    orderBy: "full_name",
    toOption: (p) => ({ value: p.id, label: p.full_name || p.email, meta: p.full_name ? p.email : undefined }),
    scope: ["portal-members"],
  });
}

function RequestModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ["portal_service_requests", "detail", id],
    enabled: !!id,
    queryFn: async () => (await listRows<ServiceRequest>("portal_service_requests", (b) => b.select(REQUEST_SELECT).eq("id", id!).limit(1)))[0] ?? null,
  });
  return (
    <Modal title={q.data?.doc_number ? t("customerPortal.requestTitle", { number: q.data.doc_number }) : t("customerPortal.request")}
      open={!!id} onClose={onClose} wide>
      {id && (q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} />
        : !q.data ? <ErrorState message={t("customerPortal.requestNotFound")} />
          : <RequestDetail key={q.data.id} r={q.data} onClose={onClose} />)}
    </Modal>
  );
}

function RequestDetail({ r, onClose }: { r: ServiceRequest; onClose: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<RequestStatus>(r.status);
  const [scheduled, setScheduled] = useState(r.scheduled_for ?? r.preferred_date ?? "");
  const [notes, setNotes] = useState(r.internal_notes ?? "");
  const [handler, setHandler] = useState(r.handled_by ?? "");
  const [error, setError] = useState("");
  const members = useMemberPicker(handler);
  const options = [r.status, ...nextRequestStatuses(r.status)];

  const save = useMutation({
    mutationFn: () => updateRow("portal_service_requests", r.id, {
      status,
      scheduled_for: status === "scheduled" ? scheduled || null : r.scheduled_for,
      internal_notes: notes.trim() || null,
      handled_by: handler || null,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["portal_service_requests"] });
      toast.success(t("customerPortal.requestSaved"));
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t("common.error")),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    save.mutate();
  };

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={requestTone[r.status]}>{t(`customerPortal.status.${r.status}`)}</Badge>
          <span className="text-sm text-ink-2">{t(`customerPortal.type.${r.request_type}`)}</span>
        </div>
        <p className="mt-3 whitespace-pre-line rounded-xl bg-canvas p-3 text-sm text-ink"><Bdi>{r.description}</Bdi></p>
        <dl className="mt-3">
          <Row label={t("customerPortal.f.customer")}>
            {r.customer ? <Link to={`/customers/${r.customer_id}`} className="text-brand-700 hover:underline"><Bdi>{r.customer.name}</Bdi></Link> : "—"}
          </Row>
          {r.vehicle && (
            <Row label={t("customerPortal.col.vehicle")}>
              <Link to={`/vehicles/${r.vehicle_id}`} className="text-brand-700 hover:underline"><Bdi>{r.vehicle.name}</Bdi></Link>
              {r.vehicle.license_plate && <> <Ltr className="text-xs text-ink-3">{r.vehicle.license_plate}</Ltr></>}
            </Row>
          )}
          {r.preferred_date && <Row label={t("customerPortal.f.preferredDate")}>{formatDate(r.preferred_date)}</Row>}
          {(r.contact_name || r.contact_phone) && (
            <Row label={t("customerPortal.f.contact")}>
              {r.contact_name && <Bdi>{r.contact_name}</Bdi>}
              {r.contact_phone && (
                <a href={`tel:${r.contact_phone}`} className="ms-2 inline-flex items-center gap-1 text-brand-700 hover:underline">
                  <Phone className="h-3.5 w-3.5" /><Ltr>{r.contact_phone}</Ltr>
                </a>
              )}
            </Row>
          )}
          <Row label={t("customerPortal.f.received")}>{formatDateTime(r.created_at, tenant.timezone)}</Row>
          {r.link?.label && <Row label={t("customerPortal.f.viaLink")}><Bdi>{r.link.label}</Bdi></Row>}
          {r.handler && <Row label={t("customerPortal.f.handledBy")}><Bdi>{personName(r.handler)}</Bdi></Row>}
          {r.resolved_at && <Row label={t("customerPortal.f.resolved")}>{formatDateTime(r.resolved_at, tenant.timezone)}</Row>}
        </dl>
      </div>
      {isManager ? (
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t("customerPortal.col.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus)}>
              {options.map((s) => <option key={s} value={s}>{t(`customerPortal.status.${s}`)}</option>)}
            </Select>
          </Field>
          {status === "scheduled" && (
            <Field label={t("customerPortal.f.scheduledFor")}>
              <Input type="date" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
            </Field>
          )}
          <Field label={t("customerPortal.f.handledBy")}>
            <Combobox {...members} value={handler} onChange={setHandler} placeholder={t("customerPortal.f.selectHandler")} />
          </Field>
          <Field label={t("customerPortal.f.internalNotes")} hint={t("customerPortal.f.internalNotesHint")}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={4000} />
          </Field>
          {error && <p className="rounded-xl bg-serious-soft px-3 py-2 text-sm text-serious">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{t("action.cancel")}</Button>
            <Button type="submit" loading={save.isPending}>{t("action.save")}</Button>
          </div>
        </form>
      ) : (
        r.internal_notes && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-ink">{t("customerPortal.f.internalNotes")}</h3>
            <p className="whitespace-pre-line text-sm text-ink-2"><Bdi>{r.internal_notes}</Bdi></p>
          </div>
        )
      )}
    </div>
  );
}

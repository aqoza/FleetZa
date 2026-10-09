import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, Pencil, Trash2 } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatDateTime, formatMoney } from "../../lib/format";
import { canConvertLead, leadMoves, type LeadStatus } from "../../../shared/crm";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { RecordActivities } from "./ActivityList";
import { ConvertForm, LeadForm } from "./forms";
import { leadTone, personName } from "./labels";
import { LEAD_SELECT, type Lead } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

type ModalKind = "edit" | "convert" | "delete" | null;

export default function LeadDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["crm_leads", "detail", id],
    queryFn: async () => (await listRows<Lead>("crm_leads", (b) => b.select(LEAD_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const customerId = q.data?.converted_customer_id ?? null;
  const customerQ = useQuery({
    queryKey: ["customers", "name", customerId],
    enabled: !!customerId,
    queryFn: async () => (await listRows<{ name: string }>("customers", (b) => b.select("name").eq("id", customerId!).limit(1)))[0] ?? null,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["crm_leads"] });
  const fail = (err: unknown) => setActionError(err instanceof Error ? err.message : t("common.error"));
  const step = useMutation({
    mutationFn: (to: LeadStatus) => updateRow("crm_leads", id, { status: to }),
    onSuccess: (_d, to) => { setActionError(""); refresh(); toast.success(t("crm.lead.statusSaved", { status: t(`crm.lead.status.${to}`) })); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("crm_leads", id),
    onSuccess: () => { refresh(); toast.success(t("crm.lead.deleted")); navigate("/crm/leads"); },
    onError: (err) => { fail(err); setModal(null); },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const l = q.data;
  if (!l) return <ErrorState message={t("crm.lead.notFound")} />;
  const close = () => setModal(null);
  const converted = l.status === "converted";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/crm/leads" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("crm.lead.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{l.doc_number}</Ltr>
        <Badge tone={leadTone[l.status]}>{t(`crm.lead.status.${l.status}`)}</Badge>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal("edit")}>
              <Pencil className="h-4 w-4" /> {t("action.edit")}
            </Button>
            {!converted && (
              <Button variant="ghost" onClick={() => setModal("delete")} aria-label={t("action.delete")} title={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {leadMoves(l.status).map((to) => (
              <Button key={to} variant="secondary" loading={step.isPending && step.variables === to} onClick={() => step.mutate(to)}>
                {t(`crm.lead.move.${to}`)}
              </Button>
            ))}
            {canConvertLead(l.status) && (
              <Button onClick={() => setModal("convert")}>
                <ArrowRightLeft className="h-4 w-4" /> {t("crm.convert.button")}
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      {converted && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-good-soft p-4 text-sm">
          <span className="font-medium text-good">{t("crm.lead.convertedOn", { date: ltrText(formatDateTime(l.converted_at, tenant.timezone)) })}</span>
          {customerId && (
            <Link to={`/customers/${customerId}`} className="text-brand-700 hover:underline">
              {t("crm.lead.viewCustomer", { name: bdiText(customerQ.data?.name ?? "…") })}
            </Link>
          )}
          {l.converted_opportunity_id && (
            <Link to={`/crm/o/${l.converted_opportunity_id}`} className="text-brand-700 hover:underline">{t("crm.lead.viewOpportunity")}</Link>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-2">
          <h1 className="text-base font-semibold text-ink"><Bdi>{l.company_name || l.name}</Bdi></h1>
          {l.company_name && <p className="text-sm text-ink-3"><Bdi>{l.name}</Bdi></p>}
          {l.interest && <p className="mt-2 text-sm text-ink-2"><Bdi>{l.interest}</Bdi></p>}
          <dl className="mt-3">
            {l.email && <Row label={t("crm.f.email")}><a href={`mailto:${l.email}`} className="text-brand-700 hover:underline"><Ltr>{l.email}</Ltr></a></Row>}
            {l.phone && <Row label={t("crm.f.phone")}><a href={`tel:${l.phone}`} className="text-brand-700 hover:underline"><Ltr>{l.phone}</Ltr></a></Row>}
            <Row label={t("crm.f.source")}>{t(`crm.source.${l.source}`)}</Row>
            <Row label={t("crm.f.owner")}>{l.owner ? <Bdi>{personName(l.owner)}</Bdi> : <span className="text-ink-3">—</span>}</Row>
            <Row label={t("crm.f.estimatedValue")}>
              {l.estimated_value == null ? <span className="text-ink-3">—</span> : <Ltr>{formatMoney(Number(l.estimated_value), l.currency)}</Ltr>}
            </Row>
            <Row label={t("crm.f.fleetSize")}>{l.fleet_size == null ? <span className="text-ink-3">—</span> : <Ltr>{String(l.fleet_size)}</Ltr>}</Row>
            <Row label={t("crm.col.created")}>{formatDateTime(l.created_at, tenant.timezone)}</Row>
            {l.notes && <Row label={t("crm.f.notes")}><Bdi className="whitespace-pre-line">{l.notes}</Bdi></Row>}
          </dl>
        </Card>
        <div className="lg:col-span-3">
          <RecordActivities links={{ lead_id: l.id, customer_id: l.converted_customer_id }} />
        </div>
      </div>

      <Modal title={t("crm.lead.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && (
          <LeadForm lead={l} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("crm.lead.saved")); }} />
        )}
      </Modal>
      <Modal title={t("crm.convert.title")} open={modal === "convert"} onClose={close}>
        {modal === "convert" && (
          <ConvertForm
            lead={l}
            onCancel={close}
            onDone={(r) => {
              close();
              refresh();
              void qc.invalidateQueries({ queryKey: ["crm_opportunities"] });
              void qc.invalidateQueries({ queryKey: ["customers"] });
              toast.success(t("crm.convert.done"));
              if (r.opportunity_id) navigate(`/crm/o/${r.opportunity_id}`);
            }}
          />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("crm.lead.deleteConfirm", { number: l.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

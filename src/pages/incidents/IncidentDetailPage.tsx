import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Lock, Pencil, Plus, RotateCcw, Search, Trash2, Wrench } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, listRows, updateRow, wrapDbError, type TableName } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import { INCIDENT_TRANSITIONS, isSerious, type IncidentStatus } from "../../../shared/incidents";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { EntityDocuments } from "../documents/EntityDocuments";
import { ClaimForm, IncidentForm, PartyForm, StepForm, type IncidentStep } from "./forms";
import { driverName, severityTone, statusTone } from "./labels";
import { INCIDENT_SELECT, PARTY_SELECT, type Incident, type IncidentEvent, type Party } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

// Typed by the Insurance module; only the number and status are read here.
const CLAIMS = "insurance_claims" as unknown as TableName;

type ModalKind = "edit" | "delete" | "party" | "claim" | IncidentStep | null;

export default function IncidentDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [editingParty, setEditingParty] = useState<Party | undefined>();
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["incidents", "detail", id],
    queryFn: async () => (await listRows<Incident>("incidents", (b) => b.select(INCIDENT_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const partiesQ = useQuery({
    queryKey: ["incident_parties", id],
    queryFn: () => listRows<Party>("incident_parties", (b) => b.select(PARTY_SELECT).eq("incident_id", id).order("created_at").limit(200)),
  });
  const eventsQ = useQuery({
    queryKey: ["incident_events", id],
    queryFn: () => listRows<IncidentEvent>("incident_events", (b) => b.select("id, status, at").eq("incident_id", id).order("at").limit(200)),
  });
  const claimId = q.data?.claim_id ?? null;
  const insuranceOn = isEnabled("insurance_mgmt");
  const claimQ = useQuery({
    queryKey: ["insurance_claims", "for-incident", claimId],
    enabled: !!claimId && insuranceOn,
    queryFn: async () =>
      (await listRows<{ id: string; doc_number: string | null; status: string }>(CLAIMS, (b) => b.select("id, doc_number, status").eq("id", claimId!).limit(1)))[0] ?? null,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["incidents"] });
    void qc.invalidateQueries({ queryKey: ["incident_events", id] });
  };
  const fail = (err: unknown) => setActionError(err instanceof Error ? err.message : t("common.error"));
  const step = useMutation({
    mutationFn: (to: IncidentStatus) => updateRow("incidents", id, { status: to }),
    onSuccess: (_d, to) => { setActionError(""); refresh(); toast.success(t("incidents.statusSaved", { status: t(`incidents.status.${to}`) })); },
    onError: fail,
  });
  const createWo = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("incident_create_work_order", { p_incident_id: id });
      if (error) throw wrapDbError(error);
      return data as string;
    },
    onSuccess: (woId) => { setActionError(""); refresh(); toast.success(t("incidents.woCreated")); navigate(`/maintenance/work-orders/${woId}`); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("incidents", id),
    onSuccess: () => { refresh(); toast.success(t("incidents.deleted")); navigate("/incidents/list"); },
    onError: (err) => { fail(err); setModal(null); },
  });
  const removeParty = useMutation({
    mutationFn: (partyId: string) => deleteRow("incident_parties", partyId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["incident_parties", id] }),
    onError: fail,
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const i = q.data;
  if (!i) return <ErrorState message={t("incidents.notFound")} />;

  const close = () => { setModal(null); setEditingParty(undefined); };
  const can = (to: IncidentStatus) => INCIDENT_TRANSITIONS[i.status].includes(to);
  const closed = i.status === "closed";
  const money = (n: number | null) => (n == null ? <span className="text-ink-3">—</span> : <Ltr>{formatMoney(n, i.currency)}</Ltr>);
  const parties = partiesQ.data ?? [];
  const events = eventsQ.data ?? [];
  const canWo = isManager && !closed && !i.work_order_id && isEnabled("maintenance");
  const canClaim = isManager && !closed && !i.claim_id && insuranceOn;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/incidents/list" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("incidents.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{i.doc_number}</Ltr>
        <Badge tone={statusTone[i.status]}>{t(`incidents.status.${i.status}`)}</Badge>
        <Badge tone={severityTone[i.severity]}>{t(`incidents.severity.${i.severity}`)}</Badge>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            {!closed && (
              <Button variant="secondary" onClick={() => setModal("edit")}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
            {i.status === "reported" && (
              <Button variant="ghost" onClick={() => setModal("delete")} aria-label={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {can("investigating") && (
              <Button variant={i.status === "resolved" ? "ghost" : "primary"} loading={step.isPending && step.variables === "investigating"}
                onClick={() => step.mutate("investigating")}>
                {i.status === "resolved" ? <RotateCcw className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                {i.status === "resolved" ? t("incidents.reopen") : t("incidents.investigate")}
              </Button>
            )}
            {can("awaiting_repair") && (
              <Button variant="secondary" loading={step.isPending && step.variables === "awaiting_repair"} onClick={() => step.mutate("awaiting_repair")}>
                <Wrench className="h-4 w-4" /> {t("incidents.awaitRepair")}
              </Button>
            )}
            {can("resolved") && (
              <Button onClick={() => setModal("resolved")}>
                <CheckCircle2 className="h-4 w-4" /> {t("incidents.step.resolved")}
              </Button>
            )}
            {can("closed") && (
              <Button onClick={() => setModal("closed")}>
                <Lock className="h-4 w-4" /> {t("incidents.step.closed")}
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card className="p-4">
            <p className="mb-3 whitespace-pre-line text-sm text-ink"><Bdi>{i.description}</Bdi></p>
            <dl>
              <Row label={t("incidents.f.type")}>{t(`incidents.type.${i.incident_type}`)}</Row>
              <Row label={t("incidents.f.vehicle")}>
                <Link to={`/vehicles/${i.vehicle_id}`} className="hover:underline"><Bdi>{i.vehicle?.name}</Bdi></Link>
                {i.vehicle?.license_plate && <div className="text-xs text-ink-3"><Ltr>{i.vehicle.license_plate}</Ltr></div>}
              </Row>
              <Row label={t("incidents.f.driver")}>
                {i.driver ? (
                  <Link to={`/incidents/list?driver=${i.driver_id}`} className="hover:underline"><Bdi>{driverName(i.driver)}</Bdi></Link>
                ) : <span className="text-ink-3">—</span>}
              </Row>
              <Row label={t("incidents.f.occurred")}>{formatDateTime(i.occurred_at, tenant.timezone)}</Row>
              {i.location && <Row label={t("incidents.f.location")}><Bdi>{i.location}</Bdi></Row>}
              <Row label={t("incidents.f.atFault")}>{t(`incidents.fault.${i.at_fault}`)}</Row>
              <Row label={t("incidents.d.casualties")}>
                <span className={i.injuries + i.fatalities > 0 ? "font-medium text-serious" : undefined}>
                  {t("incidents.d.casualtiesValue", { injuries: i.injuries, fatalities: i.fatalities })}
                </span>
              </Row>
              <Row label={t("incidents.f.drivable")}>{i.vehicle_drivable ? t("incidents.d.yes") : t("incidents.d.no")}</Row>
              {(i.police_report_number || i.police_station) && (
                <Row label={t("incidents.f.police")}>
                  {i.police_report_number && <Ltr>{i.police_report_number}</Ltr>}
                  {i.police_station && <div className="text-xs text-ink-3"><Bdi>{i.police_station}</Bdi></div>}
                </Row>
              )}
              {i.notes && <Row label={t("incidents.f.notes")}><Bdi className="whitespace-pre-line">{i.notes}</Bdi></Row>}
            </dl>
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{t("incidents.p.title")}</h2>
              {isManager && !closed && (
                <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setModal("party")}>
                  <Plus className="h-4 w-4" /> {t("incidents.p.add")}
                </Button>
              )}
            </div>
            {partiesQ.isLoading ? <LoadingState /> : parties.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">{t("incidents.p.empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {parties.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Bdi className="text-sm font-medium text-ink">{p.name}</Bdi>
                        <Badge tone="slate">{t(`incidents.party.${p.party_type}`)}</Badge>
                      </div>
                      <div className="text-xs text-ink-3">
                        {[p.phone, p.vehicle_plate, p.insurer, p.insurance_policy_number].filter(Boolean).map((x, k) => (
                          <span key={k}>{k > 0 && " · "}<Bdi>{x}</Bdi></span>
                        ))}
                      </div>
                      {p.statement && <p className="mt-1 whitespace-pre-line text-sm text-ink-2"><Bdi>{p.statement}</Bdi></p>}
                    </div>
                    {isManager && !closed && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" className="px-2.5 py-1.5" aria-label={t("action.edit")} onClick={() => { setEditingParty(p); setModal("party"); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="px-2.5 py-1.5" aria-label={t("action.delete")} loading={removeParty.isPending && removeParty.variables === p.id}
                          onClick={() => removeParty.mutate(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(i.root_cause || i.corrective_actions) && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("incidents.d.findings")}</h2>
              <dl>
                {i.root_cause && <Row label={t("incidents.d.rootCause")}><Bdi className="whitespace-pre-line">{i.root_cause}</Bdi></Row>}
                {i.corrective_actions && <Row label={t("incidents.d.corrective")}><Bdi className="whitespace-pre-line">{i.corrective_actions}</Bdi></Row>}
              </dl>
            </Card>
          )}
          {isEnabled("documents") && <EntityDocuments type="incident" id={i.id} />}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("incidents.d.costs")}</h2>
            <dl>
              <Row label={t("incidents.d.estimated")}>{money(i.estimated_damage)}</Row>
              <Row label={t("incidents.d.actual")}>{money(i.actual_cost)}</Row>
            </dl>
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t("incidents.d.follow")}</h2>
            <dl>
              <Row label={t("incidents.d.workOrder")}>
                {i.work_order_id && i.work_order ? (
                  <Link to={`/maintenance/work-orders/${i.work_order_id}`} className="text-brand-700 hover:underline">
                    {t("maintenance.workOrderNumber", { number: i.work_order.number })}
                  </Link>
                ) : canWo ? (
                  <Button variant="secondary" className="px-2.5 py-1.5" loading={createWo.isPending} onClick={() => createWo.mutate()}>
                    <Wrench className="h-4 w-4" /> {t("incidents.d.createWo")}
                  </Button>
                ) : <span className="text-ink-3">—</span>}
              </Row>
              {(insuranceOn || i.claim_id) && (
                <Row label={t("incidents.d.claim")}>
                  {i.claim_id ? (
                    insuranceOn && claimQ.data ? (
                      <Link to={`/insurance/claims/${i.claim_id}`} className="text-brand-700 hover:underline"><Ltr>{claimQ.data.doc_number}</Ltr></Link>
                    ) : <span className="text-ink-2">{t("incidents.d.claimLinked")}</span>
                  ) : canClaim ? (
                    <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setModal("claim")}>{t("incidents.claim.create")}</Button>
                  ) : <span className="text-ink-3">—</span>}
                </Row>
              )}
            </dl>
            {isManager && isSerious(i.severity) && !closed && !i.root_cause && (
              <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">{t("incidents.d.rootNeeded")}</p>
            )}
          </Card>
          {events.length > 0 && <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">{t("incidents.d.timeline")}</h2>
            <ol className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.status === "closed" || e.status === "resolved" ? "bg-chart-2" : "bg-chart-1"}`} />
                  <span className="text-sm text-ink">{t(`incidents.status.${e.status}`)}</span>
                  <span className="text-xs text-ink-3">{formatDateTime(e.at, tenant.timezone)}</span>
                </li>
              ))}
            </ol>
          </Card>}
        </div>
      </div>

      <Modal title={t("incidents.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && <IncidentForm incident={i} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("incidents.saved")); }} />}
      </Modal>
      {(["resolved", "closed"] as const).map((s) => (
        <Modal key={s} title={t(`incidents.stepTitle.${s}`, { number: i.doc_number ?? "" })} open={modal === s} onClose={close}>
          {modal === s && (
            <StepForm incident={i} step={s} onCancel={close}
              onDone={() => { close(); refresh(); toast.success(t("incidents.statusSaved", { status: t(`incidents.status.${s}`) })); }} />
          )}
        </Modal>
      ))}
      <Modal title={editingParty ? t("incidents.p.editTitle") : t("incidents.p.add")} open={modal === "party"} onClose={close}>
        {modal === "party" && (
          <PartyForm incidentId={i.id} party={editingParty} onCancel={close}
            onDone={() => { close(); void qc.invalidateQueries({ queryKey: ["incident_parties", id] }); }} />
        )}
      </Modal>
      <Modal title={t("incidents.claim.create")} open={modal === "claim"} onClose={close}>
        {modal === "claim" && (
          <ClaimForm incident={i} onCancel={close}
            onDone={(claimId) => { close(); refresh(); toast.success(t("incidents.claim.created")); navigate(`/insurance/claims/${claimId}`); }} />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("incidents.deleteConfirm", { number: i.doc_number ?? "" })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

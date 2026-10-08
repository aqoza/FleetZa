import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Pencil, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { formatDate, formatMoney } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { annualPremium, daysBetween, policyStatus } from "../../../shared/insurance";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { CancelPolicyForm, ClaimForm, CoverForm, PolicyForm } from "./forms";
import { claimTone, insurerName, policyTone, todayInTz } from "./labels";
import { CLAIM_SELECT, POLICY_SELECT, POLICY_VEHICLE_SELECT, type Claim, type Policy, type PolicyVehicle } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

type ModalKind = "edit" | "cancel" | "delete" | "cover" | "claim" | null;

export default function PolicyDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayInTz(tenant.timezone);
  const [modal, setModal] = useState<ModalKind>(null);
  const [showPast, setShowPast] = useState(false);
  const [actionError, setActionError] = useState("");

  const q = useQuery({
    queryKey: ["insurance_policies", "detail", id],
    queryFn: async () => (await listRows<Policy>("insurance_policies", (b) => b.select(POLICY_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const coverQ = useQuery({
    queryKey: ["insurance_policy_vehicles", id],
    queryFn: () =>
      listRows<PolicyVehicle>("insurance_policy_vehicles", (b) =>
        b.select(POLICY_VEHICLE_SELECT).eq("policy_id", id).order("removed_on", { ascending: false, nullsFirst: true })
          .order("added_on", { ascending: false }).limit(500)),
  });
  const claimsQ = useQuery({
    queryKey: ["insurance_claims", "policy", id],
    queryFn: () =>
      listRows<Claim>("insurance_claims", (b) => b.select(CLAIM_SELECT).eq("policy_id", id).order("claim_date", { ascending: false }).limit(200)),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["insurance_policies"] });
    void qc.invalidateQueries({ queryKey: ["insurance_policy_vehicles", id] });
    void qc.invalidateQueries({ queryKey: ["insurance_claims"] });
  };
  const onError = (err: unknown) => setActionError(err instanceof Error ? err.message : t("common.error"));
  const renew = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("insurance_renew_policy", { p_policy_id: id });
      if (error) throw wrapDbError(error);
      return data as string;
    },
    onSuccess: (newId) => {
      setActionError("");
      refresh();
      toast.success(t("insurance.renewed"));
      navigate(`/insurance/policies/${newId}`);
    },
    onError,
  });
  const reinstate = useMutation({
    mutationFn: () => updateRow("insurance_policies", id, { canceled_at: null }),
    onSuccess: () => { setActionError(""); refresh(); toast.success(t("insurance.reinstated")); },
    onError,
  });
  const removeCover = useMutation({
    // A row that hasn't started yet is simply dropped; otherwise its cover ends today.
    mutationFn: (row: PolicyVehicle) =>
      row.added_on >= today ? deleteRow("insurance_policy_vehicles", row.id) : updateRow("insurance_policy_vehicles", row.id, { removed_on: today }),
    onSuccess: () => { setActionError(""); refresh(); toast.success(t("insurance.cover.removed")); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("insurance_policies", id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["insurance_policies"] });
      toast.success(t("insurance.deleted"));
      navigate("/insurance/policies");
    },
    onError: (err) => { onError(err); setModal(null); },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const p = q.data;
  if (!p) return <ErrorState message={t("insurance.notFound")} />;

  const close = () => setModal(null);
  const status = policyStatus(p, today);
  const money = (n: number | null) => (n == null ? <span className="text-ink-3">—</span> : <Ltr>{formatMoney(n, p.currency)}</Ltr>);
  const cover = coverQ.data ?? [];
  const current = cover.filter((c) => c.removed_on == null);
  const past = cover.filter((c) => c.removed_on != null);
  const claims = claimsQ.data ?? [];
  const daysLeft = daysBetween(today, p.end_date);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/insurance/policies" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("insurance.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{p.policy_number}</Ltr>
        <Badge tone={policyTone[status]}>{t(`insurance.status.${status}`)}</Badge>
        <Bdi className="text-ink-2">{insurerName(p)}</Bdi>
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setModal("edit")}>
              <Pencil className="h-4 w-4" /> {t("action.edit")}
            </Button>
            {p.canceled_at ? (
              <Button variant="secondary" loading={reinstate.isPending} onClick={() => reinstate.mutate()}>
                <RotateCcw className="h-4 w-4" /> {t("insurance.reinstate")}
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setModal("cancel")}>
                  <Ban className="h-4 w-4" /> {t("insurance.cancelPolicy")}
                </Button>
                <Button loading={renew.isPending} onClick={() => renew.mutate()} title={t("insurance.renewHint")}>
                  <RefreshCw className="h-4 w-4" /> {t("insurance.renew")}
                </Button>
              </>
            )}
            {claims.length === 0 && (
              <Button variant="ghost" onClick={() => setModal("delete")} aria-label={t("action.delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <dl>
              <Row label={t("insurance.d.type")}>{t(`insurance.type.${p.policy_type}`)}</Row>
              <Row label={t("insurance.d.term")}>
                <div>{t("insurance.range", { from: ltrText(formatDate(p.start_date)), to: ltrText(formatDate(p.end_date)) })}</div>
                {(status === "active" || status === "expiring") && (
                  <div className="text-xs text-ink-3">{daysLeft === 0 ? t("insurance.endsToday") : tp("insurance.d.daysLeft", daysLeft)}</div>
                )}
              </Row>
              <Row label={t("insurance.d.premium")}>
                <div>{t("insurance.d.premiumValue", { amount: ltrText(formatMoney(p.premium, p.currency)), freq: t(`insurance.freq.${p.premium_frequency}`) })}</div>
                {p.premium_frequency !== "annual" && (
                  <div className="text-xs text-ink-3">
                    {t("insurance.d.perYear", { amount: ltrText(formatMoney(annualPremium(p.premium, p.premium_frequency), p.currency)) })}
                  </div>
                )}
              </Row>
              <Row label={t("insurance.d.coverage")}>{money(p.coverage_amount)}</Row>
              <Row label={t("insurance.d.deductible")}>{money(p.deductible)}</Row>
              {p.broker && <Row label={t("insurance.d.broker")}><Bdi>{p.broker}</Bdi></Row>}
              <Row label={t("insurance.d.autoRenew")}>{p.auto_renew ? t("insurance.d.yes") : t("insurance.d.no")}</Row>
              {p.canceled_at && (
                <Row label={t("insurance.d.canceled")}>
                  <div>{formatDate(p.canceled_at)}</div>
                  {p.cancel_reason && <div className="text-ink-2"><Bdi>{p.cancel_reason}</Bdi></div>}
                </Row>
              )}
              {p.notes && <Row label={t("insurance.d.notes")}><Bdi className="whitespace-pre-line">{p.notes}</Bdi></Row>}
            </dl>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-3">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{t("insurance.cover.title")}</h2>
              {isManager && !p.canceled_at && (
                <Button variant="secondary" onClick={() => setModal("cover")}>
                  <Plus className="h-4 w-4" /> {t("insurance.cover.add")}
                </Button>
              )}
            </div>
            {coverQ.isLoading ? <LoadingState /> : current.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">{t("insurance.cover.empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {current.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <Link to={`/vehicles/${c.vehicle_id}`} className="text-sm font-medium text-ink hover:underline">
                        <Bdi>{c.vehicle?.name}</Bdi>
                      </Link>
                      <div className="text-xs text-ink-3">
                        {c.vehicle?.license_plate && <><Ltr>{c.vehicle.license_plate}</Ltr> · </>}
                        {t("insurance.cover.since", { date: ltrText(formatDate(c.added_on)) })}
                      </div>
                    </div>
                    {isManager && (
                      <Button variant="ghost" aria-label={t("insurance.cover.remove")} loading={removeCover.isPending && removeCover.variables?.id === c.id}
                        onClick={() => removeCover.mutate(c)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {past.length > 0 && (
              <div className="mt-2">
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setShowPast((v) => !v)}>
                  {showPast ? t("insurance.cover.hidePast") : tp("insurance.cover.showPast", past.length)}
                </button>
                {showPast && (
                  <ul className="mt-1 divide-y divide-line">
                    {past.map((c) => (
                      <li key={c.id} className="py-1.5 text-sm text-ink-3">
                        <Bdi>{c.vehicle?.name}</Bdi>{" · "}
                        {t("insurance.range", { from: ltrText(formatDate(c.added_on)), to: ltrText(formatDate(c.removed_on)) })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {current.length === 0 && <p className="mt-1 text-xs text-ink-3">{t("insurance.cover.anyHint")}</p>}
          </Card>

          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{t("insurance.claimsTitle")}</h2>
              {isManager && (
                <Button variant="secondary" onClick={() => setModal("claim")}>
                  <Plus className="h-4 w-4" /> {t("insurance.c.new")}
                </Button>
              )}
            </div>
            {claimsQ.isLoading ? <LoadingState /> : claims.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">{t("insurance.claimsEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {claims.map((c) => (
                  <li key={c.id}>
                    <Link to={`/insurance/claims/${c.id}`} className="flex items-center gap-3 py-2 hover:bg-canvas">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Ltr className="text-sm font-medium text-brand-700">{c.doc_number}</Ltr>
                          <Badge tone={claimTone[c.status]}>{t(`insurance.claim.${c.status}`)}</Badge>
                        </div>
                        <div className="truncate text-xs text-ink-3"><Bdi>{c.description}</Bdi></div>
                      </div>
                      <Ltr className="shrink-0 text-sm text-ink">{formatMoney(c.amount_paid ?? c.amount_approved ?? c.amount_claimed, c.currency)}</Ltr>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal title={t("insurance.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && <PolicyForm policy={p} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("insurance.saved")); }} />}
      </Modal>
      <Modal title={t("insurance.cancelTitle", { number: p.policy_number })} open={modal === "cancel"} onClose={close}>
        {modal === "cancel" && <CancelPolicyForm policy={p} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("insurance.canceled")); }} />}
      </Modal>
      <Modal title={t("insurance.cover.addTitle")} open={modal === "cover"} onClose={close}>
        {modal === "cover" && <CoverForm policy={p} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("insurance.cover.added")); }} />}
      </Modal>
      <Modal title={t("insurance.c.newTitle")} open={modal === "claim"} onClose={close} wide>
        {modal === "claim" && (
          <ClaimForm policyId={p.id} onCancel={close}
            onDone={(claimId) => { close(); refresh(); toast.success(t("insurance.c.saved")); navigate(`/insurance/claims/${claimId}`); }} />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("insurance.deleteConfirm", { number: p.policy_number })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

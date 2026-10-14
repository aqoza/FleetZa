import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, Pencil, Plus, Receipt, RefreshCw, Trash2, Truck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { deleteRow, listRows, updateRow, wrapDbError } from "../../lib/db";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { daysToEnd, mrr, nextPeriod } from "../../../shared/contracts";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, useTp, type MessageKey } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ContractForm, NotesForm, RenewForm, TerminateForm, VehicleForm } from "./forms";
import { contractPeriodAmount, revenueTerms, statusTone, todayIn } from "./labels";
import { BILLED_SELECT, CONTRACT_SELECT, COVERED_SELECT, type BilledPeriod, type Contract, type CoveredVehicle } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

type ModalKind =
  | { kind: "edit" | "notes" | "terminate" | "renew" | "delete" | "activate" | "addVehicle" }
  | { kind: "editVehicle" | "removeVehicle"; vehicle: CoveredVehicle }
  | null;

export default function ContractDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionError, setActionError] = useState("");
  const billingOn = isEnabled("billing");

  const q = useQuery({
    queryKey: ["contracts", "detail", id],
    queryFn: async () => (await listRows<Contract>("contracts", (b) => b.select(CONTRACT_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const vehiclesQ = useQuery({
    queryKey: ["contracts", "vehicles", id],
    queryFn: () => listRows<CoveredVehicle>("contract_vehicles", (b) => b.select(COVERED_SELECT).eq("contract_id", id).order("created_at").limit(500)),
  });
  const billedQ = useQuery({
    queryKey: ["contract_invoices", id],
    queryFn: () => listRows<BilledPeriod>("contract_invoices", (b) =>
      b.select(BILLED_SELECT).eq("contract_id", id).order("period_start", { ascending: false }).limit(200)),
  });
  const linkIds = [q.data?.renewed_to, q.data?.renewed_from].filter((x): x is string => !!x);
  const linksQ = useQuery({
    queryKey: ["contracts", "links", linkIds],
    enabled: linkIds.length > 0,
    queryFn: () => listRows<{ id: string; doc_number: string | null }>("contracts", (b) => b.select("id, doc_number").in("id", linkIds)),
  });
  const docOf = (cid: string | null) => linksQ.data?.find((x) => x.id === cid)?.doc_number ?? "…";

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["contracts"] });
    void qc.invalidateQueries({ queryKey: ["contract_invoices"] });
  };
  const close = () => setModal(null);
  const fail = (err: unknown) => setActionError(err instanceof Error ? err.message : t("common.error"));

  const activate = useMutation({
    mutationFn: () => updateRow("contracts", id, { status: "active" }),
    onSuccess: () => { setActionError(""); close(); refresh(); toast.success(t("contracts.activated")); },
    onError: (err) => { fail(err); close(); },
  });
  const bill = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("contract_bill_period", { p_contract_id: id });
      if (error) throw wrapDbError(error);
      return data as string;
    },
    onSuccess: () => { setActionError(""); refresh(); void qc.invalidateQueries({ queryKey: ["invoices"] }); toast.success(t("contracts.bill.done")); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("contracts", id),
    onSuccess: () => { refresh(); toast.success(t("contracts.deleted")); navigate("/contracts/list"); },
    onError: (err) => { fail(err); close(); },
  });
  const removeVehicle = useMutation({
    mutationFn: (vid: string) => deleteRow("contract_vehicles", vid),
    onSuccess: () => { setActionError(""); close(); refresh(); toast.success(t("contracts.v.removed")); },
    onError: (err) => { fail(err); close(); },
  });

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  const c = q.data;
  if (!c) return <ErrorState message={t("contracts.notFound")} />;

  const today = todayIn(tenant.timezone);
  const open = c.status === "draft" || c.status === "active";
  const period = c.status === "active" ? nextPeriod(c) : null;
  const periodAmount = contractPeriodAmount(c);
  const canRenew = isManager && (c.status === "active" || c.status === "expired") && !!c.end_date;
  const canBill = isManager && billingOn && !!period;
  const left = c.status === "active" ? daysToEnd(c, today) : null;
  const vehicles = vehiclesQ.data ?? [];
  const money = (n: number) => formatMoney(n, c.currency);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/contracts/list" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("contracts.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{c.doc_number}</Ltr>
        <Badge tone={statusTone[c.status]}>{t(`contracts.status.${c.status}`)}</Badge>
        {isManager && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {open ? (
              <Button variant="secondary" onClick={() => setModal({ kind: "edit" })}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setModal({ kind: "notes" })}>
                <Pencil className="h-4 w-4" /> {t("contracts.editNotes")}
              </Button>
            )}
            {c.status === "draft" && (
              <>
                <Button variant="ghost" onClick={() => setModal({ kind: "delete" })} aria-label={t("action.delete")} title={t("action.delete")}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button onClick={() => setModal({ kind: "activate" })}>
                  <CheckCircle2 className="h-4 w-4" /> {t("contracts.activate")}
                </Button>
              </>
            )}
            {c.status === "active" && (
              <Button variant="secondary" onClick={() => setModal({ kind: "terminate" })}>
                <Ban className="h-4 w-4" /> {t("contracts.terminate.action")}
              </Button>
            )}
            {canRenew && (
              <Button variant="secondary" onClick={() => setModal({ kind: "renew" })}>
                <RefreshCw className="h-4 w-4" /> {t("contracts.renew.action")}
              </Button>
            )}
            {canBill && (
              <Button loading={bill.isPending} onClick={() => bill.mutate()}>
                <Receipt className="h-4 w-4" /> {t("contracts.bill.next")}
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && <ErrorState message={actionError} />}

      {c.status === "terminated" && (
        <div className="rounded-2xl bg-serious-soft p-4 text-sm">
          <div className="font-medium text-serious">{t("contracts.terminatedOn", { date: ltrText(formatDateTime(c.terminated_at, tenant.timezone)) })}</div>
          {c.termination_reason && <p className="mt-1 whitespace-pre-line text-ink-2"><Bdi>{c.termination_reason}</Bdi></p>}
        </div>
      )}
      {c.status === "expired" && (
        <div className="rounded-2xl bg-warn-soft p-4 text-sm font-medium text-warn">
          {t("contracts.expiredOn", { date: ltrText(formatDate(c.end_date)) })}
        </div>
      )}
      {c.renewed_to && (
        <div className="rounded-2xl border border-line bg-canvas p-4 text-sm text-ink-2">
          {t("contracts.renewedTo")}{" "}
          <Link to={`/contracts/c/${c.renewed_to}`} className="font-medium text-brand-700 hover:underline"><Ltr>{docOf(c.renewed_to)}</Ltr></Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <h1 className="text-base font-semibold text-ink"><Bdi>{c.title}</Bdi></h1>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-canvas p-3">
                <div className="text-xs text-ink-3">{c.billing_frequency === "one_time" ? t("contracts.f.amountOnce") : t("contracts.d.perPeriod")}</div>
                <Ltr className="text-lg font-semibold text-ink">{money(periodAmount)}</Ltr>
                <div className="text-xs text-ink-3">{t(`contracts.freq.${c.billing_frequency}`)}</div>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <div className="text-xs text-ink-3">{t("contracts.kpi.mrr")}</div>
                <Ltr className="text-lg font-semibold text-ink">{money(mrr({ ...revenueTerms(c), status: "active" }))}</Ltr>
                {left != null && (
                  <div className={`text-xs ${left <= 30 ? "text-serious" : "text-ink-3"}`}>
                    {left <= 0 ? t("contracts.ending.today") : tp("contracts.d.daysLeft", left)}
                  </div>
                )}
              </div>
            </div>
            <dl className="mt-3">
              <Row label={t("contracts.f.customer")}>
                {c.customer ? <Link to={`/customers/${c.customer_id}`} className="text-brand-700 hover:underline"><Bdi>{c.customer.name}</Bdi></Link> : "—"}
              </Row>
              <Row label={t("contracts.f.type")}>{t(`contracts.type.${c.contract_type}`)}</Row>
              <Row label={t("contracts.col.term")}>
                <Ltr>{`${formatDate(c.start_date)} – ${c.end_date ? formatDate(c.end_date) : t("contracts.d.openEnded")}`}</Ltr>
              </Row>
              {c.status === "active" && (
                <Row label={t("contracts.f.nextBilling")}>
                  {period ? (
                    <span className={period.start <= today ? "font-medium text-serious" : undefined}>
                      <Ltr>{`${formatDate(period.start)} – ${formatDate(period.end)}`}</Ltr>
                      {period.start <= today ? ` · ${t("contracts.d.due")}` : ""}
                    </span>
                  ) : <span className="text-ink-3">{t("contracts.d.fullyBilled")}</span>}
                </Row>
              )}
              <Row label={t("contracts.f.tax")}>{c.tax_rate == null ? t("contracts.d.defaultTax") : <Ltr>{`${c.tax_rate}%`}</Ltr>}</Row>
              <Row label={t("contracts.f.autoRenew")}>{c.auto_renew ? t("contracts.d.yes") : t("contracts.d.no")}</Row>
              <Row label={t("contracts.f.notice")}>{tp("contracts.d.days", c.notice_days)}</Row>
              {(c.signed_at || c.signed_by_name) && (
                <Row label={t("contracts.d.signed")}>
                  {c.signed_by_name && <Bdi>{c.signed_by_name}</Bdi>}
                  {c.signed_by_name && c.signed_at ? " · " : null}
                  {c.signed_at && formatDate(c.signed_at)}
                </Row>
              )}
              {c.activated_at && <Row label={t("contracts.d.activated")}>{formatDateTime(c.activated_at, tenant.timezone)}</Row>}
              {c.renewed_from && (
                <Row label={t("contracts.d.renewedFrom")}>
                  <Link to={`/contracts/c/${c.renewed_from}`} className="text-brand-700 hover:underline"><Ltr>{docOf(c.renewed_from)}</Ltr></Link>
                </Row>
              )}
              {c.notes && <Row label={t("contracts.f.notes")}><Bdi className="whitespace-pre-line">{c.notes}</Bdi></Row>}
            </dl>
          </Card>
          {c.terms && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{t("contracts.f.terms")}</h2>
              <p className="whitespace-pre-line text-sm text-ink-2"><Bdi>{c.terms}</Bdi></p>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-3">
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">{t("contracts.v.title")}</h2>
                <p className="text-xs text-ink-3">{t("contracts.v.hint")}</p>
              </div>
              {isManager && open && (
                <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setModal({ kind: "addVehicle" })}>
                  <Plus className="h-4 w-4" /> {t("contracts.v.add")}
                </Button>
              )}
            </div>
            {vehiclesQ.isLoading ? <LoadingState /> : vehicles.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">{t("contracts.v.empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {vehicles.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2.5">
                    <Truck className="h-4 w-4 shrink-0 text-ink-3" />
                    <Link to={`/vehicles/${v.vehicle_id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm text-ink"><Bdi>{v.vehicle?.name ?? "—"}</Bdi></span>
                      {v.vehicle?.license_plate && <Ltr className="block truncate text-xs text-ink-3">{v.vehicle.license_plate}</Ltr>}
                    </Link>
                    <span className="whitespace-nowrap text-sm">
                      {v.rate_override == null
                        ? <span className="text-ink-3">{t("contracts.v.noRate")}</span>
                        : <Ltr className="text-ink">{money(Number(v.rate_override))}</Ltr>}
                    </span>
                    {isManager && open && (
                      <span className="flex gap-1">
                        <Button variant="ghost" className="px-2 py-1" onClick={() => setModal({ kind: "editVehicle", vehicle: v })}
                          aria-label={t("action.edit")} title={t("action.edit")}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="px-2 py-1" onClick={() => setModal({ kind: "removeVehicle", vehicle: v })}
                          aria-label={t("action.delete")} title={t("action.delete")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">{t("contracts.h.title")}</h2>
            <p className="mb-2 text-xs text-ink-3">{t("contracts.h.hint")}</p>
            {billedQ.isLoading ? <LoadingState /> : (billedQ.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">{t("contracts.h.empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(billedQ.data ?? []).map((b) => {
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <Ltr className="block text-sm text-ink">{`${formatDate(b.period_start)} – ${formatDate(b.period_end)}`}</Ltr>
                        <span className="block text-xs text-ink-3">
                          {b.invoice ? <><Ltr>{b.invoice.doc_number}</Ltr> · {t(`enum.invoiceStatus.${b.invoice.status}` as MessageKey)}</> : t("contracts.h.invoice")}
                        </span>
                      </span>
                      {b.invoice && <Ltr className="whitespace-nowrap text-sm font-medium text-ink">{formatMoney(Number(b.invoice.total), b.invoice.currency)}</Ltr>}
                    </>
                  );
                  return (
                    <li key={b.id}>
                      {billingOn ? (
                        <Link to={`/sales/invoices/${b.invoice_id}`} className="flex items-center gap-3 py-2.5 hover:underline">{body}</Link>
                      ) : <div className="flex items-center gap-3 py-2.5">{body}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal title={t("contracts.editTitle")} open={modal?.kind === "edit"} onClose={close} wide>
        {modal?.kind === "edit" && (
          <ContractForm contract={c} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("contracts.saved")); }} />
        )}
      </Modal>
      <Modal title={t("contracts.editNotes")} open={modal?.kind === "notes"} onClose={close}>
        {modal?.kind === "notes" && (
          <NotesForm contract={c} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("contracts.saved")); }} />
        )}
      </Modal>
      <Modal title={t("contracts.terminate.title")} open={modal?.kind === "terminate"} onClose={close}>
        {modal?.kind === "terminate" && (
          <TerminateForm contract={c} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("contracts.terminated")); }} />
        )}
      </Modal>
      <Modal title={t("contracts.renew.title")} open={modal?.kind === "renew"} onClose={close}>
        {modal?.kind === "renew" && (
          <RenewForm contract={c} onCancel={close} onDone={(nid) => { close(); refresh(); toast.success(t("contracts.renewed")); navigate(`/contracts/c/${nid}`); }} />
        )}
      </Modal>
      <Modal title={modal?.kind === "editVehicle" ? t("contracts.v.editTitle") : t("contracts.v.addTitle")}
        open={modal?.kind === "addVehicle" || modal?.kind === "editVehicle"} onClose={close}>
        {(modal?.kind === "addVehicle" || modal?.kind === "editVehicle") && (
          <VehicleForm contractId={c.id} customerId={c.customer_id} covered={modal.kind === "editVehicle" ? modal.vehicle : undefined}
            onCancel={close} onDone={() => { close(); refresh(); toast.success(t("contracts.v.saved")); }} />
        )}
      </Modal>
      <Modal title={t("contracts.activate")} open={modal?.kind === "activate"} onClose={close}>
        <p className="text-sm text-ink-2">{t("contracts.activateConfirm", { date: ltrText(formatDate(c.start_date)) })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button loading={activate.isPending} onClick={() => activate.mutate()}>{t("contracts.activate")}</Button>
        </div>
      </Modal>
      <Modal title={t("action.delete")} open={modal?.kind === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("contracts.deleteConfirm", { number: ltrText(c.doc_number ?? "") })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
      <Modal title={t("contracts.v.removeTitle")} open={modal?.kind === "removeVehicle"} onClose={close}>
        {modal?.kind === "removeVehicle" && (
          <>
            <p className="text-sm text-ink-2">{t("contracts.v.removeConfirm", { name: bdiText(modal.vehicle.vehicle?.name ?? "") })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
              <Button variant="danger" loading={removeVehicle.isPending} onClick={() => removeVehicle.mutate(modal.vehicle.id)}>{t("action.delete")}</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, ExternalLink, ListChecks, Pencil, Trash2, Wand2 } from "lucide-react";
import { deleteRow, getRow, listRows, updateRow } from "../../lib/db";
import { STATE_ORDER, obligationState, type ObligationState, type ObligationStatus } from "../../../shared/regulatory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { GenerateForm, RequirementForm } from "./forms";
import { reqTitle, stateTone, todayIn } from "./labels";
import { useFrequencyText } from "./RequirementsPage";
import type { Requirement } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function RequirementDetailPage() {
  const { id = "" } = useParams();
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const frequency = useFrequencyText();
  const [modal, setModal] = useState<"edit" | "generate" | "delete" | null>(null);
  const [actionError, setActionError] = useState("");
  const today = todayIn(tenant.timezone);

  const q = useQuery({ queryKey: ["compliance_requirements", "detail", id], queryFn: () => getRow<Requirement>("compliance_requirements", id) });
  const oblQ = useQuery({
    queryKey: ["compliance_obligations", "for-requirement", id],
    queryFn: () =>
      listRows<{ status: ObligationStatus; due_date: string }>("compliance_obligations", (b) =>
        b.select("status, due_date").eq("requirement_id", id).limit(20000)),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["compliance_requirements"] });
  const verify = useMutation({
    mutationFn: () => updateRow("compliance_requirements", id, { verified: true }),
    onSuccess: () => { refresh(); toast.success(t("regulatory.r.verifiedDone")); },
    onError: (err) => setActionError(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("compliance_requirements", id),
    onSuccess: () => { refresh(); toast.success(t("regulatory.r.deleted")); navigate("/regulatory/requirements"); },
    onError: (err) => { setActionError(err instanceof Error ? err.message : t("common.error")); setModal(null); },
  });

  const r = q.data;
  const states = useMemo(() => {
    const m = new Map<ObligationState, number>();
    for (const o of oblQ.data ?? []) {
      const s = obligationState(o, r?.lead_days ?? 30, today);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [oblQ.data, r?.lead_days, today]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState message={(q.error as Error).message} />;
  if (!r) return <ErrorState message={t("regulatory.r.notFound")} />;
  const close = () => setModal(null);
  const total = oblQ.data?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/regulatory/requirements" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("regulatory.r.back")}
        </Link>
        <Ltr className="text-lg font-semibold text-ink">{r.code}</Ltr>
        {!r.verified && <Badge tone="yellow">{t("regulatory.r.unverified")}</Badge>}
        {!r.active && <Badge tone="slate">{t("regulatory.r.inactive")}</Badge>}
        {isManager && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setModal("delete")} aria-label={t("action.delete")}><Trash2 className="h-4 w-4" /></Button>
            <Button variant="secondary" onClick={() => setModal("edit")}><Pencil className="h-4 w-4" /> {t("action.edit")}</Button>
            {!r.verified && (
              <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
                <BadgeCheck className="h-4 w-4" /> {t("regulatory.r.markVerified")}
              </Button>
            )}
            {r.active && <Button onClick={() => setModal("generate")}><Wand2 className="h-4 w-4" /> {t("regulatory.gen.open")}</Button>}
          </div>
        )}
      </div>
      {actionError && <ErrorState message={actionError} />}
      {!r.verified && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{t("regulatory.r.unverifiedHint")}</p>}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-4 lg:col-span-3">
          <h2 className="text-base font-semibold text-ink"><Bdi>{reqTitle(r, language)}</Bdi></h2>
          {language === "ar" ? r.title_ar && <p className="text-sm text-ink-3"><Bdi>{r.title}</Bdi></p>
            : r.title_ar && <p className="text-sm text-ink-3" dir="rtl">{r.title_ar}</p>}
          {r.description && <p className="mt-3 whitespace-pre-line text-sm text-ink-2"><Bdi>{r.description}</Bdi></p>}
          <dl className="mt-3">
            <Row label={t("regulatory.f.appliesTo")}>{t(`regulatory.subjects.${r.applies_to}`)}</Row>
            <Row label={t("regulatory.f.category")}>{t(`regulatory.cat.${r.category}`)}</Row>
            <Row label={t("regulatory.f.frequencyShort")}>{frequency(r.frequency_months)}</Row>
            <Row label={t("regulatory.f.lead")}>{tp("regulatory.days", r.lead_days)}</Row>
            {r.authority && <Row label={t("regulatory.f.authority")}><Bdi>{r.authority}</Bdi></Row>}
            {r.country && <Row label={t("regulatory.f.countryShort")}><Ltr>{r.country}</Ltr></Row>}
            {r.reference_url && (
              <Row label={t("regulatory.f.reference")}>
                <a href={r.reference_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  <Ltr className="max-w-56 truncate">{r.reference_url.replace(/^https?:\/\//, "")}</Ltr> <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Row>
            )}
          </dl>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-ink">{t("regulatory.r.obligations")}</h2>
          <p className="mb-3 text-xs text-ink-3">{tp("regulatory.r.obligationsCount", total)}</p>
          {total > 0 && (
            <ul className="mb-3 space-y-2">
              {STATE_ORDER.filter((s) => states.get(s)).map((s) => (
                <li key={s} className="flex items-center justify-between gap-3">
                  <Badge tone={stateTone[s]}>{t(`regulatory.state.${s}`)}</Badge>
                  <Ltr className="text-sm font-medium text-ink">{String(states.get(s))}</Ltr>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/regulatory/obligations?requirement=${r.id}`} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
            <ListChecks className="h-4 w-4" /> {t("regulatory.r.viewObligations")}
          </Link>
        </Card>
      </div>

      <Modal title={t("regulatory.r.editTitle")} open={modal === "edit"} onClose={close} wide>
        {modal === "edit" && <RequirementForm requirement={r} onCancel={close} onDone={() => { close(); refresh(); toast.success(t("regulatory.r.saved")); }} />}
      </Modal>
      <Modal title={t("regulatory.gen.title", { title: reqTitle(r, language) })} open={modal === "generate"} onClose={close}>
        {modal === "generate" && (
          <GenerateForm requirement={r} onCancel={close}
            onDone={(n) => {
              close();
              void qc.invalidateQueries({ queryKey: ["compliance_obligations"] });
              toast.success(n > 0 ? tp("regulatory.gen.created", n) : t("regulatory.gen.none"));
            }} />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={modal === "delete"} onClose={close}>
        <p className="text-sm text-ink-2">{t("regulatory.r.deleteConfirm", { code: r.code })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

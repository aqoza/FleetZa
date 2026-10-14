import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, FileText, Pencil, RotateCcw, ShieldOff, Trash2 } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { daysBetween, obligationState } from "../../../shared/regulatory";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT, useTp } from "../../i18n";
import { Badge, Bdi, Button, ErrorState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { openDocument } from "../documents/storage";
import { CompleteForm, ObligationForm, StatusForm, type StatusStep } from "./forms";
import { reqTitle, stateTone, subjectHref, todayIn } from "./labels";
import type { Obligation } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  );
}

/** Due text: "in 5 days", "today", "3 days late". */
export function useDueText() {
  const t = useT();
  const tp = useTp();
  const tenant = useTenant();
  const today = todayIn(tenant.timezone);
  return (due: string) => {
    const d = daysBetween(today, due);
    return d === 0 ? t("regulatory.dueToday") : d > 0 ? tp("regulatory.dueIn", d) : tp("regulatory.dueLate", -d);
  };
}

type Mode = "view" | "edit" | "complete" | "delete" | StatusStep;

export function ObligationDialog({ obligation, subjectName, onClose }: {
  obligation: Obligation | null;
  subjectName?: string;
  onClose: () => void;
}) {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const qc = useQueryClient();
  const toast = useToast();
  const dueText = useDueText();
  const [mode, setMode] = useState<Mode>("view");
  const [error, setError] = useState("");
  const o = obligation;

  const evidenceQ = useQuery({
    queryKey: ["documents", "evidence", o?.evidence_document_id],
    enabled: !!o?.evidence_document_id && isEnabled("documents"),
    queryFn: async () =>
      (await listRows<{ id: string; name: string; storage_path: string }>("documents", (q) =>
        q.select("id, name, storage_path").eq("id", o!.evidence_document_id!).limit(1)))[0] ?? null,
  });

  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: ["compliance_obligations"] });
    toast.success(msg);
    setMode("view");
    setError("");
    onClose();
  };
  const reopen = useMutation({
    mutationFn: () => updateRow("compliance_obligations", o!.id, { status: "pending" }),
    onSuccess: () => done(t("regulatory.o.reopened")),
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => deleteRow("compliance_obligations", o!.id),
    onSuccess: () => done(t("regulatory.o.deleted")),
    onError: (err) => { setError(err instanceof Error ? err.message : t("common.error")); setMode("view"); },
  });

  const close = () => { setMode("view"); setError(""); onClose(); };
  if (!o) return <Modal title="" open={false} onClose={close}>{null}</Modal>;
  const state = obligationState(o, o.requirement?.lead_days ?? 30, todayIn(tenant.timezone));
  const title = reqTitle(o.requirement, language);
  const subjectLink = subjectHref(o.subject_type, o.subject_id);
  const open = o.status === "pending" || o.status === "non_compliant";

  const titles: Record<Mode, string> = {
    view: title,
    edit: t("regulatory.o.editTitle"),
    complete: t("regulatory.c.title", { title }),
    delete: t("action.delete"),
    non_compliant: t("regulatory.s.title.non_compliant"),
    waived: t("regulatory.s.title.waived"),
  };

  return (
    <Modal title={titles[mode]} open={!!o} onClose={close}>
      {mode === "view" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stateTone[state]}>{t(`regulatory.state.${state}`)}</Badge>
            <Ltr className="text-xs text-ink-3">{o.requirement?.code}</Ltr>
          </div>
          <dl>
            <Row label={t(`regulatory.subject.${o.subject_type}`)}>
              {o.subject_type === "company" ? t("regulatory.subject.companyWide")
                : subjectLink ? <Link to={subjectLink} className="text-brand-700 hover:underline"><Bdi>{subjectName ?? "…"}</Bdi></Link>
                : <Bdi>{subjectName ?? "…"}</Bdi>}
            </Row>
            <Row label={t("regulatory.o.due")}>
              {formatDate(o.due_date)}
              {open && <div className="text-xs text-ink-3">{dueText(o.due_date)}</div>}
            </Row>
            {o.completed_on && <Row label={t("regulatory.c.completedOn")}>{formatDate(o.completed_on)}</Row>}
            {o.responsible && <Row label={t("regulatory.o.responsible")}><Bdi>{o.responsible.full_name || o.responsible.email}</Bdi></Row>}
            {o.evidence_document_id && (
              <Row label={t("regulatory.c.evidence")}>
                {evidenceQ.data ? (
                  <button type="button" className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                    onClick={() => void openDocument(evidenceQ.data!)}>
                    <FileText className="h-4 w-4" /> <Bdi>{evidenceQ.data.name}</Bdi>
                  </button>
                ) : <span className="text-ink-3">{t("regulatory.c.evidenceAttached")}</span>}
              </Row>
            )}
            {o.notes && <Row label={t("regulatory.o.notes")}><Bdi className="whitespace-pre-line">{o.notes}</Bdi></Row>}
          </dl>
          {error && <ErrorState message={error} />}
          {isManager && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <Button variant="ghost" onClick={() => setMode("delete")} aria-label={t("action.delete")}><Trash2 className="h-4 w-4" /></Button>
              <Button variant="secondary" onClick={() => setMode("edit")}><Pencil className="h-4 w-4" /> {t("action.edit")}</Button>
              {open ? (
                <>
                  {o.status !== "non_compliant" && (
                    <Button variant="secondary" onClick={() => setMode("non_compliant")}><Ban className="h-4 w-4" /> {t("regulatory.s.do.non_compliant")}</Button>
                  )}
                  <Button variant="secondary" onClick={() => setMode("waived")}><ShieldOff className="h-4 w-4" /> {t("regulatory.s.do.waived")}</Button>
                  <Button onClick={() => setMode("complete")}><CheckCircle2 className="h-4 w-4" /> {t("regulatory.c.complete")}</Button>
                </>
              ) : (
                <Button variant="secondary" loading={reopen.isPending} onClick={() => reopen.mutate()}>
                  <RotateCcw className="h-4 w-4" /> {t("regulatory.o.reopen")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {mode === "edit" && <ObligationForm obligation={o} onCancel={() => setMode("view")} onDone={() => done(t("regulatory.o.saved"))} />}
      {mode === "complete" && (
        <CompleteForm obligation={o} onCancel={() => setMode("view")}
          onDone={(next) => done(next ? t("regulatory.c.doneNext") : t("regulatory.c.done"))} />
      )}
      {(mode === "non_compliant" || mode === "waived") && (
        <StatusForm obligation={o} step={mode} onCancel={() => setMode("view")}
          onDone={() => done(t("regulatory.o.statusSaved", { status: t(`regulatory.state.${mode}`) }))} />
      )}
      {mode === "delete" && (
        <>
          <p className="text-sm text-ink-2">{t("regulatory.o.deleteConfirm", { title })}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMode("view")}>{t("action.cancel")}</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t("action.delete")}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

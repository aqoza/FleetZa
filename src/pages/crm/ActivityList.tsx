import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { bdiText } from "../../lib/bidi";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { activityState } from "../../../shared/crm";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, LoadingState, Ltr, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ActivityForm } from "./forms";
import { activityIcon, activityTone, dayIn, personName } from "./labels";
import { ACTIVITY_SELECT, type Activity } from "./types";

/**
 * Activities as a list with done / edit / delete for managers. `showLinks`
 * adds what each activity is about, for lists that mix records.
 */
export function ActivityList({ rows, showLinks = false }: { rows: Activity[]; showLinks?: boolean }) {
  const t = useT();
  const tenant = useTenant();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Activity | undefined>();
  const [deleting, setDeleting] = useState<Activity | undefined>();
  const now = new Date();
  const key = (iso: string) => dayIn(iso, tenant.timezone);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["crm_activities"] });
  const toggle = useMutation({
    mutationFn: (a: Activity) => updateRow("crm_activities", a.id, { done_at: a.done_at ? null : new Date().toISOString() }),
    onSuccess: (_d, a) => { refresh(); toast.success(a.done_at ? t("crm.act.reopened") : t("crm.act.doneToast")); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: (a: Activity) => deleteRow("crm_activities", a.id),
    onSuccess: () => { setDeleting(undefined); refresh(); toast.success(t("crm.act.deleted")); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <>
      <ul className="divide-y divide-line">
        {rows.map((a) => {
          const Icon = activityIcon[a.activity_type];
          const state = activityState(a, now, key);
          const when = a.done_at ?? a.due_at;
          return (
            <li key={a.id} className="flex items-start gap-3 py-2.5">
              <span className={`mt-0.5 rounded-lg p-1.5 ${state === "done" ? "bg-canvas text-ink-3" : "bg-brand-50 text-brand-700"}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-sm ${state === "done" ? "text-ink-3 line-through" : "font-medium text-ink"}`}><Bdi>{a.subject}</Bdi></span>
                  {a.activity_type !== "note" && <Badge tone={activityTone[state]}>{t(`crm.act.state.${state}`)}</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-3">
                  <span>{t(`crm.activity.${a.activity_type}`)}</span>
                  {when && <span>· {formatDateTime(when, tenant.timezone)}</span>}
                  {a.owner && <span>· <Bdi>{personName(a.owner)}</Bdi></span>}
                  {showLinks && a.opportunity && (
                    <Link to={`/crm/o/${a.opportunity_id}`} className="text-brand-700 hover:underline">
                      · <Ltr>{a.opportunity.doc_number}</Ltr> <Bdi>{a.opportunity.title}</Bdi>
                    </Link>
                  )}
                  {showLinks && !a.opportunity && a.lead && (
                    <Link to={`/crm/leads/${a.lead_id}`} className="text-brand-700 hover:underline">
                      · <Ltr>{a.lead.doc_number}</Ltr> <Bdi>{a.lead.name}</Bdi>
                    </Link>
                  )}
                  {showLinks && !a.opportunity && !a.lead && a.customer && (
                    <Link to={`/customers/${a.customer_id}`} className="text-brand-700 hover:underline">· <Bdi>{a.customer.name}</Bdi></Link>
                  )}
                </div>
                {a.body && <p className="mt-1 whitespace-pre-line text-sm text-ink-2"><Bdi>{a.body}</Bdi></p>}
              </div>
              {isManager && (
                <div className="flex shrink-0 gap-1">
                  {a.activity_type !== "note" && (
                    <Button variant="ghost" className="px-2 py-1.5" onClick={() => toggle.mutate(a)}
                      aria-label={a.done_at ? t("crm.act.reopen") : t("crm.act.markDone")} title={a.done_at ? t("crm.act.reopen") : t("crm.act.markDone")}>
                      {a.done_at ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </Button>
                  )}
                  <Button variant="ghost" className="px-2 py-1.5" onClick={() => setEditing(a)} aria-label={t("action.edit")} title={t("action.edit")}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="px-2 py-1.5" onClick={() => setDeleting(a)}
                    aria-label={t("action.delete")} title={t("action.delete")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Modal title={t("crm.act.editTitle")} open={!!editing} onClose={() => setEditing(undefined)}>
        {editing && (
          <ActivityForm
            activity={editing}
            onCancel={() => setEditing(undefined)}
            onDone={() => { setEditing(undefined); refresh(); toast.success(t("crm.act.saved")); }}
          />
        )}
      </Modal>
      <Modal title={t("action.delete")} open={!!deleting} onClose={() => setDeleting(undefined)}>
        <p className="text-sm text-ink-2">{t("crm.act.confirmDelete", { subject: bdiText(deleting?.subject ?? "") })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleting(undefined)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>{t("action.delete")}</Button>
        </div>
      </Modal>
    </>
  );
}

/** The activities card on a lead, opportunity or customer page. */
export function RecordActivities({
  links, title,
}: {
  links: { lead_id?: string | null; opportunity_id?: string | null; customer_id?: string | null };
  title?: string;
}) {
  const t = useT();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [col, id] = links.opportunity_id
    ? ["opportunity_id", links.opportunity_id]
    : links.lead_id
      ? ["lead_id", links.lead_id]
      : ["customer_id", links.customer_id ?? ""];
  const q = useQuery({
    queryKey: ["crm_activities", "record", col, id],
    enabled: !!id,
    queryFn: () =>
      listRows<Activity>("crm_activities", (b) =>
        b.select(ACTIVITY_SELECT).eq(col, id).order("done_at", { ascending: false, nullsFirst: true })
          .order("due_at", { ascending: true, nullsFirst: false }).limit(200)),
  });
  const rows = q.data ?? [];

  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title ?? t("crm.act.title")}</h2>
        {isManager && (
          <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("crm.act.add")}
          </Button>
        )}
      </div>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {q.data && rows.length === 0 && <p className="py-4 text-center text-sm text-ink-3">{t("crm.act.emptyRecord")}</p>}
      {rows.length > 0 && <ActivityList rows={rows} />}
      <Modal title={t("crm.act.newTitle")} open={adding} onClose={() => setAdding(false)}>
        {adding && (
          <ActivityForm
            links={links}
            onCancel={() => setAdding(false)}
            onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: ["crm_activities"] }); toast.success(t("crm.act.saved")); }}
          />
        )}
      </Modal>
    </Card>
  );
}

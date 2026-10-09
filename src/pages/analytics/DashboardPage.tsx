import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, LayoutDashboard, Lock, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { deleteRow, listRows, updateRow } from "../../lib/db";
import { bdiText } from "../../lib/bidi";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DashboardForm } from "./DashboardForm";
import { WidgetCard } from "./WidgetCard";
import { WidgetForm } from "./WidgetForm";
import { DASHBOARD_SELECT, useWidgets, type BiDashboard, type BiWidget } from "./types";

export default function DashboardPage() {
  const t = useT();
  const { id = "" } = useParams();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [widgetForm, setWidgetForm] = useState<BiWidget | "new" | null>(null);
  const [removing, setRemoving] = useState<BiWidget | null>(null);
  const dq = useQuery({
    queryKey: ["bi_dashboards", "one", id],
    queryFn: async () => (await listRows<BiDashboard>("bi_dashboards", (b) => b.select(DASHBOARD_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
  const wq = useWidgets(id);
  const widgets = wq.data ?? [];
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : t("common.error"));
  const refreshWidgets = () => void qc.invalidateQueries({ queryKey: ["bi_widgets", id] });

  const move = useMutation({
    mutationFn: async ({ index, dir }: { index: number; dir: -1 | 1 }) => {
      const a = widgets[index];
      const b = widgets[index + dir];
      if (!a || !b) return;
      // Renumber the whole list so equal positions cannot stall a swap.
      const order = widgets.map((w) => w.id);
      [order[index], order[index + dir]] = [order[index + dir], order[index]];
      await Promise.all(order.map((wid, i) => (widgets.find((w) => w.id === wid)?.position === i + 1 ? null : updateRow("bi_widgets", wid, { position: i + 1 }))));
    },
    onSuccess: refreshWidgets,
    onError: fail,
  });
  const removeWidget = useMutation({
    mutationFn: (w: BiWidget) => deleteRow("bi_widgets", w.id),
    onSuccess: () => { setRemoving(null); refreshWidgets(); toast.success(t("analytics.w.deleted")); },
    onError: fail,
  });
  const removeDashboard = useMutation({
    mutationFn: () => deleteRow("bi_dashboards", id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["bi_dashboards"] }); toast.success(t("analytics.deleted")); navigate("/analytics"); },
    onError: fail,
  });

  if (dq.isLoading) return <LoadingState />;
  if (dq.error) return <ErrorState message={(dq.error as Error).message} />;
  const d = dq.data;
  if (!d) return <ErrorState message={t("analytics.notFound")} />;

  return (
    <div>
      <Link to="/analytics" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink print:hidden">
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("analytics.back")}
      </Link>
      <PageHeader
        title={bdiText(d.name)}
        description={d.description ? bdiText(d.description) : undefined}
        actions={isManager ? (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {editing ? (
              <>
                <Button variant="secondary" onClick={() => setRenaming(true)}><Pencil className="h-4 w-4" /> {t("analytics.edit")}</Button>
                <Button variant="secondary" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" /> {t("analytics.delete")}</Button>
                <Button variant="secondary" onClick={() => setWidgetForm("new")}><Plus className="h-4 w-4" /> {t("analytics.w.add")}</Button>
                <Button onClick={() => setEditing(false)}><Check className="h-4 w-4" /> {t("analytics.doneEditing")}</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setEditing(true)}><Settings2 className="h-4 w-4" /> {t("analytics.customize")}</Button>
            )}
          </div>
        ) : undefined}
      />
      {!d.is_shared && (
        <p className="mb-3"><Badge tone="slate"><Lock className="me-1 inline h-3 w-3" />{t("analytics.privateHint")}</Badge></p>
      )}
      {wq.isLoading && <LoadingState />}
      {wq.error && <ErrorState message={(wq.error as Error).message} />}
      {wq.data && widgets.length === 0 && (
        <EmptyState
          icon={<LayoutDashboard className="h-10 w-10" />}
          title={t("analytics.noWidgets")}
          description={isManager ? t("analytics.noWidgetsHint") : t("analytics.noWidgetsViewer")}
          action={isManager ? <Button onClick={() => { setEditing(true); setWidgetForm("new"); }}><Plus className="h-4 w-4" /> {t("analytics.w.add")}</Button> : undefined}
        />
      )}
      {widgets.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {widgets.map((w, i) => (
            <WidgetCard
              key={w.id}
              widget={w}
              editing={editing}
              first={i === 0}
              last={i === widgets.length - 1}
              onMove={(dir) => move.mutate({ index: i, dir })}
              onEdit={() => setWidgetForm(w)}
              onDelete={() => setRemoving(w)}
            />
          ))}
        </div>
      )}
      <Modal title={widgetForm === "new" ? t("analytics.w.addTitle") : t("analytics.w.editTitle")} open={!!widgetForm} onClose={() => setWidgetForm(null)}>
        {widgetForm && (
          <WidgetForm
            dashboardId={id}
            widget={widgetForm === "new" ? null : widgetForm}
            nextPosition={(widgets.at(-1)?.position ?? 0) + 1}
            onCancel={() => setWidgetForm(null)}
            onDone={() => { setWidgetForm(null); refreshWidgets(); toast.success(t("analytics.saved")); }}
          />
        )}
      </Modal>
      <Modal title={t("analytics.edit")} open={renaming} onClose={() => setRenaming(false)}>
        {renaming && (
          <DashboardForm dashboard={d} onCancel={() => setRenaming(false)}
            onDone={() => { setRenaming(false); void qc.invalidateQueries({ queryKey: ["bi_dashboards"] }); toast.success(t("analytics.saved")); }} />
        )}
      </Modal>
      <Modal title={t("analytics.delete")} open={deleting} onClose={() => setDeleting(false)} busy={removeDashboard.isPending}>
        <p className="text-sm text-ink-2">{t("analytics.deleteConfirm", { name: d.name })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={removeDashboard.isPending} onClick={() => removeDashboard.mutate()}>{t("analytics.delete")}</Button>
        </div>
      </Modal>
      <Modal title={t("analytics.w.delete")} open={!!removing} onClose={() => setRemoving(null)} busy={removeWidget.isPending}>
        <p className="text-sm text-ink-2"><Bdi>{t("analytics.w.deleteConfirm")}</Bdi></p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRemoving(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={removeWidget.isPending} onClick={() => removing && removeWidget.mutate(removing)}>{t("analytics.w.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}

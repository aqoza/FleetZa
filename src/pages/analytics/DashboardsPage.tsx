import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Lock, Plus, Sparkles } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { listRows, wrapDbError } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { ltrText } from "../../lib/bidi";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Modal } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { DashboardForm } from "./DashboardForm";
import { DASHBOARD_SELECT, type BiDashboard } from "./types";

export default function DashboardsPage() {
  const t = useT();
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["bi_dashboards"],
    queryFn: () => listRows<BiDashboard>("bi_dashboards", (b) => b.select(DASHBOARD_SELECT).order("name").limit(200)),
  });
  const starter = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("bi_create_default_dashboard", { p_name: t("analytics.defaultName") });
      if (error) throw wrapDbError(error);
      return data as string;
    },
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ["bi_dashboards"] }); navigate(`/analytics/${id}`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("common.error")),
  });

  const actions = isManager && (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" loading={starter.isPending} onClick={() => starter.mutate()}>
        <Sparkles className="h-4 w-4" /> {t("analytics.createDefault")}
      </Button>
      <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t("analytics.new")}</Button>
    </div>
  );

  return (
    <div>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {q.data && q.data.length === 0 && (
        <EmptyState
          icon={<LayoutDashboard className="h-10 w-10" />}
          title={t("analytics.empty")}
          description={isManager ? t("analytics.emptyHint") : t("analytics.emptyViewer")}
          action={actions || undefined}
        />
      )}
      {q.data && q.data.length > 0 && (
        <>
          {actions && <div className="mb-4 flex justify-end">{actions}</div>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.map((d) => (
              <Link key={d.id} to={`/analytics/${d.id}`} className="group">
                <Card className="h-full p-5 transition-colors group-hover:border-brand-600">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <LayoutDashboard className="h-5 w-5 shrink-0 text-brand-600" />
                      <h2 className="truncate font-semibold text-ink"><Bdi>{d.name}</Bdi></h2>
                    </div>
                    {!d.is_shared && <Badge tone="slate"><Lock className="me-1 inline h-3 w-3" />{t("analytics.private")}</Badge>}
                  </div>
                  {d.description && <p className="mt-2 line-clamp-2 text-sm text-ink-2"><Bdi>{d.description}</Bdi></p>}
                  <p className="mt-3 text-xs text-ink-3">{t("analytics.updated", { date: ltrText(formatDate(d.updated_at)) })}</p>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
      <Modal title={t("analytics.new")} open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <DashboardForm dashboard={null} onCancel={() => setCreating(false)}
            onDone={(id) => { setCreating(false); void qc.invalidateQueries({ queryKey: ["bi_dashboards"] }); navigate(`/analytics/${id}`); }} />
        )}
      </Modal>
    </div>
  );
}

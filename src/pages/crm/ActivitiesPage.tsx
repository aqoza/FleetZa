import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus } from "lucide-react";
import { listPage, sanitizeSearch } from "../../lib/db";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, Pagination } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ActivityList } from "./ActivityList";
import { ActivityForm } from "./forms";
import { dayIn } from "./labels";
import { ACTIVITY_SELECT, type Activity } from "./types";

const PAGE_SIZE = 25;
const VIEWS = ["open", "overdue", "today", "upcoming", "done", "all"] as const;
type View = (typeof VIEWS)[number];

/** The UTC instant at which a tenant-local date starts (good to the minute for any real zone). */
function startOfDay(date: string, timeZone: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime())).toISOString();
}

function addDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export default function ActivitiesPage() {
  const t = useT();
  const tenant = useTenant();
  const { isManager, profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get("view") ?? "") ? (params.get("view") as View) : "open";
  const [mine, setMine] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const term = sanitizeSearch(search);
  const me = profile?.id ?? "";

  const listQ = useQuery({
    queryKey: ["crm_activities", "list", { page, view, mine, me, term }],
    queryFn: () => {
      const now = new Date().toISOString();
      const today = dayIn(now, tenant.timezone);
      const dayStart = startOfDay(today, tenant.timezone);
      const dayEnd = startOfDay(addDay(today), tenant.timezone);
      return listPage<Activity>("crm_activities", page, PAGE_SIZE, (q) => {
        let f = q.select(ACTIVITY_SELECT);
        if (mine && me) f = f.eq("owner_id", me);
        if (term) f = f.or(`subject.ilike.%${term}%,body.ilike.%${term}%`);
        switch (view) {
          case "open":
            return f.is("done_at", null).neq("activity_type", "note").order("due_at", { ascending: true, nullsFirst: false });
          case "overdue":
            return f.is("done_at", null).lt("due_at", now).order("due_at", { ascending: true });
          case "today":
            return f.is("done_at", null).gte("due_at", now > dayStart ? now : dayStart).lt("due_at", dayEnd).order("due_at", { ascending: true });
          case "upcoming":
            return f.is("done_at", null).gte("due_at", dayEnd).order("due_at", { ascending: true });
          case "done":
            return f.not("done_at", "is", null).order("done_at", { ascending: false });
          default:
            return f.order("created_at", { ascending: false });
        }
      });
    },
  });

  const pick = (v: View) => {
    if (v === "open") params.delete("view");
    else params.set("view", v);
    setParams(params, { replace: true });
    setPage(0);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => pick(v)}
            aria-pressed={view === v}
            className={`rounded-full border px-3 py-1 text-sm ${
              view === v ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas"
            }`}
          >
            {t(`crm.act.view.${v}`)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t("crm.act.search")} className="w-full sm:max-w-72" />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="h-4 w-4 rounded border-line" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(0); }} />
          {t("crm.filter.mine")}
        </label>
        {isManager && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("crm.act.add")}
          </Button>
        )}
      </div>
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (listQ.data.rows.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-10 w-10" />} title={t(`crm.act.empty.${view}`)} description={t("crm.act.emptyHint")} />
      ) : (
        <Card className="px-4 py-1">
          <ActivityList rows={listQ.data.rows} showLinks />
          {listQ.data.total > PAGE_SIZE && (
            <div className="border-t border-line">
              <Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />
            </div>
          )}
        </Card>
      ))}
      <Modal title={t("crm.act.newTitle")} open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <ActivityForm
            onCancel={() => setCreating(false)}
            onDone={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["crm_activities"] }); toast.success(t("crm.act.saved")); }}
          />
        )}
      </Modal>
    </div>
  );
}

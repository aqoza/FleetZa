import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../../lib/supabase";
import { listPage, listRows, wrapDbError } from "../../lib/db";
import { formatDateTime, formatMoney } from "../../lib/format";
import {
  CURSOR_FILL, GRID_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE,
} from "../../lib/chart";
import { ltrText } from "../../lib/bidi";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Card, EmptyState, ErrorState, LoadingState, Ltr, Modal, Pagination } from "../../components/ui";
import { DataTable, type DataTableColumn } from "../../components/DataTable";
import { ZReport } from "./ZReport";
import { SESSION_SELECT, n, todayIn, type PosSession } from "./types";

const PAGE_SIZE = 25;
const DAYS = 14;

export default function SessionsPage() {
  const t = useT();
  const tenant = useTenant();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const openId = params.get("session");

  const listQ = useQuery({
    queryKey: ["pos_sessions", "list", { page }],
    queryFn: () =>
      listPage<PosSession>("pos_sessions", page, PAGE_SIZE, (q) => q.select(SESSION_SELECT).order("opened_at", { ascending: false })),
  });

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("session", id);
    else next.delete("session");
    setParams(next, { replace: true });
  };

  const money = (v: unknown) => formatMoney(n(v), tenant.currency);
  const columns: Array<DataTableColumn<PosSession>> = [
    {
      id: "number",
      header: t("pos.sessions.number"),
      cell: (s) => <Ltr className="whitespace-nowrap font-medium text-brand-700">{s.doc_number}</Ltr>,
      exportValue: (s) => s.doc_number ?? "",
    },
    {
      id: "register",
      header: t("pos.orders.register"),
      cell: (s) => <Bdi>{s.register?.name ?? "—"}</Bdi>,
      exportValue: (s) => s.register?.name ?? "",
    },
    {
      id: "opened",
      header: t("pos.sessions.opened"),
      minBreakpoint: "sm",
      cell: (s) => <span className="whitespace-nowrap text-ink-2">{formatDateTime(s.opened_at)}</span>,
      sortValue: (s) => s.opened_at,
      exportValue: (s) => s.opened_at,
    },
    {
      id: "closed",
      header: t("pos.sessions.closed"),
      minBreakpoint: "md",
      cell: (s) => <span className="whitespace-nowrap text-ink-2">{s.closed_at ? formatDateTime(s.closed_at) : "—"}</span>,
      exportValue: (s) => s.closed_at ?? "",
    },
    {
      id: "difference",
      header: t("pos.z.difference"),
      align: "end",
      minBreakpoint: "sm",
      cell: (s) => s.cash_difference === null ? <span className="text-ink-3">—</span> : (
        <Ltr className={`whitespace-nowrap ${n(s.cash_difference) === 0 ? "text-good" : "text-serious"}`}>{money(s.cash_difference)}</Ltr>
      ),
      exportValue: (s) => s.cash_difference ?? "",
    },
    {
      id: "status",
      header: t("pos.orders.status"),
      cell: (s) => <Badge tone={s.status === "open" ? "green" : "slate"}>{t(`pos.sessionStatus.${s.status}`)}</Badge>,
      exportValue: (s) => s.status,
    },
  ];

  return (
    <div className="space-y-4">
      <DailyChart />
      {listQ.isLoading && <LoadingState />}
      {listQ.error && <ErrorState message={(listQ.error as Error).message} />}
      {listQ.data && (
        <DataTable<PosSession>
          tableId="pos_sessions"
          exportName="pos-sessions"
          rows={listQ.data.rows}
          rowKey={(s) => s.id}
          columns={columns}
          onRowClick={(s) => open(s.id)}
          empty={<EmptyState icon={<CalendarClock className="h-10 w-10" />} title={t("pos.sessions.empty")} description={t("pos.sessions.emptyHint")} />}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={listQ.data.total} onPage={setPage} />}
        />
      )}
      <SessionModal id={openId} onClose={() => open(null)} />
    </div>
  );
}

function DailyChart() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const from = todayIn(tenant.timezone, -(DAYS - 1));
  const to = todayIn(tenant.timezone);
  const q = useQuery({
    queryKey: ["pos_daily_sales", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pos_daily_sales", { p_from: from, p_to: to });
      if (error) throw wrapDbError(error);
      return data ?? [];
    },
  });
  const series = useMemo(() => {
    const by = new Map((q.data ?? []).map((r) => [r.day, n(r.total)]));
    const fmt = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "UTC" });
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(`${from}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { key, label: fmt.format(d), total: by.get(key) ?? 0 };
    });
  }, [q.data, from, language]);
  const sum = series.reduce((a, r) => a + r.total, 0);

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{t("pos.sessions.chartTitle")}</h2>
        <span className="text-sm text-ink-2">{t("pos.sessions.chartTotal", { amount: ltrText(formatMoney(sum, tenant.currency)) })}</span>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <div dir="ltr">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="label" tick={TICK_STYLE} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} width={56} />
              <Tooltip
                cursor={{ fill: CURSOR_FILL }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(value) => formatMoney(Number(value), tenant.currency)}
              />
              <Bar dataKey="total" name={t("pos.sessions.netSales")} fill="#1d67f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function SessionModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ["pos_sessions", "one", id],
    enabled: !!id,
    queryFn: async () => (await listRows<PosSession>("pos_sessions", (b) => b.select(SESSION_SELECT).eq("id", id ?? "").limit(1)))[0] ?? null,
  });
  const s = q.data;
  return (
    <Modal title={s ? t("pos.z.title", { number: ltrText(s.doc_number) }) : t("pos.sessions.title")} open={!!id} onClose={onClose} wide>
      {q.isLoading && <LoadingState />}
      {q.error && <ErrorState message={(q.error as Error).message} />}
      {id && !q.isLoading && !s && <ErrorState message={t("pos.sessions.notFound")} />}
      {s && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Badge tone={s.status === "open" ? "green" : "slate"}>{t(`pos.sessionStatus.${s.status}`)}</Badge>
            <Bdi>{s.register?.name ?? ""}</Bdi>
            <span>·</span>
            <span>{formatDateTime(s.opened_at)}</span>
            {s.closed_at && <><span>–</span><span>{formatDateTime(s.closed_at)}</span></>}
          </div>
          <ZReport session={s} />
          {s.notes && <p className="text-sm text-ink-2"><Bdi>{s.notes}</Bdi></p>}
        </div>
      )}
    </Modal>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellOff, Check, CheckCheck, Mail, Trash2 } from "lucide-react";
import { listPage } from "../../lib/db";
import { formatDateTime } from "../../lib/format";
import { relativeTime, type Severity } from "../../lib/notifications";
import { useAuth } from "../../context/AuthContext";
import { useI18n, useTp } from "../../i18n";
import { Button, Card, EmptyState, ErrorState, LoadingState, Pagination, Select } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useDeleteNotification, useMarkRead, useUnreadCount } from "./hooks";
import { SeverityIcon } from "./SeverityIcon";
import { useNotificationText } from "./text";
import type { NotificationRow } from "./types";

const PAGE_SIZE = 25;
const SEVERITIES: Severity[] = ["critical", "warning", "info"];

export default function NotificationsPage() {
  const { t, language } = useI18n();
  const tp = useTp();
  const toast = useToast();
  const { profile } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [severity, setSeverity] = useState("all");
  const [page, setPage] = useState(0);
  const text = useNotificationText();
  const markRead = useMarkRead();
  const remove = useDeleteNotification();
  const unreadQ = useUnreadCount(true);
  const unread = unreadQ.data ?? 0;

  const { data, isLoading, error } = useQuery({
    queryKey: ["notifications", "inbox", profile?.id, { unreadOnly, severity, page }],
    enabled: !!profile,
    queryFn: () =>
      listPage<NotificationRow>("notifications", page, PAGE_SIZE, (q) => {
        let f = q.eq("recipient_id", profile!.id);
        if (unreadOnly) f = f.is("read_at", null);
        if (severity !== "all") f = f.eq("severity", severity);
        return f.order("created_at", { ascending: false });
      }),
  });
  const rows = data?.rows ?? [];

  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : t("notifications.actionFailed"));
  const now = Date.now();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
          {[false, true].map((u) => (
            <button
              key={String(u)}
              onClick={() => {
                setUnreadOnly(u);
                setPage(0);
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${unreadOnly === u ? "bg-brand-600 text-white" : "text-ink-2 hover:text-ink"}`}
            >
              {u ? t("notifications.filterUnread") : t("notifications.filterAll")}
            </button>
          ))}
        </div>
        <Select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(0);
          }}
          className="w-full sm:w-auto sm:max-w-44"
        >
          <option value="all">{t("notifications.allSeverities")}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{t(`notifications.severity.${s}`)}</option>
          ))}
        </Select>
        {unread > 0 && <span className="text-sm text-ink-3">{tp("notifications.unreadCount", unread)}</span>}
        {unread > 0 && (
          <div className="ms-auto">
            <Button
              variant="secondary"
              onClick={() => markRead.mutate({ ids: null }, { onError: fail })}
              loading={markRead.isPending}
            >
              <CheckCheck className="h-4 w-4" /> {t("notifications.markAllRead")}
            </Button>
          </div>
        )}
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon={<BellOff className="h-10 w-10" />}
          title={unreadOnly ? t("notifications.emptyUnreadTitle") : t("notifications.emptyTitle")}
          description={unreadOnly ? t("notifications.emptyUnreadDesc") : t("notifications.emptyDesc")}
        />
      )}
      {rows.length > 0 && (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((n) => {
              const { title, body } = text(n);
              return (
                <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read_at ? "" : "bg-brand-50/40"}`}>
                  <SeverityIcon severity={n.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {n.link ? (
                        <Link
                          to={n.link}
                          onClick={() => !n.read_at && markRead.mutate({ ids: [n.id] })}
                          className={`text-sm hover:underline ${n.read_at ? "text-ink-2" : "font-semibold text-ink"}`}
                        >
                          {title}
                        </Link>
                      ) : (
                        <span className={`text-sm ${n.read_at ? "text-ink-2" : "font-semibold text-ink"}`}>{title}</span>
                      )}
                      <span className="text-xs text-ink-3" title={formatDateTime(n.created_at)}>
                        {relativeTime(n.created_at, now, language)}
                      </span>
                    </div>
                    {body && <p className="mt-0.5 text-sm text-ink-3">{body}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      className="rounded p-1.5 text-ink-3 hover:bg-canvas hover:text-ink-2"
                      onClick={() => markRead.mutate({ ids: [n.id], read: !n.read_at }, { onError: fail })}
                      aria-label={n.read_at ? t("notifications.markUnread") : t("notifications.markRead")}
                      title={n.read_at ? t("notifications.markUnread") : t("notifications.markRead")}
                    >
                      {n.read_at ? <Mail className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button
                      className="rounded p-1.5 text-ink-3 hover:bg-serious-soft hover:text-serious"
                      onClick={() => remove.mutate(n.id, { onError: fail })}
                      aria-label={t("notifications.delete")}
                      title={t("notifications.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </Card>
      )}
    </>
  );
}

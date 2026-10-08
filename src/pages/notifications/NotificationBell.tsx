import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { relativeTime, unreadBadge } from "../../lib/notifications";
import { useI18n, useTp } from "../../i18n";
import { useMarkRead, useNotificationRefresh, useRecentNotifications, useUnreadCount } from "./hooks";
import { SeverityIcon } from "./SeverityIcon";
import { useNotificationText } from "./text";
import type { NotificationRow } from "./types";

const RECENT = 8;

/** Header bell: unread badge, the latest few, and a way into the inbox. */
export function NotificationBell() {
  const { t, language } = useI18n();
  const tp = useTp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useNotificationRefresh(true);
  const unreadQ = useUnreadCount(true);
  const recentQ = useRecentNotifications(RECENT, open);
  const markRead = useMarkRead();
  const text = useNotificationText();
  const unread = unreadQ.data ?? 0;
  const badge = unreadBadge(unread);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(n: NotificationRow) {
    if (!n.read_at) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    navigate(n.link || "/notifications");
  }

  const label = unread > 0 ? tp("notifications.bellUnread", unread) : t("notifications.bell");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-ink-2 transition-colors hover:bg-canvas hover:text-ink"
      >
        <Bell className="h-4.5 w-4.5" />
        {badge && (
          <span className="absolute -end-0.5 -top-0.5 min-w-4.5 rounded-full bg-serious px-1 text-center text-[10px] font-semibold leading-4.5 text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-ink">{t("notifications.title")}</span>
            {unread > 0 && (
              <button
                className="text-xs font-medium text-brand-700 hover:underline"
                onClick={() => markRead.mutate({ ids: null })}
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(recentQ.data ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-3">
                {recentQ.isLoading ? "…" : t("notifications.allCaughtUp")}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {(recentQ.data ?? []).map((n) => {
                  const { title } = text(n);
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => go(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-canvas ${n.read_at ? "" : "bg-brand-50/40"}`}
                      >
                        <SeverityIcon severity={n.severity} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm ${n.read_at ? "text-ink-2" : "font-medium text-ink"}`}>{title}</span>
                          <span className="text-xs text-ink-3">{relativeTime(n.created_at, Date.now(), language)}</span>
                        </span>
                        {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-canvas"
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}

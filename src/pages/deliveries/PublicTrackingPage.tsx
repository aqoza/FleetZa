/**
 * Public, no-auth page at /track/:token — a capability link (unguessable
 * token), same posture as /q/:token and /verify. The API returns only the
 * whitelisted fields (worker/tracking.ts); this page renders them.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, PackageCheck, SearchX, Truck, Undo2, XCircle } from "lucide-react";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatDateTime } from "../../lib/format";
import { LANGUAGES, useI18n } from "../../i18n";
import { Card, ErrorState, Ltr } from "../../components/ui";
import type { DeliveryStatus } from "../../../shared/deliveries";

interface PublicTracking {
  status: DeliveryStatus | "not_found";
  docNumber: string | null;
  recipientFirstName: string | null;
  city: string | null;
  updatedAt: string;
  deliveredAt: string | null;
  companyName: string | null;
}

function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="flex gap-1">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLanguage(l.code)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
            language === l.code ? "bg-brand-50 text-brand-700" : "text-ink-3 hover:bg-canvas hover:text-ink-2"
          }`}
        >
          {t(l.labelKey)}
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Stepper position: 0 received, 1 out for delivery, 2 delivered. */
function stepOf(status: DeliveryStatus): number {
  if (status === "delivered") return 2;
  if (status === "out_for_delivery" || status === "failed") return 1;
  return 0;
}

export default function PublicTrackingPage() {
  const { token = "" } = useParams();
  const { t } = useI18n();
  const [data, setData] = useState<PublicTracking | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/track/${encodeURIComponent(token)}`);
        const json = (await res.json()) as PublicTracking;
        if (alive) setData(res.ok ? json : { ...json, status: "not_found" });
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-20 text-ink-3">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <ErrorState message={t("deliveries.track.error")} />
      </Shell>
    );
  }
  if (data.status === "not_found") {
    return (
      <Shell>
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <SearchX className="h-10 w-10 text-ink-3" />
          <p className="text-sm text-ink-2">{t("deliveries.track.notFound")}</p>
        </Card>
      </Shell>
    );
  }

  const step = stepOf(data.status);
  const steps = [
    { key: "received", icon: <PackageCheck className="h-4 w-4" />, label: t("deliveries.track.step.received") },
    { key: "out", icon: <Truck className="h-4 w-4 rtl:-scale-x-100" />, label: t("deliveries.track.step.out") },
    { key: "delivered", icon: <CheckCircle2 className="h-4 w-4" />, label: t("deliveries.track.step.delivered") },
  ];

  return (
    <Shell>
      <Card className="px-6 py-6">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-3 rtl:tracking-normal">{t("deliveries.track.title")}</p>
        <h1 className="mt-1 text-xl font-bold text-ink"><Ltr>{data.docNumber}</Ltr></h1>
        {data.companyName && <p className="text-sm text-ink-2">{t("deliveries.track.from", { company: bdiText(data.companyName) })}</p>}
        <div className="mt-2 space-y-0.5 text-sm text-ink-2">
          {data.recipientFirstName && <p>{t("deliveries.track.for", { name: bdiText(data.recipientFirstName) })}</p>}
          {data.city && <p>{t("deliveries.track.city", { city: bdiText(data.city) })}</p>}
        </div>

        {data.status === "returned" ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
            <Undo2 className="mt-0.5 h-5 w-5 shrink-0 rtl:-scale-x-100" />
            <p>{t("deliveries.track.returned")}</p>
          </div>
        ) : (
          <ol className="mt-6 space-y-4">
            {steps.map((s, i) => {
              const reached = i <= step;
              const current = i === step;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    reached ? "bg-good text-white" : "bg-canvas text-ink-3"
                  }`}>
                    {s.icon}
                  </span>
                  <div>
                    <p className={reached ? (current ? "font-semibold text-ink" : "text-ink") : "text-ink-3"}>{s.label}</p>
                    {s.key === "delivered" && data.deliveredAt && (
                      <p className="text-xs text-ink-3">{t("deliveries.track.deliveredAt", { time: ltrText(formatDateTime(data.deliveredAt)) })}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data.status === "failed" && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-serious/30 bg-serious-soft p-4 text-sm text-serious">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>{t("deliveries.track.failed")}</p>
          </div>
        )}
        <p className="mt-6 text-xs text-ink-3">{t("deliveries.track.updated", { time: ltrText(formatDateTime(data.updatedAt)) })}</p>
      </Card>
    </Shell>
  );
}

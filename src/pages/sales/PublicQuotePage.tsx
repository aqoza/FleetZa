/**
 * The customer's view of a quote — the page behind the link a salesperson
 * shares. Standalone like the certificate verify page: no auth, no tenant
 * context, no AppLayout, since whoever opens it has no account here.
 *
 * The API decides everything that matters (whether the quote is visible at
 * all, whether it can still be accepted); this page only renders that verdict.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, SearchX, XCircle } from "lucide-react";
import { formatDate, formatMoney } from "../../lib/format";
import { LANGUAGES, useI18n } from "../../i18n";
import { Button, Card, ErrorState, Field, Input } from "../../components/ui";

interface PublicLine {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  line_total: number;
}

interface PublicQuote {
  status: "sent" | "accepted" | "declined" | "expired" | "not_found";
  canAccept: boolean;
  docNumber: string;
  issueDate: string;
  validUntil: string | null;
  currency: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  title: string | null;
  customerReference: string | null;
  terms: string | null;
  notes: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  customerName: string | null;
  lines: PublicLine[];
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
            language === l.code
              ? "bg-brand-50 text-brand-700"
              : "text-ink-3 hover:bg-canvas hover:text-ink-2"
          }`}
        >
          {t(l.labelKey)}
        </button>
      ))}
    </div>
  );
}

export default function PublicQuotePage() {
  const { token = "" } = useParams();
  const { t } = useI18n();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [failure, setFailure] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(token)}`);
      const json = (await res.json()) as PublicQuote;
      setQuote(res.ok ? json : { ...json, status: "not_found" });
    } catch {
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function accept() {
    setAccepting(true);
    setFailure("");
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error("failed");
      await load();
    } catch {
      setFailure(t("sales.public.acceptFailed"));
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("sales.public.loading")}
        </div>
      </Shell>
    );
  }

  if (!quote || quote.status === "not_found") {
    return (
      <Shell>
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <SearchX className="h-10 w-10 text-ink-3" />
          <p className="text-sm text-ink-2">{t("sales.public.notFound")}</p>
        </Card>
      </Shell>
    );
  }

  const money = (v: number) => formatMoney(v, quote.currency);

  return (
    <Shell>
      <Card className="px-6 py-6 sm:px-10 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-brand-700">
              {t("sales.public.heading", { number: quote.docNumber })}
            </h1>
            {quote.companyName && (
              <p className="mt-1 text-sm text-ink-2">
                {t("sales.public.from", { company: quote.companyName })}
              </p>
            )}
            {quote.title && <p className="mt-2 text-sm text-ink">{quote.title}</p>}
          </div>
          <div className="text-end text-xs text-ink-3">
            <div>{formatDate(quote.issueDate)}</div>
            {quote.validUntil && (
              <div>{t("sales.public.validUntil", { date: formatDate(quote.validUntil) })}</div>
            )}
          </div>
        </header>

        {quote.status === "accepted" && (
          <Banner tone="good" icon={<CheckCircle2 className="h-5 w-5" />}>
            <p className="font-semibold">{t("sales.public.accepted")}</p>
            {quote.acceptedAt && quote.acceptedByName && (
              <p className="mt-0.5 text-xs">
                {t("sales.public.acceptedOn", {
                  date: formatDate(quote.acceptedAt),
                  name: quote.acceptedByName,
                })}
              </p>
            )}
          </Banner>
        )}
        {quote.status === "declined" && (
          <Banner tone="serious" icon={<XCircle className="h-5 w-5" />}>
            <p className="font-semibold">{t("sales.public.declined")}</p>
          </Banner>
        )}
        {quote.status === "expired" && (
          <Banner tone="warn" icon={<XCircle className="h-5 w-5" />}>
            <p className="font-semibold">{t("sales.public.expired")}</p>
          </Banner>
        )}

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="py-2 text-start text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.print.item")}
              </th>
              <th className="py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.lines.qty")}
              </th>
              <th className="py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.lines.unitPrice")}
              </th>
              <th className="py-2 text-end text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
                {t("sales.lines.lineTotal")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {quote.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2.5 text-ink">
                  {line.description}
                  {line.discount_percent > 0 && (
                    <span className="ms-2 text-xs text-ink-3">−{line.discount_percent}%</span>
                  )}
                </td>
                <td className="py-2.5 text-end text-ink-2 tabular-nums">
                  {line.quantity}{line.unit ? ` ${line.unit}` : ""}
                </td>
                <td className="py-2.5 text-end text-ink-2 tabular-nums">
                  {money(line.unit_price)}
                </td>
                <td className="py-2.5 text-end font-medium text-ink tabular-nums">
                  {money(line.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 flex justify-end">
          <dl className="w-56 space-y-1.5 text-sm tabular-nums">
            <SummaryRow label={t("sales.doc.subtotal")} value={money(quote.subtotal)} />
            {quote.discountTotal > 0 && (
              <SummaryRow label={t("sales.doc.discount")} value={`− ${money(quote.discountTotal)}`} />
            )}
            {quote.taxTotal > 0 && (
              <SummaryRow label={t("sales.doc.taxTotal")} value={money(quote.taxTotal)} />
            )}
            <div className="border-t border-line pt-1.5">
              <SummaryRow label={t("sales.doc.total")} value={money(quote.total)} strong />
            </div>
          </dl>
        </div>

        {quote.notes && (
          <p className="mt-5 whitespace-pre-line text-sm text-ink-2">{quote.notes}</p>
        )}
        {quote.terms && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal">
              {t("sales.doc.terms")}
            </div>
            <p className="mt-1.5 whitespace-pre-line text-xs text-ink-2">{quote.terms}</p>
          </div>
        )}

        {quote.canAccept && (
          <div className="mt-6 rounded-xl border border-line bg-canvas p-4">
            {failure && (
              <div className="mb-3">
                <ErrorState message={failure} />
              </div>
            )}
            <Field label={t("sales.public.yourName")} hint={t("sales.public.yourNameHint")} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Button
              className="mt-3 w-full sm:w-auto"
              disabled={name.trim() === ""}
              loading={accepting}
              onClick={() => void accept()}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t("sales.public.confirmAccept", { number: quote.docNumber })}
            </Button>
          </div>
        )}

        <p className="mt-6 border-t border-line pt-3 text-center text-[11px] text-ink-3">
          {t("sales.public.questions")}
        </p>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "good" | "warn" | "serious";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    good: "border-good/30 bg-good-soft text-good",
    warn: "border-warn/30 bg-warn-soft text-warn",
    serious: "border-serious/30 bg-serious-soft text-serious",
  };
  return (
    <div className={`mt-5 flex items-start gap-3 rounded-xl border px-4 py-3 ${tones[tone]}`}>
      {icon}
      <div className="text-sm">{children}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-semibold text-ink" : "text-ink-3"}>{label}</dt>
      <dd className={strong ? "text-base font-semibold text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}

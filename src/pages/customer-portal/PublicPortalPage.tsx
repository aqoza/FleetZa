/**
 * Public, no-auth page at /portal/:token — a customer's view of their
 * vehicles, speed limiter certificates, invoices, quotations and contracts,
 * with a form to send a service request. Same posture as /q/:token: the API
 * (worker/customerPortal.ts → the customer_portal_* RPCs) decides what is
 * visible; this page renders it. Certificate links go to the unchanged
 * /verify page.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, SearchX, ShieldCheck } from "lucide-react";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatDate, formatMoney } from "../../lib/format";
import {
  REQUEST_TYPES, balanceByCurrency, type CertificateState, type RequestStatus, type RequestType,
} from "../../../shared/customerPortal";
import { LANGUAGES, useI18n, useTp, type MessageKey } from "../../i18n";
import { Badge, Bdi, Button, Card, ErrorState, Field, Input, Ltr, Select, Textarea, type BadgeTone } from "../../components/ui";
import { requestTone } from "./types";

interface PortalData {
  status: "ok";
  company: { name: string; name_ar: string | null; phone: string | null; email: string | null; address: string | null; website: string | null } | null;
  customer: { name: string } | null;
  today: string;
  sections: { vehicles: boolean; certificates: boolean; invoices: boolean; quotes: boolean; contracts: boolean; requests: boolean };
  vehicles: Array<{ id: string; name: string; license_plate: string | null; make: string | null; model: string | null; year: number | null; ownership: string }>;
  certificates: Array<{
    id: string; certificate_number: string; vehicle: string | null; license_plate: string | null;
    issued_at: string; expires_at: string | null; state: CertificateState;
  }>;
  invoices: Array<{
    id: string; doc_number: string; title: string | null; issue_date: string; due_date: string | null; currency: string;
    total: number; amount_paid: number; balance: number; status: string;
  }>;
  quotes: Array<{
    id: string; doc_number: string; title: string | null; issue_date: string; valid_until: string | null; currency: string;
    total: number; status: string; public_token: string;
  }>;
  contracts: Array<{
    id: string; doc_number: string; title: string; contract_type: string; start_date: string; end_date: string | null; billing_frequency: string;
  }>;
  requests: Array<{
    id: string; doc_number: string; request_type: RequestType; status: RequestStatus; created_at: string;
    scheduled_for: string | null; vehicle: string | null;
  }>;
}

type LoadState = { kind: "loading" } | { kind: "not_found" } | { kind: "failed" } | { kind: "ok"; data: PortalData };

const certTone: Record<CertificateState, BadgeTone> = { valid: "green", expired: "red", superseded: "slate", revoked: "red" };
const invoiceTone: Record<string, BadgeTone> = { issued: "blue", partially_paid: "yellow", paid: "green" };

export default function PublicPortalPage() {
  const { token = "" } = useParams();
  const { t, language } = useI18n();
  const tp = useTp();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [thanks, setThanks] = useState("");

  async function load() {
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`);
      if (res.status === 404) return setState({ kind: "not_found" });
      if (!res.ok) return setState({ kind: "failed" });
      setState({ kind: "ok", data: (await res.json()) as PortalData });
    } catch {
      setState({ kind: "failed" });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("customerPortal.public.loading")}
        </div>
      </Shell>
    );
  }
  if (state.kind !== "ok") {
    return (
      <Shell>
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <SearchX className="h-10 w-10 text-ink-3" />
          <p className="max-w-md text-sm text-ink-2">
            {t(state.kind === "not_found" ? "customerPortal.public.notFound" : "customerPortal.public.failed")}
          </p>
        </Card>
      </Shell>
    );
  }

  const d = state.data;
  const companyName = d.company ? (language === "ar" && d.company.name_ar ? d.company.name_ar : d.company.name) : "";
  const owed = balanceByCurrency(d.invoices.filter((i) => i.status !== "paid"));
  const validCerts = d.certificates.filter((c) => c.state === "valid").length;
  const s = d.sections;

  return (
    <Shell>
      <Card className="px-5 py-6 sm:px-8">
        <h1 className="text-xl font-bold text-brand-700">
          {t("customerPortal.public.heading", { customer: bdiText(d.customer?.name ?? "") })}
        </h1>
        {companyName && <p className="mt-1 text-sm text-ink-2">{t("customerPortal.public.from", { company: bdiText(companyName) })}</p>}
        {(d.company?.phone || d.company?.email) && (
          <p className="mt-0.5 text-xs text-ink-3">
            {d.company?.phone && <a href={`tel:${d.company.phone}`} className="hover:underline"><Ltr>{d.company.phone}</Ltr></a>}
            {d.company?.phone && d.company?.email && " · "}
            {d.company?.email && <a href={`mailto:${d.company.email}`} className="hover:underline"><Ltr>{d.company.email}</Ltr></a>}
          </p>
        )}
        {((s.certificates && d.certificates.length > 0) || owed.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {s.certificates && d.certificates.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-good-soft px-3 py-1.5 font-medium text-good">
                <ShieldCheck className="h-4 w-4" /> {tp("customerPortal.public.validCerts", validCerts)}
              </span>
            )}
            {owed.map(([currency, amount]) => (
              <span key={currency} className="rounded-lg bg-warn-soft px-3 py-1.5 font-medium text-warn">
                {t("customerPortal.public.outstanding", { amount: ltrText(formatMoney(amount, currency)) })}
              </span>
            ))}
          </div>
        )}
      </Card>

      {thanks && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-sm text-good" role="status">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{thanks}</span>
        </div>
      )}

      {s.requests && (
        <Section title={t("customerPortal.public.requestTitle")}>
          <RequestForm token={token} vehicles={s.vehicles ? d.vehicles : []} today={d.today}
            onSent={(number) => { setThanks(t("customerPortal.public.requestThanks", { number: ltrText(number) })); void load(); }} />
          {d.requests.length > 0 && (
            <Card className="mt-3 divide-y divide-line">
              {d.requests.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">
                      <Ltr className="font-medium">{r.doc_number}</Ltr> · {t(`customerPortal.type.${r.request_type}`)}
                      {r.vehicle && <> · <Bdi>{r.vehicle}</Bdi></>}
                    </div>
                    <div className="text-xs text-ink-3">
                      {r.status === "scheduled" && r.scheduled_for
                        ? t("customerPortal.scheduledFor", { date: ltrText(formatDate(r.scheduled_for)) })
                        : t("customerPortal.public.sentOn", { date: ltrText(formatDate(r.created_at)) })}
                    </div>
                  </div>
                  <Badge tone={requestTone[r.status]}>{t(`customerPortal.status.${r.status}`)}</Badge>
                </div>
              ))}
            </Card>
          )}
        </Section>
      )}

      {s.certificates && (
        <Section title={t("customerPortal.section.certificates")}>
          {d.certificates.length === 0 ? <Empty>{t("customerPortal.public.noCertificates")}</Empty> : (
            <Card className="divide-y divide-line">
              {d.certificates.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <div className="whitespace-nowrap text-sm font-medium text-ink"><Ltr>{c.certificate_number}</Ltr></div>
                    <div className="text-xs text-ink-3">
                      {c.vehicle && <Bdi>{c.vehicle}</Bdi>}
                      {c.license_plate && <> · <Ltr>{c.license_plate}</Ltr></>}
                    </div>
                  </div>
                  <div className="flex-1 text-xs text-ink-3 sm:flex-none sm:text-end">
                    {c.expires_at && <div>{t("customerPortal.public.expires", { date: ltrText(formatDate(c.expires_at)) })}</div>}
                  </div>
                  <Badge tone={certTone[c.state]}>{t(`customerPortal.cert.${c.state}`)}</Badge>
                  <a href={`/verify?c=${encodeURIComponent(c.id)}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                    {t("customerPortal.public.verify")} <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" />
                  </a>
                </div>
              ))}
            </Card>
          )}
        </Section>
      )}

      {s.invoices && (
        <Section title={t("customerPortal.section.invoices")}>
          {d.invoices.length === 0 ? <Empty>{t("customerPortal.public.noInvoices")}</Empty> : (
            <Card className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead className="bg-canvas/60">
                  <tr>
                    <Th>{t("customerPortal.public.number")}</Th>
                    <Th className="hidden sm:table-cell">{t("customerPortal.public.date")}</Th>
                    <Th className="hidden sm:table-cell">{t("customerPortal.public.due")}</Th>
                    <Th end>{t("customerPortal.public.balance")}</Th>
                    <Th>{t("customerPortal.col.status")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2.5">
                        <div className="whitespace-nowrap font-medium text-ink"><Ltr>{i.doc_number}</Ltr></div>
                        {i.title && <div className="max-w-36 truncate text-xs text-ink-3 sm:max-w-56"><Bdi>{i.title}</Bdi></div>}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-2 tabular-nums sm:table-cell"><Ltr>{formatDate(i.issue_date)}</Ltr></td>
                      <td className={`hidden whitespace-nowrap px-3 py-2.5 tabular-nums sm:table-cell ${
                        i.status !== "paid" && i.due_date && i.due_date < d.today ? "font-medium text-serious" : "text-ink-2"}`}>
                        {i.due_date ? <Ltr>{formatDate(i.due_date)}</Ltr> : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-end tabular-nums">
                        <div className="font-medium text-ink"><Ltr>{formatMoney(Number(i.balance), i.currency)}</Ltr></div>
                        <div className="text-xs text-ink-3"><Ltr>{formatMoney(Number(i.total), i.currency)}</Ltr></div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Badge tone={invoiceTone[i.status] ?? "slate"}>{t(`enum.invoiceStatus.${i.status}` as MessageKey)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Section>
      )}

      {s.quotes && (
        <Section title={t("customerPortal.section.quotes")}>
          {d.quotes.length === 0 ? <Empty>{t("customerPortal.public.noQuotes")}</Empty> : (
            <Card className="divide-y divide-line">
              {d.quotes.map((q) => (
                <a key={q.id} href={`/q/${encodeURIComponent(q.public_token)}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-brand-700"><Ltr>{q.doc_number}</Ltr></div>
                    <div className="truncate text-xs text-ink-3">
                      {q.title && <Bdi>{q.title}</Bdi>}
                      {q.valid_until && <>{q.title ? " · " : ""}{t("customerPortal.public.validUntil", { date: ltrText(formatDate(q.valid_until)) })}</>}
                    </div>
                  </div>
                  <Ltr className="whitespace-nowrap text-sm font-medium text-ink">{formatMoney(Number(q.total), q.currency)}</Ltr>
                  <Badge tone={q.status === "accepted" ? "green" : "blue"}>{t(`enum.quoteStatus.${q.status}` as MessageKey)}</Badge>
                </a>
              ))}
            </Card>
          )}
        </Section>
      )}

      {s.contracts && (
        <Section title={t("customerPortal.section.contracts")}>
          {d.contracts.length === 0 ? <Empty>{t("customerPortal.public.noContracts")}</Empty> : (
            <Card className="divide-y divide-line">
              {d.contracts.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink"><Ltr className="font-medium">{c.doc_number}</Ltr> · <Bdi>{c.title}</Bdi></div>
                    <div className="text-xs text-ink-3">
                      <Ltr>{`${formatDate(c.start_date)} – ${c.end_date ? formatDate(c.end_date) : "…"}`}</Ltr>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </Section>
      )}

      {s.vehicles && (
        <Section title={t("customerPortal.section.vehicles")}>
          {d.vehicles.length === 0 ? <Empty>{t("customerPortal.public.noVehicles")}</Empty> : (
            <Card className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead className="bg-canvas/60">
                  <tr>
                    <Th>{t("customerPortal.public.vehicle")}</Th>
                    <Th>{t("customerPortal.public.plate")}</Th>
                    <Th className="hidden sm:table-cell">{t("customerPortal.public.makeModel")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.vehicles.map((v) => (
                    <tr key={v.id}>
                      <td className="px-3 py-2.5 text-ink"><Bdi>{v.name}</Bdi></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{v.license_plate ? <Ltr>{v.license_plate}</Ltr> : "—"}</td>
                      <td className="hidden px-3 py-2.5 text-ink-2 sm:table-cell">
                        <Bdi>{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</Bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Section>
      )}

      {companyName && <p className="mt-8 text-center text-xs text-ink-3">{t("customerPortal.public.footer", { company: bdiText(companyName) })}</p>}
    </Shell>
  );
}

function RequestForm({ token, vehicles, today, onSent }: {
  token: string;
  vehicles: PortalData["vehicles"];
  today: string;
  onSent: (number: string) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<RequestType>("service");
  const [vehicle, setVehicle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setFailure("");
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_type: type,
          description: description.trim(),
          vehicle_id: vehicle || null,
          preferred_date: date || null,
          contact_name: name.trim() || null,
          contact_phone: phone.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; request?: { doc_number?: string } };
      if (res.ok) {
        setDescription("");
        setVehicle("");
        setDate("");
        return onSent(body.request?.doc_number ?? "");
      }
      setFailure(body.error === "requests_disabled" ? t("customerPortal.public.requestsOff")
        : body.error === "invalid_request" ? t("customerPortal.public.requestInvalid")
          : t("customerPortal.public.requestFailed"));
    } catch {
      setFailure(t("customerPortal.public.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="px-4 py-4 sm:px-6">
      <p className="mb-3 text-sm text-ink-2">{t("customerPortal.public.requestHint")}</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("customerPortal.col.type")}>
            <Select value={type} onChange={(e) => setType(e.target.value as RequestType)}>
              {REQUEST_TYPES.map((x) => <option key={x} value={x}>{t(`customerPortal.type.${x}`)}</option>)}
            </Select>
          </Field>
          {vehicles.length > 0 && (
            <Field label={t("customerPortal.public.vehicle")}>
              <Select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                <option value="">{t("customerPortal.public.anyVehicle")}</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.license_plate ? `${v.name} · ${v.license_plate}` : v.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label={t("customerPortal.public.describe")} required>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} required dir="auto" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("customerPortal.f.preferredDate")}>
            <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("customerPortal.public.yourName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" />
          </Field>
          <Field label={t("customerPortal.public.phone")}>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} dir="ltr" />
          </Field>
        </div>
        {failure && <ErrorState message={failure} />}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!description.trim()}>{t("customerPortal.public.send")}</Button>
        </div>
      </form>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <Card className="px-5 py-8 text-center text-sm text-ink-3">{children}</Card>;
}

function Th({ children, end, className = "" }: { children: ReactNode; end?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal ${end ? "text-end" : "text-start"} ${className}`}>
      {children}
    </th>
  );
}

function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="flex gap-1">
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" onClick={() => setLanguage(l.code)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
            language === l.code ? "bg-brand-50 text-brand-700" : "text-ink-3 hover:bg-canvas hover:text-ink-2"
          }`}>
          {t(l.labelKey)}
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
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

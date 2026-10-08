import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listRows } from "../../lib/db";
import { addDays, weekDates } from "../../../shared/trips";
import { getCountry } from "../../../shared/countries";
import { useTenant } from "../../context/AuthContext";
import { useI18n, useT } from "../../i18n";
import { Badge, Bdi, Button, ErrorState, LoadingState, Ltr } from "../../components/ui";
import { dayInTz, driverName, statusTone, timeInTz } from "./labels";
import { normalizeTrip, TRIP_SELECT, type Trip } from "./types";

/** Calendar-style week: one column per day, trips on every day their planned window touches. */
export default function WeekPage() {
  const t = useT();
  const { language } = useI18n();
  const tenant = useTenant();
  const tz = tenant.timezone;
  const locale = language === "ar" ? "ar-u-nu-latn" : getCountry(tenant.country).locale;
  const today = dayInTz(Date.now(), tz);
  const [anchor, setAnchor] = useState(today);
  const days = useMemo(() => weekDates(anchor, 0), [anchor]);

  // A day of padding each side covers any tenant offset; trips are bucketed by tenant-local day below.
  const from = `${addDays(days[0], -1)}T00:00:00Z`;
  const to = `${addDays(days[6], 2)}T00:00:00Z`;
  const tripsQ = useQuery({
    queryKey: ["trips", "week", from],
    queryFn: async () =>
      (
        await listRows<Trip>("trips", (q) =>
          q.select(TRIP_SELECT).lt("planned_start", to).gt("planned_end", from).neq("status", "canceled").order("planned_start").limit(500),
        )
      ).map(normalizeTrip),
  });

  const byDay = useMemo(() => {
    const m = new Map<string, Trip[]>(days.map((d) => [d, []]));
    for (const trip of tripsQ.data ?? []) {
      const first = dayInTz(trip.planned_start, tz);
      // planned_end is exclusive: a trip ending at midnight doesn't occupy the next day.
      const last = dayInTz(new Date(Date.parse(trip.planned_end) - 1), tz);
      for (const d of days) if (d >= first && d <= last) m.get(d)!.push(trip);
    }
    return m;
  }, [tripsQ.data, days, tz]);

  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const total = (tripsQ.data ?? []).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="px-2.5" aria-label={t("pagination.prev")} onClick={() => setAnchor(addDays(anchor, -7))}>
          <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
        </Button>
        <Button variant="secondary" onClick={() => setAnchor(today)} disabled={days.includes(today)}>
          {t("trips.thisWeek")}
        </Button>
        <Button variant="secondary" className="px-2.5" aria-label={t("pagination.next")} onClick={() => setAnchor(addDays(anchor, 7))}>
          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
        </Button>
        <span className="ms-2 text-sm font-medium text-ink">{t("trips.weekOf", { date: dayLabel(days[0]) })}</span>
      </div>
      {tripsQ.isLoading && <LoadingState />}
      {tripsQ.error && <ErrorState message={(tripsQ.error as Error).message} />}
      {tripsQ.data && (
        <>
          <div className="grid gap-2 md:grid-cols-7">
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              return (
                <section
                  key={d}
                  className={`min-h-28 rounded-xl border p-2 ${d === today ? "border-brand-500 bg-brand-50/40 dark:bg-brand-950/30" : "border-line bg-surface"}`}
                >
                  <h3 className={`mb-2 text-xs font-semibold ${d === today ? "text-brand-700" : "text-ink-2"}`}>{dayLabel(d)}</h3>
                  <div className="space-y-1.5">
                    {list.map((trip) => (
                      <Link
                        key={trip.id}
                        to={`/trips/${trip.id}`}
                        className="block rounded-lg border border-line bg-canvas p-2 text-xs transition-colors hover:border-brand-500"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <Ltr className="whitespace-nowrap font-semibold text-ink">{timeInTz(trip.planned_start, tz, locale)}</Ltr>
                          <Badge tone={statusTone[trip.status]}>{t(`trips.status.${trip.status}`)}</Badge>
                        </div>
                        <Bdi className="mt-1 block truncate text-ink">{trip.vehicle?.name ?? "—"}</Bdi>
                        <Bdi className="block truncate text-ink-3">{trip.purpose}</Bdi>
                        {trip.driver && <Bdi className="block truncate text-ink-3">{driverName(trip.driver)}</Bdi>}
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {total === 0 && <p className="mt-3 text-sm text-ink-3">{t("trips.weekEmpty")}</p>}
        </>
      )}
    </div>
  );
}

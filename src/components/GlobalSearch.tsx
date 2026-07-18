import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, Building2, Search, Truck } from "lucide-react";
import { listRows, sanitizeSearch } from "../lib/db";
import type { Customer, SpeedLimiterCertificate, Vehicle } from "../lib/types";
import { useModules } from "../context/ModulesContext";
import { useT } from "../i18n";

const LIMIT = 5;

/**
 * Tenant-wide quick search over master data: vehicles (name/plate/VIN),
 * customers (name/CR), and certificates (number). Ctrl/⌘+K focuses it;
 * results navigate to the entity's canonical page.
 */
export function GlobalSearch() {
  const t = useT();
  const navigate = useNavigate();
  const { isEnabled } = useModules();
  const customersOn = isEnabled("customers");
  const certsOn = isEnabled("sl_certificates");

  const [raw, setRaw] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce typing → term drives the queries.
  useEffect(() => {
    const id = setTimeout(() => setTerm(sanitizeSearch(raw)), 250);
    return () => clearTimeout(id);
  }, [raw]);

  // Ctrl/⌘+K focuses the search from anywhere — except while a dialog is open
  // (it would type into an invisible field behind the overlay), and never for
  // modified variants like Ctrl+Shift+K (browser devtools shortcuts).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.querySelector('[role="dialog"]')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the results.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const enabled = open && term.length >= 2;

  const vehiclesQ = useQuery({
    queryKey: ["vehicles", "globalSearch", term],
    enabled,
    queryFn: () =>
      listRows<Vehicle>("vehicles", (q) =>
        q
          .or(`name.ilike.%${term}%,license_plate.ilike.%${term}%,vin.ilike.%${term}%`)
          .order("name")
          .limit(LIMIT),
      ),
  });

  const customersQ = useQuery({
    queryKey: ["customers", "globalSearch", term],
    enabled: enabled && customersOn,
    queryFn: () =>
      listRows<Customer>("customers", (q) =>
        q.or(`name.ilike.%${term}%,cr_number.ilike.%${term}%`).order("name").limit(LIMIT),
      ),
  });

  const certsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "globalSearch", term],
    enabled: enabled && certsOn,
    queryFn: () =>
      listRows<SpeedLimiterCertificate>("speed_limiter_certificates", (q) =>
        q.ilike("certificate_number", `%${term}%`).order("expires_at").limit(LIMIT),
      ),
  });

  const vehicles = vehiclesQ.data ?? [];
  const customers = customersQ.data ?? [];
  const certs = certsQ.data ?? [];
  const anyLoading = vehiclesQ.isLoading || customersQ.isLoading || certsQ.isLoading;
  const anyError = Boolean(vehiclesQ.error || customersQ.error || certsQ.error);
  const count = vehicles.length + customers.length + certs.length;
  // "No matches" only when the queries actually settled — a failed query must
  // not misreport existing records as absent.
  const empty = enabled && !anyLoading && !anyError && count === 0;

  function go(path: string) {
    setOpen(false);
    setRaw("");
    navigate(path);
  }

  const groupHeading =
    "px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider rtl:tracking-normal text-ink-3";
  const rowClass =
    "flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm text-ink-2 hover:bg-canvas";

  return (
    <div ref={rootRef} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
      <input
        ref={inputRef}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("search.placeholder")}
        className="w-full rounded-xl border border-line bg-canvas ps-9 pe-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand-400 focus:bg-surface focus:outline-2 focus:outline-brand-500/25 sm:pe-14"
      />
      <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-3 sm:block">
        {navigator.platform.toUpperCase().includes("MAC") ? "⌘K" : "Ctrl K"}
      </kbd>

      {enabled && (anyLoading || anyError || empty || count > 0) && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-[min(70vh,30rem)] overflow-y-auto rounded-xl border border-line bg-surface pb-1 shadow-pop">
          {anyLoading && count === 0 && (
            <div className="px-3 py-4 text-sm text-ink-3">{t("common.loading")}</div>
          )}
          {anyError && count === 0 && !anyLoading && (
            <div className="px-3 py-4 text-sm text-serious">{t("common.error")}</div>
          )}
          {empty && <div className="px-3 py-4 text-sm text-ink-3">{t("search.noResults")}</div>}
          {vehicles.length > 0 && (
            <>
              <div className={groupHeading}>{t("nav.vehicles")}</div>
              {vehicles.map((v) => (
                <button key={v.id} className={rowClass} onClick={() => go(`/vehicles/${v.id}`)}>
                  <Truck className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="truncate font-medium text-ink">{v.name}</span>
                  <span className="ms-auto truncate text-xs text-ink-3">
                    {v.license_plate ?? v.vin ?? ""}
                  </span>
                </button>
              ))}
            </>
          )}
          {customers.length > 0 && (
            <>
              <div className={groupHeading}>{t("nav.customers")}</div>
              {customers.map((c) => (
                <button key={c.id} className={rowClass} onClick={() => go(`/customers/${c.id}`)}>
                  <Building2 className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="truncate font-medium text-ink">{c.name}</span>
                  {c.cr_number && (
                    <span className="ms-auto truncate text-xs text-ink-3">{c.cr_number}</span>
                  )}
                </button>
              ))}
            </>
          )}
          {certs.length > 0 && (
            <>
              <div className={groupHeading}>{t("customers.certificates")}</div>
              {certs.map((c) => (
                <button
                  key={c.id}
                  className={rowClass}
                  onClick={() => go("/speed-limiters/certificates")}
                >
                  <Award className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="truncate font-medium text-ink">{c.certificate_number}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

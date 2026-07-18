import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, Building2, Clock, Search, Truck, type LucideIcon } from "lucide-react";
import { listRows, sanitizeSearch } from "../lib/db";
import { getRecent } from "../lib/recent";
import type { Customer, SpeedLimiterCertificate, Vehicle } from "../lib/types";
import { useModules } from "../context/ModulesContext";
import { NAV_ITEMS } from "../modules/nav";
import { useT } from "../i18n";

const LIMIT = 5;

interface PaletteItem {
  key: string;
  icon: LucideIcon;
  label: string;
  meta?: string;
  path: string;
  group: "recent" | "goto" | "vehicles" | "customers" | "certificates";
}

/**
 * Command palette + tenant-wide search. Ctrl/⌘+K opens it; with no query it
 * offers recently viewed entities and navigation commands; typing filters
 * commands and searches vehicles (name/plate/VIN), customers (name/CR), and
 * certificates (number). Full keyboard support (arrows/Enter/Escape).
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
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounce typing → term drives the queries.
  useEffect(() => {
    const id = setTimeout(() => setTerm(sanitizeSearch(raw)), 250);
    return () => clearTimeout(id);
  }, [raw]);

  // Ctrl/⌘+K opens the palette from anywhere — except while a dialog is open,
  // and never for modified variants like Ctrl+Shift+K (devtools shortcuts).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.querySelector('[role="dialog"]')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the palette.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const searching = term.length >= 2;
  const queriesOn = open && searching;

  const vehiclesQ = useQuery({
    queryKey: ["vehicles", "globalSearch", term],
    enabled: queriesOn,
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
    enabled: queriesOn && customersOn,
    queryFn: () =>
      listRows<Customer>("customers", (q) =>
        q.or(`name.ilike.%${term}%,cr_number.ilike.%${term}%`).order("name").limit(LIMIT),
      ),
  });

  const certsQ = useQuery({
    queryKey: ["speed_limiter_certificates", "globalSearch", term],
    enabled: queriesOn && certsOn,
    queryFn: () =>
      listRows<SpeedLimiterCertificate>("speed_limiter_certificates", (q) =>
        q.ilike("certificate_number", `%${term}%`).order("expires_at").limit(LIMIT),
      ),
  });

  const anyLoading = queriesOn && (vehiclesQ.isLoading || customersQ.isLoading || certsQ.isLoading);
  const anyError = Boolean(vehiclesQ.error || customersQ.error || certsQ.error);

  /** The flat, keyboard-navigable item list: recent → commands → results. */
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const needle = term.toLowerCase();

    if (!searching) {
      for (const r of getRecent()) {
        out.push({ key: `r:${r.path}`, icon: Clock, label: r.label, path: r.path, group: "recent" });
      }
    }

    for (const item of NAV_ITEMS) {
      if (!isEnabled(item.moduleId)) continue;
      const label = t(item.labelKey);
      if (searching && !label.toLowerCase().includes(needle)) continue;
      out.push({ key: `g:${item.to}`, icon: item.icon, label, path: item.to, group: "goto" });
    }

    if (searching) {
      for (const v of vehiclesQ.data ?? []) {
        out.push({
          key: `v:${v.id}`,
          icon: Truck,
          label: v.name,
          meta: v.license_plate ?? v.vin ?? undefined,
          path: `/vehicles/${v.id}`,
          group: "vehicles",
        });
      }
      for (const c of customersQ.data ?? []) {
        out.push({
          key: `c:${c.id}`,
          icon: Building2,
          label: c.name,
          meta: c.cr_number ?? undefined,
          path: `/customers/${c.id}`,
          group: "customers",
        });
      }
      for (const c of certsQ.data ?? []) {
        out.push({
          key: `x:${c.id}`,
          icon: Award,
          label: c.certificate_number,
          path: "/speed-limiters/certificates",
          group: "certificates",
        });
      }
    }
    return out;
    // `open` is a dependency so the Recent section re-reads localStorage on
    // every palette open (visits since the last open would otherwise be stale).
  }, [searching, term, t, isEnabled, vehiclesQ.data, customersQ.data, certsQ.data, open]);

  // Keep the highlight valid as the list changes; scroll it into view.
  useEffect(() => {
    setHighlight(0);
  }, [term, open]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function go(path: string) {
    setOpen(false);
    setRaw("");
    navigate(path);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[highlight];
      if (item) go(item.path);
    }
  }

  const empty = searching && !anyLoading && !anyError && items.length === 0;
  const showPanel = open && (items.length > 0 || anyLoading || anyError || empty);

  const GROUP_LABELS: Record<PaletteItem["group"], string> = {
    recent: t("search.recent"),
    goto: t("search.goto"),
    vehicles: t("nav.vehicles"),
    customers: t("nav.customers"),
    certificates: t("customers.certificates"),
  };

  const groupHeading =
    "px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider rtl:tracking-normal text-ink-3";

  let lastGroup: PaletteItem["group"] | null = null;

  return (
    <div ref={rootRef} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
      <input
        ref={inputRef}
        value={raw}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-list"
        aria-activedescendant={items[highlight] ? `gs-item-${highlight}` : undefined}
        onChange={(e) => {
          setRaw(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
        placeholder={t("search.placeholder")}
        className="w-full rounded-xl border border-line bg-canvas ps-9 pe-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand-400 focus:bg-surface focus:outline-2 focus:outline-brand-500/25 sm:pe-14"
      />
      <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-3 sm:block">
        {navigator.platform.toUpperCase().includes("MAC") ? "⌘K" : "Ctrl K"}
      </kbd>

      {showPanel && (
        <div
          ref={listRef}
          id="global-search-list"
          role="listbox"
          className="animate-pop-in absolute inset-x-0 top-full z-50 mt-2 max-h-[min(70vh,30rem)] overflow-y-auto rounded-xl border border-line bg-surface pb-1 shadow-pop"
        >
          {anyLoading && items.length === 0 && (
            <div className="px-3 py-4 text-sm text-ink-3">{t("common.loading")}</div>
          )}
          {anyError && items.length === 0 && !anyLoading && (
            <div className="px-3 py-4 text-sm text-serious">{t("common.error")}</div>
          )}
          {empty && <div className="px-3 py-4 text-sm text-ink-3">{t("search.noResults")}</div>}
          {items.map((item, i) => {
            const heading = item.group !== lastGroup ? GROUP_LABELS[item.group] : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.key}>
                {heading && <div className={groupHeading}>{heading}</div>}
                <button
                  id={`gs-item-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === highlight}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm ${
                    i === highlight ? "bg-canvas text-ink" : "text-ink-2 hover:bg-canvas"
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => go(item.path)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink-3" />
                  <span className="truncate font-medium text-ink">{item.label}</span>
                  {item.meta && (
                    <span className="ms-auto truncate text-xs text-ink-3">{item.meta}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

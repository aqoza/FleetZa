/**
 * A searchable single-select.
 *
 * The native <Select> pickers it replaces rendered a bounded page of rows —
 * 200 — with no way to reach row 201. That was survivable at demo scale and is
 * not: this tenant has 477 vehicles, so a third of the fleet was simply absent
 * from every vehicle dropdown. Filtering a truncated list client-side would
 * not have fixed it, which is why `onSearch` goes to the server.
 *
 * The component itself is dumb: it renders the options it is given and reports
 * what the user typed. Fetching, debouncing and keeping the *selected* row
 * present in the list (it is usually outside the first page of results) belong
 * to the picker hooks in `src/lib/pickers.ts`.
 */
import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { useT } from "../i18n";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text — plate, SKU, CR number. Shown muted at the row's end. */
  meta?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  /** Typed term, already debounced by the caller's hook. Omit for a local filter. */
  onSearch?: (term: string) => void;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Shown when nothing is selected; doubles as the "any" label on filters. */
  placeholder?: string;
  /** Offer a clear button once something is selected. Filters want this. */
  clearable?: boolean;
  className?: string;
  id?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  onSearch,
  loading = false,
  disabled = false,
  required = false,
  placeholder,
  clearable = true,
  className,
  id,
}: ComboboxProps) {
  const t = useT();
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  /**
   * Without `onSearch` the caller has handed us the whole (small) list and
   * expects the filtering to happen here — status enums, technicians, a
   * customer's handful of contacts. With it, the server has already filtered
   * and re-filtering locally would only hide rows it deliberately returned.
   */
  const visible = useMemo(() => {
    if (onSearch || !query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.meta ?? "").toLowerCase().includes(needle),
    );
  }, [options, query, onSearch]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    onSearch?.("");
  }, [onSearch]);

  // Click outside commits nothing and restores the selected label.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // A new term means a new best match, so the highlight goes back to the top;
  // it is also clamped as results arrive, and kept in view.
  useEffect(() => {
    setHighlight(0);
  }, [query]);
  useEffect(() => {
    setHighlight((h) => (h >= visible.length ? 0 : h));
  }, [visible.length]);
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  // No refocus needed: the panel suppresses mousedown, so focus never leaves
  // the input on the click path, and the keyboard path never left it either.
  // Calling focus() here would be a no-op at best and would re-fire onFocus
  // (reopening the panel) if it ever were not.
  function pick(option: ComboboxOption) {
    onChange(option.value);
    close();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) =>
        e.key === "ArrowDown"
          ? Math.min(h + 1, visible.length - 1)
          : Math.max(h - 1, 0),
      );
    } else if (e.key === "Enter") {
      // Always swallowed while open: Enter here means "take the highlighted
      // row", and letting it fall through would submit the surrounding form
      // with a half-typed search term standing in for a choice.
      if (!open) return;
      e.preventDefault();
      const option = visible[highlight];
      if (option) pick(option);
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      // Stopped here so Escape dismisses the dropdown without also closing the
      // dialog it sits in.
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  /**
   * The input carries `required` itself rather than a hidden mirror field,
   * which browsers refuse to focus when validation fails. That works because
   * the box is empty exactly when nothing is selected: the typed term is
   * cleared on every close, and Enter can never leave a stray term behind.
   */
  const text = open ? query : (selected?.label ?? "");
  const showClear = clearable && !disabled && Boolean(value);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && visible[highlight] ? `${listId}-${highlight}` : undefined
        }
        autoComplete="off"
        // Deliberately no dir="auto": it re-resolves the element's own
        // direction, which flips the logical padding away from the clear/
        // chevron icons and puts the text under them on an RTL page. Mixed
        // identifiers are isolated in the option rows below with <bdi>, where
        // it costs nothing.
        value={text}
        disabled={disabled}
        required={required}
        // While the box is open it holds the search term, not the selection —
        // so the current choice becomes the ghost text, and typing over it
        // never looks like the field was emptied.
        placeholder={open && selected ? selected.label : placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onSearch?.(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-line bg-surface ps-3 pe-14 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand-500 focus:outline-2 focus:outline-brand-500/30 disabled:bg-canvas disabled:text-ink-3"
      />

      <div className="pointer-events-none absolute inset-y-0 end-2 flex items-center gap-0.5">
        {showClear && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("action.clear")}
            // onMouseDown, not onClick: the input must not blur (and reopen the
            // panel) between press and release.
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              setQuery("");
              onSearch?.("");
            }}
            className="pointer-events-auto rounded p-1 text-ink-3 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className="h-4 w-4 text-ink-3" />
      </div>

      {open && !disabled && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          // Suppressing mousedown keeps focus on the input, so the panel is
          // still mounted when the option's click handler runs.
          onMouseDown={(e) => e.preventDefault()}
          className="animate-pop-in absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop"
        >
          {loading && visible.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-ink-3">{t("common.loading")}</div>
          )}
          {!loading && visible.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-ink-3">{t("search.noResults")}</div>
          )}
          {visible.map((option, i) => (
            <button
              key={option.value}
              id={`${listId}-${i}`}
              data-index={i}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(option)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm ${
                i === highlight ? "bg-canvas text-ink" : "text-ink-2 hover:bg-canvas"
              }`}
            >
              <Check
                className={`h-3.5 w-3.5 shrink-0 text-brand-600 ${
                  option.value === value ? "" : "invisible"
                }`}
              />
              {/* Options are identifiers in mixed scripts — plates, serials,
                  CR numbers. <bdi> keeps "12345 A/1" in that order on an
                  Arabic page instead of reordering it to "A/1 12345". */}
              <span className="truncate"><bdi>{option.label}</bdi></span>
              {option.meta && (
                <span className="ms-auto truncate ps-2 text-xs text-ink-3">
                  <bdi>{option.meta}</bdi>
                </span>
              )}
            </button>
          ))}
          {/* The server caps results, so a term that is still too broad shows a
              page of matches and no hint that more exist. Say so. */}
          {onSearch && !loading && visible.length >= 20 && (
            <p className="border-t border-line px-3 pt-2 pb-1 text-xs text-ink-3">
              {t("combobox.refine")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

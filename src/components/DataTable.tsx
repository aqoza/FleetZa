import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Columns3 } from "lucide-react";
import { Button } from "./ui";
import { useT } from "../i18n";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables client-side sorting of the loaded rows (the current page). */
  sortValue?: (row: T) => string | number | null;
  /** Plain-text value for CSV export; falls back to sortValue. */
  exportValue?: (row: T) => string | number | null;
  align?: "start" | "end";
  /** Column renders only at this breakpoint and up (responsive priority). */
  minBreakpoint?: "sm" | "md" | "lg" | "xl";
  /** Hidden until the user enables it in the column chooser. */
  defaultHidden?: boolean;
}

const BREAKPOINT_CLASS: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

function csvEscape(value: string | number): string {
  let s = String(value);
  // Neutralize spreadsheet formula injection (=, +, -, @ starters).
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The platform table (docs/DESIGN_SYSTEM.md): tokenized, sortable on the
 * loaded rows, per-user column chooser (persisted per tableId), optional row
 * selection with a bulk-action slot, CSV export of the visible data, and
 * responsive column priorities. Pair with server pagination (`listPage` +
 * `<Pagination>` in the `footer` slot).
 */
export function DataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  onRowClick,
  selectable = false,
  bulkActions,
  exportName,
  toolbar,
  empty,
  footer,
}: {
  tableId: string;
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  bulkActions?: (selected: T[]) => ReactNode;
  exportName?: string;
  /** Extra controls rendered in the table toolbar (filters live on the page). */
  toolbar?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const storageKey = `fm.cols.${tableId}`;

  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
  });
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) {
        setChooserOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Selection refers to loaded rows only; drop stale keys when rows change.
  useEffect(() => {
    setSelected((prev) => {
      const keys = new Set(rows.map(rowKey));
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function toggleColumn(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (columns.length - next.size <= 1) return prev; // keep ≥1 visible
      else next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const visible = columns.filter((c) => !hidden.has(c.id));

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  }, [rows, sort, columns]);

  const selectedRows = useMemo(
    () => sorted.filter((r) => selected.has(rowKey(r))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted, selected],
  );

  function exportCsv() {
    const cols = visible.filter((c) => c.exportValue ?? c.sortValue);
    const lines = [
      cols.map((c) => csvEscape(c.header)).join(","),
      ...sorted.map((r) =>
        cols.map((c) => csvEscape((c.exportValue ?? c.sortValue)!(r) ?? "")).join(","),
      ),
    ];
    // BOM so Excel decodes UTF-8 (Arabic headers/values) correctly.
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? tableId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {toolbar}
          {selectable && selected.size > 0 && (
            <>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 tabular-nums">
                {t("table.selected", { count: selected.size })}
              </span>
              {bulkActions?.(selectedRows)}
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                {t("table.clearSelection")}
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {exportName !== undefined && (
            <Button variant="ghost" onClick={exportCsv} title={t("action.export")}>
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">{t("action.export")}</span>
            </Button>
          )}
          <div ref={chooserRef} className="relative">
            <Button
              variant="ghost"
              onClick={() => setChooserOpen((o) => !o)}
              aria-expanded={chooserOpen}
              title={t("table.columns")}
            >
              <Columns3 className="h-4 w-4" />
              <span className="hidden sm:inline">{t("table.columns")}</span>
            </Button>
            {chooserOpen && (
              <div className="animate-pop-in absolute end-0 top-full z-30 mt-1 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
                {columns.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-2 hover:bg-canvas"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line"
                      checked={!hidden.has(c.id)}
                      onChange={() => toggleColumn(c.id)}
                    />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {sorted.length === 0 && empty ? (
        empty
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-canvas/60">
              <tr>
                {selectable && (
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line"
                      checked={allSelected}
                      aria-label={t("table.selectAll")}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map(rowKey)))
                      }
                    />
                  </th>
                )}
                {visible.map((c) => {
                  const sortable = Boolean(c.sortValue);
                  const active = sort?.id === c.id;
                  return (
                    <th
                      key={c.id}
                      aria-sort={
                        active ? (sort!.dir === 1 ? "ascending" : "descending") : undefined
                      }
                      className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal ${
                        c.align === "end" ? "text-end" : "text-start"
                      } ${c.minBreakpoint ? BREAKPOINT_CLASS[c.minBreakpoint] : ""}`}
                    >
                      {sortable ? (
                        <button
                          className="inline-flex items-center gap-1 uppercase hover:text-ink"
                          onClick={() =>
                            setSort(
                              active && sort!.dir === 1
                                ? { id: c.id, dir: -1 }
                                : active
                                  ? null
                                  : { id: c.id, dir: 1 },
                            )
                          }
                        >
                          {c.header}
                          {active ? (
                            sort!.dir === 1 ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    className={`transition-colors ${
                      onRowClick ? "cursor-pointer hover:bg-canvas" : "hover:bg-slate-50"
                    } ${selected.has(key) ? "bg-brand-50/40" : ""}`}
                    onClick={
                      onRowClick
                        ? (e) => {
                            // Links/buttons/inputs inside cells own their click —
                            // avoid double navigation (duplicate history entries).
                            const el = e.target as HTMLElement;
                            if (el.closest("a,button,input,label")) return;
                            onRowClick(row);
                          }
                        : undefined
                    }
                  >
                    {selectable && (
                      <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-line"
                          checked={selected.has(key)}
                          aria-label={key}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td
                        key={c.id}
                        className={`px-4 py-3 ${
                          c.align === "end" ? "text-end tabular-nums" : "text-start"
                        } ${c.minBreakpoint ? BREAKPOINT_CLASS[c.minBreakpoint] : ""}`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {footer}
    </div>
  );
}

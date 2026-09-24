import { useEffect, useId } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Loader2, X } from "lucide-react";
import { useT } from "../i18n";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- Bidi isolation (docs/I18N.md "Left-to-right data") ---

/**
 * Data that always reads left to right: phone numbers, emails, URLs, plates,
 * VINs, serials, document numbers, SKUs, CR/tax numbers, IBANs — and anything
 * from src/lib/format.ts, which formats in the tenant's en-<CC> locale. On an
 * Arabic page the bidi algorithm otherwise reorders it ("+1 702 555 0133"
 * renders as "0133 555 702 1+", "84,210 km" as "km 84,210"). Inline and
 * isolated, so the surrounding alignment and sentence order are untouched.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cx("[unicode-bidi:isolate]", className)}>
      {children}
    </span>
  );
}

/**
 * User-entered text in an unknown script: customer, vehicle, driver and
 * product names, titles, addresses. Isolated, with its direction taken from
 * its first strong character, so "Gulf Freight Co." keeps its period at the
 * end and an Arabic name still reads right to left. Use <Ltr> instead when the
 * value has no letters to decide by (a phone, a bare number).
 */
export function Bdi({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}

/** Input types whose values are left-to-right data. */
const LTR_INPUT_TYPES = new Set(["email", "tel", "url"]);

// --- Button ---

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300 shadow-sm",
  secondary:
    "bg-surface text-ink-2 border border-line hover:bg-canvas disabled:text-ink-3",
  danger: "bg-serious text-white hover:bg-red-700 disabled:bg-red-300 shadow-sm",
  ghost: "text-ink-2 hover:bg-canvas disabled:text-ink-3",
};

export function Button({
  variant = "primary",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed",
        buttonStyles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// --- Form fields ---

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-2">
        {label}
        {required && <span className="text-serious"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-serious">{error}</span>}
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand-500 focus:outline-2 focus:outline-brand-500/30 disabled:bg-canvas disabled:text-ink-3";

/**
 * Free text takes its direction from what it holds (`unicode-bidi: plaintext`),
 * so editing "Gulf Freight Co." on an Arabic page doesn't show ".Gulf Freight
 * Co", while Arabic values and placeholders stay right to left. Skipped when
 * the field has an explicit direction.
 */
const freeTextBidi = "[unicode-bidi:plaintext]";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  // Emails, phone numbers and URLs are typed and read left to right on an
  // Arabic page too. Pass `dir="ltr"` for other LTR data (VIN, IBAN, codes).
  const dir = rest.dir ?? (rest.type && LTR_INPUT_TYPES.has(rest.type) ? "ltr" : undefined);
  return <input className={cx(inputBase, !dir && freeTextBidi, className)} {...rest} dir={dir} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cx(inputBase, "min-h-20", !rest.dir && freeTextBidi, className)} {...rest} />
  );
}

// --- Badge ---

export type BadgeTone = "green" | "yellow" | "red" | "blue" | "slate" | "purple";

const badgeStyles: Record<BadgeTone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-700 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
  purple: "bg-purple-50 text-purple-700 ring-purple-600/20",
};

export function Badge({ tone = "slate", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        badgeStyles[tone],
      )}
    >
      {children}
    </span>
  );
}

// --- Card ---

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-2xl border border-line bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

// --- Icon chip + stat card (the KPI language — docs/DESIGN_SYSTEM.md) ---

export type ChipTone = "blue" | "green" | "amber" | "violet" | "red" | "slate";

const chipStyles: Record<ChipTone, string> = {
  blue: "bg-brand-50 text-brand-600",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  red: "bg-red-50 text-red-600",
  slate: "bg-slate-100 text-slate-500",
};

/** Tinted square icon holder used on stat cards, panels, and activity rows. */
export function IconChip({ tone = "blue", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        chipStyles[tone],
      )}
    >
      {children}
    </span>
  );
}

/** KPI card: icon chip, muted label, large tabular value, optional sub line. */
export function StatCard({
  icon,
  tone,
  label,
  value,
  sub,
  subTone = "muted",
}: {
  icon: ReactNode;
  tone?: ChipTone;
  label: string;
  value: ReactNode;
  sub?: string;
  subTone?: "muted" | "good" | "warn" | "serious";
}) {
  const subColor = {
    muted: "text-ink-3",
    good: "text-good",
    warn: "text-warn",
    serious: "text-serious",
  }[subTone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-2">{label}</div>
          <div className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-ink tabular-nums">
            {value}
          </div>
          {sub && <div className={cx("mt-2 truncate text-xs font-medium", subColor)}>{sub}</div>}
        </div>
        <IconChip tone={tone}>{icon}</IconChip>
      </div>
    </Card>
  );
}

// --- Page header ---

export function PageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description?: string;
  /**
   * Status shown beside the title — the record's headline state, readable
   * without scrolling to the card that owns it. Optional, so every existing
   * header renders byte-identically.
   */
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {/* Baseline-aligned rather than centred: the badge is small text next
            to a 2xl heading, and centring leaves it visibly floating. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Record pages title themselves with user data ("Gulf Freight
              Co.", a plate); <bdi> keeps its punctuation in place on an
              Arabic page and is a no-op for translated titles. */}
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            <bdi>{title}</bdi>
          </h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// --- Modal ---

export function Modal({
  title,
  open,
  onClose,
  children,
  wide,
  busy,
  busyTitle,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /**
   * Work is in flight that must not be abandoned half-done — a sequential run
   * of writes whose report only exists inside the dialog. While set, the close
   * button is disabled, so the dialog cannot be dismissed out from under it.
   * Optional: every Modal that omits it behaves exactly as before.
   */
  busy?: boolean;
  /** Title/aria-label for the disabled close button — say why it will not close. */
  busyTitle?: string;
}) {
  const t = useT();
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-sidebar/50 p-4 pt-[8vh] backdrop-blur-[2px]">
      {/* Named by the visible heading rather than aria-label={title}: a title
          may carry bidi isolates (ltrText/bdiText), which belong in rendered
          text, never in an attribute. */}
      <div
        className={cx("animate-pop-in w-full rounded-2xl bg-surface shadow-pop", wide ? "max-w-2xl" : "max-w-md")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-ink-3 hover:bg-canvas hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-3"
            aria-label={busy && busyTitle ? busyTitle : t("action.close")}
            title={busy ? busyTitle : undefined}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// --- Table ---

export function Table({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="min-w-full divide-y divide-line text-sm">
        <thead className="bg-canvas/60">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-start text-[11px] font-semibold uppercase tracking-wider text-ink-3 rtl:tracking-normal"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

// --- States ---

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label ?? t("common.loading")}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

// --- Pagination ---

/**
 * Server-side pagination controls for lists backed by `listPage` (src/lib/db).
 * `page` is 0-based; renders nothing when everything fits on one page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  // Deleting the last row of the final page leaves `page` out of range —
  // snap back to the last page that still has rows.
  useEffect(() => {
    if (page > lastPage) onPage(lastPage);
  }, [page, lastPage, onPage]);

  if (total <= pageSize && page === 0) return null;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 pt-3">
      <span className="text-xs text-slate-500">
        {t("pagination.range", { from, to, total })}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
          {t("pagination.prev")}
        </Button>
        <Button
          variant="secondary"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          {t("pagination.next")}
        </Button>
      </div>
    </div>
  );
}

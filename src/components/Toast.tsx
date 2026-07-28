/**
 * Site-wide toasts.
 *
 * Feedback used to be per-page and inconsistent: some mutations rendered an
 * inline <ErrorState>, some set a local "Saved." flag, most said nothing at
 * all — so a successful save on one screen looked identical to a silent
 * failure on another. This is the one place that answers "did that work?".
 *
 * Deliberately NOT a replacement for inline errors on forms. A field-level
 * problem belongs next to the field, where the user is looking; a toast is for
 * the outcome of an action they have already moved on from.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useT } from "../i18n";

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  /** Show a toast. Returns its id so a caller can dismiss it early. */
  show: (message: string, tone?: ToastTone) => number;
  success: (message: string) => number;
  /** Accepts an Error so call sites can pass a caught value straight through. */
  error: (message: string | Error) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Errors linger; confirmations do not. A success message is a receipt the user
 * glances at, but a failure is something they may need to read twice and act
 * on, so it stays up long enough to be copied down.
 */
const DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  error: 9000,
};

// Only tint steps that `[data-theme="dark"]` remaps are used here, so the
// toasts invert with the rest of the app instead of staying paper-bright.
const TONE_STYLES: Record<ToastTone, { wrap: string; icon: ReactNode }> = {
  success: {
    wrap: "border-emerald-600/20 bg-emerald-50 text-emerald-700",
    icon: <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />,
  },
  error: {
    wrap: "border-red-600/20 bg-red-50 text-red-700",
    icon: <XCircle className="h-5 w-5 shrink-0 text-red-600" />,
  },
  info: {
    wrap: "border-line bg-surface text-ink",
    icon: <Info className="h-5 w-5 shrink-0 text-brand-600" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Ids come from a ref, not state: two toasts fired in the same tick must not
  // collide on a key, and a counter in state would still hold the old value.
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, tone, message }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION[tone]),
      );
      return id;
    },
    [dismiss],
  );

  // Every pending timer is cleared on unmount, so a toast that outlives its
  // provider cannot call setState on an unmounted tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((handle) => window.clearTimeout(handle));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, "success"),
      error: (message: string | Error) =>
        show(message instanceof Error ? message.message : message, "error"),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const t = useT();
  if (toasts.length === 0) return null;
  return (
    // aria-live so a screen reader announces the outcome without moving focus;
    // print:hidden because a toast is never part of a printed document.
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 print:hidden sm:inset-x-auto sm:end-0 sm:items-end"
    >
      {toasts.map((toast) => {
        const style = TONE_STYLES[toast.tone];
        return (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`animate-pop-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-pop ${style.wrap}`}
          >
            {style.icon}
            <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={t("action.close")}
              className="-me-1 -mt-1 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Toasts from anywhere below the provider.
 *
 * Returns a no-op API rather than throwing when no provider is mounted: the
 * public quote and certificate-verify pages render outside the app shell, and
 * a missing confirmation there must not take the page down with it.
 */
const NOOP: ToastApi = {
  show: () => 0,
  success: () => 0,
  error: () => 0,
  dismiss: () => {},
};

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

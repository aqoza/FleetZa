/**
 * The pill tab row a module hub renders under its PageHeader — the shape the
 * sales and speed-limiter hubs established, shared so every module's tabs
 * look and behave the same (active state, wrapping, print-hidden).
 */
import { NavLink } from "react-router-dom";
import { useT, type MessageKey } from "../i18n";

export interface HubTab {
  to: string;
  labelKey: MessageKey;
  /** Match the path exactly (the hub's index tab). */
  end?: boolean;
  /** Hide the tab (e.g. a sub-feature whose module is disabled). */
  hidden?: boolean;
}

export function HubNav({ tabs }: { tabs: HubTab[] }) {
  const t = useT();
  return (
    <nav className="mb-4 flex flex-wrap gap-2 print:hidden">
      {tabs
        .filter((tab) => !tab.hidden)
        .map(({ to, labelKey, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive
                ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-canvas"
            }
          >
            {t(labelKey)}
          </NavLink>
        ))}
    </nav>
  );
}

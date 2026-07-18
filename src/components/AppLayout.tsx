import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Fuel,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { LANGUAGES, useI18n, type MessageKey } from "../i18n";

const nav: { to: string; labelKey: MessageKey; icon: typeof Truck; end?: boolean }[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/vehicles", labelKey: "nav.vehicles", icon: Truck },
  { to: "/drivers", labelKey: "nav.drivers", icon: Users },
  { to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
  { to: "/fuel", labelKey: "nav.fuel", icon: Fuel },
  { to: "/inspections", labelKey: "nav.inspections", icon: ClipboardCheck },
  { to: "/issues", labelKey: "nav.issues", icon: AlertTriangle },
  { to: "/renewals", labelKey: "nav.renewals", icon: ShieldCheck },
  { to: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

function LanguageSwitcher() {
  const { language, t } = useI18n();
  const { setLanguage } = useAuth();
  return (
    <div className="mb-3 flex rounded-lg bg-slate-800 p-0.5">
      {LANGUAGES.map(({ code, labelKey }) => (
        <button
          key={code}
          onClick={() => void setLanguage(code)}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            language === code ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const { tenant, profile, signOut } = useAuth();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          F
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{t("app.name")}</div>
          <div className="truncate text-xs text-slate-400">{tenant?.name}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`
            }
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-4">
        <LanguageSwitcher />
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-200">
              {profile?.full_name || profile?.email}
            </div>
            <div className="truncate text-xs text-slate-500">
              {profile?.role ? t(`role.${profile.role}`) : ""}
            </div>
          </div>
          <button
            onClick={() => void signOut()}
            title={t("action.signOut")}
            aria-label={t("action.signOut")}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar — flexbox places it at the inline-start (right in RTL) */}
      <aside className="hidden w-60 shrink-0 bg-slate-900 lg:block">{sidebar}</aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-slate-900">
            <button
              className="absolute end-3 top-4 rounded-md p-1 text-slate-400 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label={t("action.closeMenu")}
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label={t("action.openMenu")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{t("app.name")}</span>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

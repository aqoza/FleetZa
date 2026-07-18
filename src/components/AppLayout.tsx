import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useModules } from "../context/ModulesContext";
import { LANGUAGES, useI18n } from "../i18n";
import { NAV_ITEMS, NAV_SECTIONS } from "../modules/nav";
import { GlobalSearch } from "./GlobalSearch";

function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { language, t } = useI18n();
  const { setLanguage } = useAuth();
  return (
    <div className={`flex rounded-lg p-0.5 ${dark ? "bg-sidebar-2" : "bg-canvas"}`}>
      {LANGUAGES.map(({ code, labelKey }) => (
        <button
          key={code}
          onClick={() => void setLanguage(code)}
          className={`flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            language === code
              ? dark
                ? "bg-brand-600 text-white"
                : "bg-surface text-ink shadow-sm"
              : dark
                ? "text-slate-400 hover:text-slate-200"
                : "text-ink-3 hover:text-ink-2"
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
  const { isEnabled } = useModules();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const enabledItems = NAV_ITEMS.filter(({ moduleId }) => isEnabled(moduleId));
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: enabledItems.filter((item) => item.section === section.id),
  })).filter((section) => section.items.length > 0);

  const initials = (profile?.full_name || profile?.email || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white shadow-sm">
          F
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{t("app.name")}</div>
          <div className="truncate text-xs text-slate-400">{tenant?.name}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {sections.map(({ id, labelKey, items }) => (
          <div key={id}>
            {id !== "overview" && (
              <div className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 rtl:tracking-normal">
                {t(labelKey)}
              </div>
            )}
            <div className="space-y-0.5">
              {items.map(({ to, labelKey: itemKey, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-brand-600 text-white shadow-sm"
                        : "text-slate-400 hover:bg-sidebar-2 hover:text-slate-200"
                    }`
                  }
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {t(itemKey)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-line p-4">
        <div className="lg:hidden">
          <div className="mb-3">
            <LanguageSwitcher dark />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-2 text-xs font-semibold text-slate-200">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
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
            className="rounded-lg p-2 text-slate-400 hover:bg-sidebar-2 hover:text-white"
          >
            <LogOut className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar — flexbox places it at the inline-start (right in RTL) */}
      <aside className="hidden w-60 shrink-0 bg-sidebar print:hidden lg:block">{sidebar}</aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 print:hidden lg:hidden">
          <div className="absolute inset-0 bg-sidebar/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-sidebar">
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
        {/* Top header: menu (mobile) · global search · language */}
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 print:hidden sm:px-6 lg:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-ink-2 hover:bg-canvas lg:hidden"
            aria-label={t("action.openMenu")}
          >
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ms-auto hidden shrink-0 lg:block">
            <LanguageSwitcher />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

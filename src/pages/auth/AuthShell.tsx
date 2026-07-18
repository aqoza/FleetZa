import type { ReactNode } from "react";
import { LANGUAGES, useI18n } from "../../i18n";

function AuthLanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="mb-6 flex justify-center">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
        {LANGUAGES.map(({ code, labelKey }) => (
          <button
            key={code}
            onClick={() => setLanguage(code)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              language === code ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className={wide ? "w-full max-w-xl" : "w-full max-w-md"}>
        <AuthLanguageSwitcher />
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
            F
          </div>
          <span className="text-lg font-semibold text-slate-900">{t("app.name")}</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mb-5 mt-1 text-sm text-slate-500">{subtitle}</p>}
          {children}
        </div>
        {footer && <p className="mt-4 text-center text-sm text-slate-500">{footer}</p>}
      </div>
    </div>
  );
}

/**
 * i18n + text-direction engine.
 *
 * - Type-safe: `MessageKey` is the union of every key in the English
 *   dictionaries. `t(key)` only accepts known keys, so a missing string is a
 *   compile error, and each `ar/*` file's `Record<keyof typeof en*, string>`
 *   type forces every English key to have an Arabic translation.
 * - Direction: Arabic flips `<html dir="rtl">`; Tailwind logical utilities
 *   (ps/pe/ms/me/start/end/text-start) and the `rtl:` variant do the layout.
 * - Language persists to localStorage (instant, pre-auth) and, for signed-in
 *   users, to `profiles.language` (synced by AuthContext).
 *
 * Adding a module: create `messages/en/<mod>.ts` + `messages/ar/<mod>.ts`
 * (export `en<Mod>` / `ar<Mod>`) and register them in the dictionaries below.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { enCommon } from "./messages/en/common";
import { arCommon } from "./messages/ar/common";
import { enAuth } from "./messages/en/auth";
import { arAuth } from "./messages/ar/auth";
import { enDashboard } from "./messages/en/dashboard";
import { arDashboard } from "./messages/ar/dashboard";
import { enVehicles } from "./messages/en/vehicles";
import { arVehicles } from "./messages/ar/vehicles";
import { enDrivers } from "./messages/en/drivers";
import { arDrivers } from "./messages/ar/drivers";
import { enMaintenance } from "./messages/en/maintenance";
import { arMaintenance } from "./messages/ar/maintenance";
import { enFuel } from "./messages/en/fuel";
import { arFuel } from "./messages/ar/fuel";
import { enInspections } from "./messages/en/inspections";
import { arInspections } from "./messages/ar/inspections";
import { enIssues } from "./messages/en/issues";
import { arIssues } from "./messages/ar/issues";
import { enRenewals } from "./messages/en/renewals";
import { arRenewals } from "./messages/ar/renewals";
import { enReports } from "./messages/en/reports";
import { arReports } from "./messages/ar/reports";
import { enSettings } from "./messages/en/settings";
import { arSettings } from "./messages/ar/settings";
import { enModules } from "./messages/en/modules";
import { arModules } from "./messages/ar/modules";
import { enSpeedLimiters } from "./messages/en/speedLimiters";
import { arSpeedLimiters } from "./messages/ar/speedLimiters";
import { enCustomers } from "./messages/en/customers";
import { arCustomers } from "./messages/ar/customers";
import { enSlDevices } from "./messages/en/slDevices";
import { arSlDevices } from "./messages/ar/slDevices";
import { enSlJobs } from "./messages/en/slJobs";
import { arSlJobs } from "./messages/ar/slJobs";
import { enSales } from "./messages/en/sales";
import { arSales } from "./messages/ar/sales";
import { enSlCertificates } from "./messages/en/slCertificates";
import { arSlCertificates } from "./messages/ar/slCertificates";
import { enGpsTracking } from "./messages/en/gpsTracking";
import { arGpsTracking } from "./messages/ar/gpsTracking";
import { enDriverBehavior } from "./messages/en/driverBehavior";
import { arDriverBehavior } from "./messages/ar/driverBehavior";
import { enTrips } from "./messages/en/trips";
import { arTrips } from "./messages/ar/trips";
import { enDispatch } from "./messages/en/dispatch";
import { arDispatch } from "./messages/ar/dispatch";
import { enWorkshop } from "./messages/en/workshop";
import { arWorkshop } from "./messages/ar/workshop";
import { enPredictive } from "./messages/en/predictive";
import { arPredictive } from "./messages/ar/predictive";
import { enInsurance } from "./messages/en/insurance";
import { arInsurance } from "./messages/ar/insurance";
import { enIncidents } from "./messages/en/incidents";
import { arIncidents } from "./messages/ar/incidents";
import { enRegulatory } from "./messages/en/regulatory";
import { arRegulatory } from "./messages/ar/regulatory";
import { enTms } from "./messages/en/tms";
import { arTms } from "./messages/ar/tms";
import { enDeliveries } from "./messages/en/deliveries";
import { arDeliveries } from "./messages/ar/deliveries";
import { enAssets } from "./messages/en/assets";
import { arAssets } from "./messages/ar/assets";
import { enInventory } from "./messages/en/inventory";
import { arInventory } from "./messages/ar/inventory";
import { enPurchasing } from "./messages/en/purchasing";
import { arPurchasing } from "./messages/ar/purchasing";
import { enPos } from "./messages/en/pos";
import { arPos } from "./messages/ar/pos";
import { enCrm } from "./messages/en/crm";
import { arCrm } from "./messages/ar/crm";
import { enFinance } from "./messages/en/finance";
import { arFinance } from "./messages/ar/finance";
import { enContracts } from "./messages/en/contracts";
import { arContracts } from "./messages/ar/contracts";
import { enHr } from "./messages/en/hr";
import { arHr } from "./messages/ar/hr";
import { enField } from "./messages/en/field";
import { arField } from "./messages/ar/field";
import { enEmployees } from "./messages/en/employees";
import { arEmployees } from "./messages/ar/employees";
import { enSuppliers } from "./messages/en/suppliers";
import { arSuppliers } from "./messages/ar/suppliers";
import { enCustomerPortal } from "./messages/en/customerPortal";
import { arCustomerPortal } from "./messages/ar/customerPortal";
import { enVendorPortal } from "./messages/en/vendorPortal";
import { arVendorPortal } from "./messages/ar/vendorPortal";
import { enAnalytics } from "./messages/en/analytics";
import { arAnalytics } from "./messages/ar/analytics";
import { enDocuments } from "./messages/en/documents";
import { arDocuments } from "./messages/ar/documents";
import { enAutomation } from "./messages/en/automation";
import { arAutomation } from "./messages/ar/automation";
import { enIntegrations } from "./messages/en/integrations";
import { arIntegrations } from "./messages/ar/integrations";
import { enIot } from "./messages/en/iot";
import { arIot } from "./messages/ar/iot";
import { enNotifications } from "./messages/en/notifications";
import { arNotifications } from "./messages/ar/notifications";
import { enSecurity } from "./messages/en/security";
import { arSecurity } from "./messages/ar/security";
import { enCompanies } from "./messages/en/companies";
import { arCompanies } from "./messages/ar/companies";
import { enErrors } from "./messages/en/errors";
import { arErrors } from "./messages/ar/errors";

export type Language = "en" | "ar";
export type Direction = "ltr" | "rtl";

export const LANGUAGES: { code: Language; labelKey: "language.english" | "language.arabic" }[] = [
  { code: "en", labelKey: "language.english" },
  { code: "ar", labelKey: "language.arabic" },
];

const en = {
  ...enCommon,
  ...enAuth,
  ...enDashboard,
  ...enVehicles,
  ...enDrivers,
  ...enMaintenance,
  ...enFuel,
  ...enInspections,
  ...enIssues,
  ...enRenewals,
  ...enReports,
  ...enSettings,
  ...enModules,
  ...enSpeedLimiters,
  ...enCustomers,
  ...enSlDevices,
  ...enSlJobs,
  ...enSales,
  ...enSlCertificates,
  ...enGpsTracking,
  ...enDriverBehavior,
  ...enTrips,
  ...enDispatch,
  ...enWorkshop,
  ...enPredictive,
  ...enInsurance,
  ...enIncidents,
  ...enRegulatory,
  ...enTms,
  ...enDeliveries,
  ...enAssets,
  ...enInventory,
  ...enPurchasing,
  ...enPos,
  ...enCrm,
  ...enFinance,
  ...enContracts,
  ...enHr,
  ...enField,
  ...enEmployees,
  ...enSuppliers,
  ...enCustomerPortal,
  ...enVendorPortal,
  ...enAnalytics,
  ...enDocuments,
  ...enAutomation,
  ...enIntegrations,
  ...enIot,
  ...enNotifications,
  ...enSecurity,
  ...enCompanies,
  ...enErrors,
};

const ar: Record<string, string> = {
  ...arCommon,
  ...arAuth,
  ...arDashboard,
  ...arVehicles,
  ...arDrivers,
  ...arMaintenance,
  ...arFuel,
  ...arInspections,
  ...arIssues,
  ...arRenewals,
  ...arReports,
  ...arSettings,
  ...arModules,
  ...arSpeedLimiters,
  ...arCustomers,
  ...arSlDevices,
  ...arSlJobs,
  ...arSales,
  ...arSlCertificates,
  ...arGpsTracking,
  ...arDriverBehavior,
  ...arTrips,
  ...arDispatch,
  ...arWorkshop,
  ...arPredictive,
  ...arInsurance,
  ...arIncidents,
  ...arRegulatory,
  ...arTms,
  ...arDeliveries,
  ...arAssets,
  ...arInventory,
  ...arPurchasing,
  ...arPos,
  ...arCrm,
  ...arFinance,
  ...arContracts,
  ...arHr,
  ...arField,
  ...arEmployees,
  ...arSuppliers,
  ...arCustomerPortal,
  ...arVendorPortal,
  ...arAnalytics,
  ...arDocuments,
  ...arAutomation,
  ...arIntegrations,
  ...arIot,
  ...arNotifications,
  ...arSecurity,
  ...arCompanies,
  ...arErrors,
};

/** Every valid translation key. Use this to type any `labelKey` fields. */
export type MessageKey = keyof typeof en;

const DICTS: Record<Language, Record<string, string>> = { en, ar };

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: TranslateVars) => string;

interface I18nState {
  language: Language;
  dir: Direction;
  isRTL: boolean;
  setLanguage: (lang: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18nState | null>(null);

const STORAGE_KEY = "fm.lang";

function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

// Current language mirrored outside React so non-component code (e.g. the
// db error mapper in src/lib/db.ts) can translate. Kept in sync by the
// provider; same pattern as format.ts's activeLocale.
let activeLanguage: Language = initialLanguage();

function lookup(language: Language, key: MessageKey, vars?: TranslateVars): string {
  let str = DICTS[language][key] ?? DICTS.en[key] ?? (key as string);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

/** Translate outside React components. Prefer useT() inside components. */
export function translate(key: MessageKey, vars?: TranslateVars): string {
  return lookup(activeLanguage, key, vars);
}

/**
 * Translate in an explicit language, ignoring the UI language. Official
 * documents are bilingual by convention — the RSL certificate prints its
 * Arabic and English registration lines on every copy, whichever language the
 * issuing clerk is using — so those strings still live in the message bundles
 * instead of being hardcoded; they just cannot both come from one dictionary.
 */
export function translateIn(
  language: Language,
  key: MessageKey,
  vars?: TranslateVars,
): string {
  return lookup(language, key, vars);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const dir: Direction = language === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    const el = document.documentElement;
    el.lang = language;
    el.dir = dir;
  }, [language, dir]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    activeLanguage = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore storage failures (private mode) */
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => {
      let str = DICTS[language][key] ?? DICTS.en[key] ?? (key as string);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replaceAll(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [language],
  );

  const value = useMemo<I18nState>(
    () => ({ language, dir, isRTL: dir === "rtl", setLanguage, t }),
    [language, dir, setLanguage, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Shorthand for the translate function. */
export function useT(): Translate {
  return useI18n().t;
}

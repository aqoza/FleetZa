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

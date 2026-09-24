/**
 * Plural messages. A plural message is an object of CLDR plural forms instead
 * of a string:
 *
 *   en: "vehicles.countInFleet": { one: "{count} vehicle in your fleet",
 *                                  other: "{count} vehicles in your fleet" }
 *   ar: the same key with all six Arabic forms (zero … other)
 *
 * `tp(key, count)` picks the form with `Intl.PluralRules(language)` and fills
 * `{count}`. The types below make the forms compile-checked per language: an
 * English plural needs `one` + `other`, an Arabic one needs all six.
 */
import type { Language } from "./index";

export type PluralCategory = Intl.LDMLPluralRule;

/**
 * The CLDR plural categories each language distinguishes — the forms its
 * plural messages must define. plural.test.ts pins this table to what
 * `Intl.PluralRules` reports, so the static types cannot drift from the rules
 * that select a form at runtime.
 */
export const PLURAL_CATEGORIES = {
  en: ["one", "other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
} as const satisfies Record<Language, readonly PluralCategory[]>;

/** The forms a plural message defines in `L`. */
export type PluralForms<L extends Language> = Record<(typeof PLURAL_CATEGORIES)[L][number], string>;

/**
 * The type of a translation of the English namespace `En` into `L`: string
 * messages stay strings, plural messages carry every form `L` needs. Type each
 * `ar/<ns>.ts` as `Translation<typeof en<Ns>, "ar">`.
 */
export type Translation<En, L extends Language> = {
  [K in keyof En]: En[K] extends string ? string : PluralForms<L>;
};

const rulesByLanguage = new Map<Language, Intl.PluralRules>();

/** The plural category `count` falls in for `language` (e.g. ar: 11 → "many"). */
export function pluralCategory(language: Language, count: number): PluralCategory {
  let rules = rulesByLanguage.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    rulesByLanguage.set(language, rules);
  }
  return rules.select(count);
}

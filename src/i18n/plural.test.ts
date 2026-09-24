import { describe, expect, expectTypeOf, it } from "vitest";
import { translatePluralIn, type Language, type MessageKey, type PluralKey } from "./index";
import {
  PLURAL_CATEGORIES,
  pluralCategory,
  type PluralCategory,
  type PluralForms,
  type Translation,
} from "./plural";

type Forms = Partial<Record<PluralCategory, string>>;
type Dict = Record<string, string | Forms>;

// Every namespace module, merged per language, without going through the
// engine: the dictionaries themselves are what these tests inspect.
const modules = import.meta.glob<Record<string, Dict>>("./messages/*/*.ts", { eager: true });
function dictionary(language: Language): Dict {
  const merged: Dict = {};
  for (const [file, mod] of Object.entries(modules)) {
    if (file.startsWith(`./messages/${language}/`)) {
      for (const namespace of Object.values(mod)) Object.assign(merged, namespace);
    }
  }
  return merged;
}
const DICTS: Record<Language, Dict> = { en: dictionary("en"), ar: dictionary("ar") };
const pluralEntries = (language: Language) =>
  Object.entries(DICTS[language]).filter(
    (entry): entry is [string, Forms] => typeof entry[1] !== "string",
  );
const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);

describe("PLURAL_CATEGORIES", () => {
  it.each(Object.entries(PLURAL_CATEGORIES))(
    "matches Intl.PluralRules for %s",
    (language, categories) => {
      const actual = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
      expect([...actual].sort()).toEqual([...categories].sort());
    },
  );
});

describe("pluralCategory", () => {
  it("selects English one/other", () => {
    expect([0, 1, 2, 5, 1.5].map((n) => pluralCategory("en", n))).toEqual([
      "other",
      "one",
      "other",
      "other",
      "other",
    ]);
  });

  it("selects all six Arabic categories, by the last two digits past 100", () => {
    const cases: Array<[number, PluralCategory]> = [
      [0, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [10, "few"],
      [11, "many"],
      [99, "many"],
      [100, "other"],
      [101, "other"],
      [102, "other"],
      [103, "few"],
      [111, "many"],
    ];
    for (const [n, category] of cases) expect(pluralCategory("ar", n), `ar ${n}`).toBe(category);
  });
});

describe("translatePluralIn", () => {
  it("renders the English forms", () => {
    expect(translatePluralIn("en", "vehicles.countInFleet", 1)).toBe("1 vehicle in your fleet");
    expect(translatePluralIn("en", "vehicles.countInFleet", 0)).toBe("0 vehicles in your fleet");
    expect(translatePluralIn("en", "vehicles.countInFleet", 7)).toBe("7 vehicles in your fleet");
  });

  it("renders every Arabic form", () => {
    const ar = (n: number) => translatePluralIn("ar", "vehicles.countInFleet", n);
    expect(ar(0)).toBe("لا توجد مركبات في أسطولك");
    expect(ar(1)).toBe("مركبة واحدة في أسطولك");
    expect(ar(2)).toBe("مركبتان في أسطولك");
    expect(ar(5)).toBe("5 مركبات في أسطولك");
    expect(ar(11)).toBe("11 مركبة في أسطولك");
    expect(ar(100)).toBe("100 مركبة في أسطولك");
  });

  it("fills other placeholders alongside {count}", () => {
    expect(translatePluralIn("en", "insights.inShop", 1, { total: 4 })).toBe(
      "1 of 4 fleet vehicles is in the shop",
    );
    expect(translatePluralIn("en", "insights.inShop", 3, { total: 4 })).toBe(
      "3 of 4 fleet vehicles are in the shop",
    );
    expect(translatePluralIn("ar", "slJobs.durationValue", 5)).toBe("5 دقائق");
  });

  it("lets vars.count change the displayed number but not the chosen form", () => {
    expect(translatePluralIn("en", "vehicles.countInFleet", 1250, { count: "1,250" })).toBe(
      "1,250 vehicles in your fleet",
    );
  });
});

describe("plural dictionaries", () => {
  it.each(["en", "ar"] as const)("%s plurals define exactly its CLDR categories", (language) => {
    const expected = [...new Intl.PluralRules(language).resolvedOptions().pluralCategories].sort();
    const entries = pluralEntries(language);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, forms] of entries) {
      expect(Object.keys(forms).sort(), key).toEqual(expected);
      for (const form of Object.values(forms)) expect(form, key).not.toBe("");
    }
  });

  it("uses only placeholders the English message defines", () => {
    for (const language of ["en", "ar"] as const) {
      for (const [key, forms] of pluralEntries(language)) {
        const english = DICTS.en[key];
        const source = typeof english === "string" ? english : (english.other ?? "");
        const allowed = new Set(["{count}", ...placeholders(source)]);
        for (const [category, form] of Object.entries(forms)) {
          for (const p of placeholders(form)) {
            expect(allowed.has(p), `${language} ${key}.${category} uses ${p}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("types", () => {
  it("keeps plural and string keys apart", () => {
    expectTypeOf<"vehicles.countInFleet">().toExtend<PluralKey>();
    expectTypeOf<"vehicles.countInFleet">().not.toExtend<MessageKey>();
    expectTypeOf<"vehicles.add">().toExtend<MessageKey>();
    expectTypeOf<"vehicles.add">().not.toExtend<PluralKey>();
  });

  it("requires every form the language distinguishes", () => {
    expectTypeOf({ one: "", other: "" }).toExtend<PluralForms<"en">>();
    expectTypeOf({ one: "", other: "" }).not.toExtend<PluralForms<"ar">>();
    type En = {
      readonly "x.n": { readonly one: "{count} x"; readonly other: "{count} xs" };
      readonly "x.s": "S";
    };
    expectTypeOf<Translation<En, "ar">>().toEqualTypeOf<{
      readonly "x.n": PluralForms<"ar">;
      readonly "x.s": string;
    }>();
  });
});

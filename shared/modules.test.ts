import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  DEFAULT_MODULES,
  MODULES,
  MODULE_MAP,
  dependentsOf,
  getModule,
  moduleForPath,
  requirementsOf,
} from "./modules";

describe("MODULES registry", () => {
  it("has a unique id for every module", () => {
    const ids = MODULES.map((mod) => mod.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keys MODULE_MAP by module id, one entry per module", () => {
    expect(Object.keys(MODULE_MAP)).toHaveLength(MODULES.length);
    for (const mod of MODULES) {
      expect(MODULE_MAP[mod.id]).toBe(mod);
    }
  });

  it.each(MODULES)("$id only requires modules that exist", (mod) => {
    for (const dep of mod.requires ?? []) {
      expect(MODULE_MAP[dep], `"${mod.id}" requires unknown module "${dep}"`).toBeDefined();
    }
  });

  it.each(MODULES)("$id has no dependency cycle", (mod) => {
    // requirementsOf walks the full transitive closure with a visited set, so
    // it must terminate; a cycle (including self-requirement) would surface as
    // the module appearing inside its own requirements.
    expect(mod.requires ?? []).not.toContain(mod.id);
    expect(requirementsOf(mod.id)).not.toContain(mod.id);
  });

  it("has exactly one alwaysOn module: fleet", () => {
    const alwaysOn = MODULES.filter((mod) => mod.alwaysOn);
    expect(alwaysOn.map((mod) => mod.id)).toEqual(["fleet"]);
  });

  it("starts every available module's route paths with '/'", () => {
    for (const mod of MODULES) {
      if (mod.status !== "available") continue;
      for (const route of mod.routes ?? []) {
        expect(route.startsWith("/"), `"${mod.id}" route "${route}" must start with "/"`).toBe(
          true,
        );
      }
    }
  });
});

describe("CATEGORY_ORDER", () => {
  it("has no duplicate categories", () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
  });

  it("covers every category used by MODULES", () => {
    const used = new Set(MODULES.map((mod) => mod.category));
    for (const category of used) {
      expect(CATEGORY_ORDER).toContain(category);
    }
  });
});

describe("DEFAULT_MODULES", () => {
  it("only lists modules that exist and are available", () => {
    for (const id of DEFAULT_MODULES) {
      const mod = getModule(id);
      expect(mod, `default module "${id}" is not in the registry`).toBeDefined();
      expect(mod?.status, `default module "${id}" must be available`).toBe("available");
    }
  });

  it("has no duplicates and includes the always-on base module", () => {
    expect(new Set(DEFAULT_MODULES).size).toBe(DEFAULT_MODULES.length);
    expect(DEFAULT_MODULES).toContain("fleet");
  });
});

describe("requirementsOf()", () => {
  it("resolves transitive requirements (sl_certificates -> speed_limiters -> fleet)", () => {
    const reqs = requirementsOf("sl_certificates");
    expect(reqs).toContain("speed_limiters");
    expect(reqs).toContain("fleet");
  });

  it("returns [] for a module with no requirements and for unknown ids", () => {
    expect(requirementsOf("fleet")).toEqual([]);
    expect(requirementsOf("nope")).toEqual([]);
  });
});

describe("dependentsOf()", () => {
  it("lists enabled modules that transitively depend on the target", () => {
    expect(dependentsOf("speed_limiters", ["sl_certificates", "fleet"])).toEqual([
      "sl_certificates",
    ]);
  });

  it("never reports a module as its own dependent", () => {
    expect(dependentsOf("fleet", ["fleet"])).toEqual([]);
  });
});

describe("moduleForPath()", () => {
  it("matches nested paths under a module's route prefix", () => {
    expect(moduleForPath("/vehicles/123")?.id).toBe("fleet");
  });

  it("matches an exact route path", () => {
    expect(moduleForPath("/speed-limiters")?.id).toBe("speed_limiters");
  });

  it("returns undefined for paths no module owns", () => {
    expect(moduleForPath("/nope")).toBeUndefined();
  });
});

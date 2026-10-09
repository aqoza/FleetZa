import { describe, expect, it } from "vitest";
import migration from "../../../supabase/migrations/20261008000031_bi_analytics.sql?raw";
import { METRICS } from "../../../shared/bi";

// shared/bi.ts is the client's copy of the SQL catalog; they must not drift.
describe("BI metric catalog", () => {
  it("mirrors app.bi_metric_dimensions in the migration", () => {
    const sql = migration;
    const body = sql.slice(sql.indexOf("function app.bi_metric_dimensions"), sql.indexOf("grant execute on function app.bi_metric_dimensions"));
    const fromSql = new Map<string, string[]>();
    for (const m of body.matchAll(/when '([a-z_]+)' then array\[([^\]]*)\]/g)) {
      fromSql.set(m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    }
    expect(fromSql.size).toBe(METRICS.length);
    for (const def of METRICS) expect(fromSql.get(def.id), def.id).toEqual([...def.dimensions]);
  });

});

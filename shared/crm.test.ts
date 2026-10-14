import { describe, expect, it } from "vitest";
import { activityState, byStage, forecast, leadMoves, pipelineTotals, stageMoves, stageProbability, type PipelineRow } from "./crm";

const opp = (o: Partial<PipelineRow>): PipelineRow => ({ stage: "proposal", amount: 1000, probability: 50, expected_close_date: null, ...o });

describe("lifecycles", () => {
  it("mirrors the lead guard", () => {
    expect(leadMoves("new")).toEqual(["contacted", "qualified", "unqualified"]);
    expect(leadMoves("unqualified")).toEqual(["new"]);
    expect(leadMoves("converted")).toEqual([]);
  });
  it("lets open stages move freely and closed ones only reopen", () => {
    expect(stageMoves("proposal")).toContain("won");
    expect(stageMoves("proposal")).not.toContain("proposal");
    expect(stageMoves("lost")).toEqual(["prospecting", "qualification", "proposal", "negotiation"]);
  });
  it("defaults probability by stage", () => {
    expect([stageProbability("prospecting"), stageProbability("negotiation"), stageProbability("won"), stageProbability("lost")])
      .toEqual([10, 75, 100, 0]);
  });
});

describe("pipeline figures", () => {
  const rows = [
    opp({ stage: "proposal", amount: "1000", probability: 50 }),
    opp({ stage: "negotiation", amount: 2000, probability: 75 }),
    opp({ stage: "won", amount: 4000, probability: 100 }),
    opp({ stage: "lost", amount: 500, probability: 0 }),
  ];
  it("totals open, weighted and won amounts", () => {
    const t = pipelineTotals(rows);
    expect(t).toMatchObject({ open: 2, openAmount: 3000, weightedAmount: 2000, won: 1, wonAmount: 4000, lost: 1, winRate: 0.5 });
    expect(pipelineTotals([]).winRate).toBeNull();
  });
  it("groups open deals into stage columns", () => {
    const cols = byStage(rows);
    expect(cols.map((c) => c.stage)).toEqual(["prospecting", "qualification", "proposal", "negotiation"]);
    expect(cols[3]).toMatchObject({ amount: 2000, weightedAmount: 1500 });
  });
  it("forecasts by close month, pulling overdue deals into the first month", () => {
    const f = forecast(
      [
        opp({ expected_close_date: "2026-08-15" }),
        opp({ expected_close_date: "2026-11-02", amount: 2000, probability: 25 }),
        opp({ expected_close_date: "2027-09-01" }),
        opp({ stage: "won", expected_close_date: "2026-10-01" }),
      ],
      "2026-10",
      3,
    );
    expect(f).toEqual([
      { month: "2026-10", weighted: 500, best: 1000 },
      { month: "2026-11", weighted: 500, best: 2000 },
      { month: "2026-12", weighted: 0, best: 0 },
    ]);
    expect(forecast([], "2026-11", 3).map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("activity state", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const key = (iso: string) => iso.slice(0, 10);
  it("orders done, overdue, today and upcoming", () => {
    expect(activityState({ due_at: "2026-10-08T10:00:00Z", done_at: "2026-10-08T11:00:00Z" }, now, key)).toBe("done");
    expect(activityState({ due_at: "2026-10-09T09:00:00Z", done_at: null }, now, key)).toBe("overdue");
    expect(activityState({ due_at: "2026-10-09T15:00:00Z", done_at: null }, now, key)).toBe("today");
    expect(activityState({ due_at: "2026-10-10T09:00:00Z", done_at: null }, now, key)).toBe("upcoming");
    expect(activityState({ due_at: null, done_at: null }, now, key)).toBe("unscheduled");
  });
});

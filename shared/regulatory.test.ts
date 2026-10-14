import { describe, expect, it } from "vitest";
import { addMonths, currentObligations, nextDueDate, obligationState, rate, ratesBy, type RateRow } from "./regulatory";

const row = (o: Partial<RateRow>): RateRow => ({
  requirement_id: "r1", subject_type: "vehicle", subject_id: "v1", status: "pending", due_date: "2026-10-20", ...o,
});

describe("obligation state", () => {
  const today = "2026-10-08";
  it("follows the status, then the due date", () => {
    expect(obligationState({ status: "compliant", due_date: "2026-01-01" }, 30, today)).toBe("compliant");
    expect(obligationState({ status: "non_compliant", due_date: "2027-01-01" }, 30, today)).toBe("non_compliant");
    expect(obligationState({ status: "pending", due_date: "2026-10-07" }, 30, today)).toBe("overdue");
    expect(obligationState({ status: "pending", due_date: "2026-11-07" }, 30, today)).toBe("due_soon");
    expect(obligationState({ status: "pending", due_date: "2026-11-08" }, 30, today)).toBe("upcoming");
  });
  it("warns at least a week ahead, like the scanner", () => {
    expect(obligationState({ status: "pending", due_date: "2026-10-15" }, 0, today)).toBe("due_soon");
  });
});

describe("next due date", () => {
  it("clamps to the month's end like Postgres", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("counts from the due date when early, from completion when late", () => {
    expect(nextDueDate("2026-12-01", "2026-10-08", 12)).toBe("2027-12-01");
    expect(nextDueDate("2026-09-01", "2026-10-08", 3)).toBe("2027-01-08");
  });
});

describe("compliance figures", () => {
  it("counts the open obligation over older closed ones", () => {
    const cur = currentObligations([
      row({ status: "compliant", due_date: "2025-10-20" }),
      row({ status: "pending", due_date: "2026-10-20" }),
      row({ subject_id: "v2", status: "compliant", due_date: "2025-01-01" }),
      row({ subject_id: "v2", status: "waived", due_date: "2026-01-01" }),
    ]);
    expect(cur.map((r) => [r.subject_id, r.status])).toEqual([["v1", "pending"], ["v2", "waived"]]);
  });
  it("rates good standing per key", () => {
    expect(rate([])).toEqual({ total: 0, good: 0, rate: null });
    expect(rate(["compliant", "overdue", "due_soon"])).toEqual({ total: 3, good: 2, rate: 67 });
    expect(ratesBy([{ key: "tax", state: "overdue" }, { key: "safety", state: "compliant" }, { key: "tax", state: "upcoming" }]))
      .toEqual([{ key: "tax", total: 2, good: 1, rate: 50 }, { key: "safety", total: 1, good: 1, rate: 100 }]);
  });
});

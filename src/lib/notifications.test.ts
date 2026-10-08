import { describe, expect, it } from "vitest";
import { isKnownKind, numParam, relativeTime, strParam, unreadBadge } from "./notifications";

describe("notifications helpers", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");

  it("formats relative times", () => {
    expect(relativeTime("2026-10-08T11:59:40Z", now, "en")).toBe("this minute");
    expect(relativeTime("2026-10-08T11:55:00Z", now, "en")).toBe("5 minutes ago");
    expect(relativeTime("2026-10-08T09:00:00Z", now, "en")).toBe("3 hours ago");
    expect(relativeTime("2026-10-07T10:00:00Z", now, "en")).toBe("yesterday");
    expect(relativeTime("2026-09-20T10:00:00Z", now, "en")).toBe("2 weeks ago");
    expect(relativeTime("2026-10-08T11:55:00Z", now, "ar")).not.toBe("");
  });

  it("caps the unread badge", () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(150)).toBe("99+");
  });

  it("reads params defensively", () => {
    expect(numParam({ days: "12" }, "days")).toBe(12);
    expect(numParam({ days: null }, "days")).toBeNull();
    expect(numParam(null, "days")).toBeNull();
    expect(numParam({ days: "x" }, "days")).toBeNull();
    expect(strParam({ name: 5 }, "name")).toBe("5");
    expect(strParam([], "name")).toBe("");
  });

  it("knows the emitted kinds", () => {
    expect(isKnownKind("documents.expiring")).toBe(true);
    expect(isKnownKind("automation.rule")).toBe(true);
    expect(isKnownKind("something.else")).toBe(false);
  });
});

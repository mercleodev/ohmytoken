import { describe, it, expect } from "vitest";
import { formatCost, formatTokens, formatTimeAgo } from "../format";

describe("formatCost", () => {
  it("returns $0.00 for null/undefined/0/negative", () => {
    expect(formatCost(null)).toBe("$0.00");
    expect(formatCost(undefined)).toBe("$0.00");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(-1)).toBe("$0.00");
  });

  it("formats sub-milli costs in milli-dollars", () => {
    expect(formatCost(0.0005)).toBe("$0.50m");
  });

  it("formats normal costs with 4 decimal places", () => {
    expect(formatCost(0.0234)).toBe("$0.0234");
    expect(formatCost(1.5)).toBe("$1.5000");
  });

  it("handles NaN", () => {
    expect(formatCost(NaN)).toBe("$0.00");
  });
});

describe("formatTokens", () => {
  it("returns '0' for null/undefined/NaN", () => {
    expect(formatTokens(null)).toBe("0");
    expect(formatTokens(undefined)).toBe("0");
    expect(formatTokens(NaN)).toBe("0");
  });

  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatTokens(2_500)).toBe("2.5K");
  });

  it("returns raw number for small values", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(0)).toBe("0");
  });
});

describe("formatTimeAgo", () => {
  it("returns 'just now' for recent timestamps", () => {
    const now = new Date().toISOString();
    expect(formatTimeAgo(now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTimeAgo(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const twoHrsAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatTimeAgo(twoHrsAgo)).toBe("2h ago");
  });

  it("returns days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(formatTimeAgo(threeDaysAgo)).toBe("3d ago");
  });
});

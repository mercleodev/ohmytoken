import { describe, expect, it } from "vitest";
import { computeFirstRunStatus } from "../firstRunDetector";

const baseRoots = ["/tmp/fake-claude", "/tmp/fake-codex"];

describe("computeFirstRunStatus", () => {
  it("returns isFirstRun=true when no session roots exist and DB is empty", () => {
    const status = computeFirstRunStatus({
      sessionRootPaths: baseRoots,
      getTotalPromptCount: () => 0,
      existsSync: () => false,
      hasAnyEntries: () => false,
    });
    expect(status.isFirstRun).toBe(true);
    expect(status.sessionRootsPresent).toBe(false);
    expect(status.totalPromptCount).toBe(0);
  });

  it("returns isFirstRun=false when a session root has entries even if DB is empty", () => {
    const status = computeFirstRunStatus({
      sessionRootPaths: baseRoots,
      getTotalPromptCount: () => 0,
      existsSync: () => true,
      hasAnyEntries: (p) => p === "/tmp/fake-codex",
    });
    expect(status.isFirstRun).toBe(false);
    expect(status.sessionRootsPresent).toBe(true);
  });

  it("returns isFirstRun=false when DB has rows even if roots are empty", () => {
    const status = computeFirstRunStatus({
      sessionRootPaths: baseRoots,
      getTotalPromptCount: () => 17,
      existsSync: () => true,
      hasAnyEntries: () => false,
    });
    expect(status.isFirstRun).toBe(false);
    expect(status.totalPromptCount).toBe(17);
  });

  it("treats session roots that exist but are empty as not present for first-run purposes", () => {
    const status = computeFirstRunStatus({
      sessionRootPaths: baseRoots,
      getTotalPromptCount: () => 0,
      existsSync: () => true,
      hasAnyEntries: () => false,
    });
    expect(status.isFirstRun).toBe(true);
    expect(status.sessionRootsPresent).toBe(false);
  });

  it("does not throw when getTotalPromptCount fails — treats as zero", () => {
    const status = computeFirstRunStatus({
      sessionRootPaths: baseRoots,
      getTotalPromptCount: () => {
        throw new Error("db unavailable");
      },
      existsSync: () => false,
      hasAnyEntries: () => false,
    });
    expect(status.isFirstRun).toBe(true);
    expect(status.totalPromptCount).toBe(0);
  });
});

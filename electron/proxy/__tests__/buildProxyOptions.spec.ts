import { describe, it, expect, vi } from "vitest";
import { buildProxyOptions } from "../buildProxyOptions";

const makeDeps = () => ({
  resolveSessionId: vi.fn(() => "sess-1"),
  sendToMain: vi.fn(),
  sendToNotification: vi.fn(),
  onProxyScanComplete: vi.fn(),
  parseSystemContents: vi.fn(() => ({})),
  getPreviousScores: vi.fn(() => ({})),
  persistEvidence: vi.fn(),
  evidenceEngine: { score: vi.fn() } as unknown as Parameters<
    typeof buildProxyOptions
  >[0]["evidenceEngine"],
});

describe("buildProxyOptions", () => {
  it("returns a full options object with port + upstream + all evidence hooks", () => {
    const deps = makeDeps();
    const opts = buildProxyOptions({
      port: 9999,
      upstream: "localhost:8080",
      ...deps,
    });

    expect(opts.port).toBe(9999);
    expect(opts.upstream).toBe("localhost:8080");
    expect(typeof opts.resolveSessionId).toBe("function");
    expect(typeof opts.onScanComplete).toBe("function");
    expect(opts.evidenceEngine).toBe(deps.evidenceEngine);
    expect(typeof opts.getSystemContents).toBe("function");
    expect(typeof opts.getPreviousScores).toBe("function");
    expect(typeof opts.onEvidenceScored).toBe("function");
  });

  it("onScanComplete forwards to main + notification + DB", () => {
    const deps = makeDeps();
    const opts = buildProxyOptions({
      port: 1,
      upstream: "x",
      ...deps,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scan = { request_id: "r1" } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = { cost_usd: 0 } as any;

    opts.onScanComplete!(scan, usage);

    expect(deps.sendToMain).toHaveBeenCalledWith("new-prompt-scan", { scan, usage });
    expect(deps.sendToNotification).toHaveBeenCalledWith("new-prompt-scan", { scan, usage });
    expect(deps.onProxyScanComplete).toHaveBeenCalledWith(scan, usage);
  });

  it("onEvidenceScored persists + forwards evidence-scored IPC to both windows", () => {
    const deps = makeDeps();
    const opts = buildProxyOptions({
      port: 1,
      upstream: "x",
      ...deps,
    });

    const report = {
      request_id: "r1",
      timestamp: "t",
      engine_version: "v",
      fusion_method: "weighted_sum",
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
      files: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scan = { request_id: "r1", evidence_report: report } as any;

    opts.onEvidenceScored!(scan);

    expect(deps.persistEvidence).toHaveBeenCalledWith("r1", report);
    expect(deps.sendToMain).toHaveBeenCalledWith("evidence-scored", {
      requestId: "r1",
      report,
    });
    expect(deps.sendToNotification).toHaveBeenCalledWith("evidence-scored", {
      requestId: "r1",
      report,
    });
  });

  it("onEvidenceScored is a no-op when scan lacks evidence_report", () => {
    const deps = makeDeps();
    const opts = buildProxyOptions({
      port: 1,
      upstream: "x",
      ...deps,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scan = { request_id: "r1" } as any;

    opts.onEvidenceScored!(scan);

    expect(deps.persistEvidence).not.toHaveBeenCalled();
    expect(deps.sendToMain).not.toHaveBeenCalled();
    expect(deps.sendToNotification).not.toHaveBeenCalled();
  });

  it("getSystemContents delegates to parseSystemContents", () => {
    const deps = makeDeps();
    deps.parseSystemContents = vi.fn(() => ({ "CLAUDE.md": "content" }));
    const opts = buildProxyOptions({
      port: 1,
      upstream: "x",
      ...deps,
    });

    const result = opts.getSystemContents!('{"system":"s"}');
    expect(deps.parseSystemContents).toHaveBeenCalledWith('{"system":"s"}');
    expect(result).toEqual({ "CLAUDE.md": "content" });
  });
});

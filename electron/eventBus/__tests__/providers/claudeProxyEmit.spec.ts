import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client", () => ({
  emit: vi.fn(),
}));

import { emit } from "../../client";
import {
  emitClaudeProxyMessageDelta,
  emitClaudeProxyMessageStop,
} from "../../providers/claudeProxyEmit";

describe("claudeProxyEmit", () => {
  beforeEach(() => {
    vi.mocked(emit).mockClear();
  });

  it("emitClaudeProxyMessageDelta forwards a canonical proxy.sse.message_delta event", () => {
    emitClaudeProxyMessageDelta({
      requestId: "req-abc",
      deltaOutputTokens: 5,
      cumulativeOutputTokens: 12,
      cumulativeCostUsd: 0.0042,
      ts: 1700000000000,
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      type: "proxy.sse.message_delta",
      ts: 1700000000000,
      request_id: "req-abc",
      delta_output_tokens: 5,
      cumulative_output_tokens: 12,
      cumulative_cost_usd: 0.0042,
    });
  });

  it("emitClaudeProxyMessageDelta defaults ts to Date.now() when not supplied", () => {
    const before = Date.now();
    emitClaudeProxyMessageDelta({
      requestId: "req-no-ts",
      deltaOutputTokens: 1,
      cumulativeOutputTokens: 1,
      cumulativeCostUsd: 0,
    });
    const after = Date.now();

    expect(emit).toHaveBeenCalledTimes(1);
    const event = vi.mocked(emit).mock.calls[0][0];
    expect(event.type).toBe("proxy.sse.message_delta");
    expect(event.ts).toBeGreaterThanOrEqual(before);
    expect(event.ts).toBeLessThanOrEqual(after);
  });

  it("emitClaudeProxyMessageStop forwards a canonical proxy.sse.message_stop event", () => {
    emitClaudeProxyMessageStop({
      requestId: "req-xyz",
      finalOutputTokens: 100,
      finalCostUsd: 0.0123,
      ts: 1800000000000,
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      type: "proxy.sse.message_stop",
      ts: 1800000000000,
      request_id: "req-xyz",
      final_output_tokens: 100,
      final_cost_usd: 0.0123,
    });
  });

  it("emitClaudeProxyMessageStop defaults ts to Date.now() when not supplied", () => {
    const before = Date.now();
    emitClaudeProxyMessageStop({
      requestId: "req-stop-no-ts",
      finalOutputTokens: 200,
      finalCostUsd: 0,
    });
    const after = Date.now();

    expect(emit).toHaveBeenCalledTimes(1);
    const event = vi.mocked(emit).mock.calls[0][0];
    expect(event.type).toBe("proxy.sse.message_stop");
    expect(event.ts).toBeGreaterThanOrEqual(before);
    expect(event.ts).toBeLessThanOrEqual(after);
  });

  it("each helper invocation produces exactly one emit call (no batching, no dedupe)", () => {
    emitClaudeProxyMessageDelta({
      requestId: "r",
      deltaOutputTokens: 0,
      cumulativeOutputTokens: 0,
      cumulativeCostUsd: 0,
    });
    emitClaudeProxyMessageDelta({
      requestId: "r",
      deltaOutputTokens: 0,
      cumulativeOutputTokens: 0,
      cumulativeCostUsd: 0,
    });
    emitClaudeProxyMessageStop({
      requestId: "r",
      finalOutputTokens: 0,
      finalCostUsd: 0,
    });
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it("preserves zero-value fields rather than coercing to undefined", () => {
    emitClaudeProxyMessageDelta({
      requestId: "req-zero",
      deltaOutputTokens: 0,
      cumulativeOutputTokens: 0,
      cumulativeCostUsd: 0,
      ts: 1,
    });
    expect(emit).toHaveBeenCalledWith({
      type: "proxy.sse.message_delta",
      ts: 1,
      request_id: "req-zero",
      delta_output_tokens: 0,
      cumulative_output_tokens: 0,
      cumulative_cost_usd: 0,
    });
  });
});

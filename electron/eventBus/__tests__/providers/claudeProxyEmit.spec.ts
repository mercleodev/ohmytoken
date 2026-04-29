import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client", () => ({
  emit: vi.fn(),
}));

import { emit } from "../../client";
import {
  emitClaudeProxyMessageDelta,
  emitClaudeProxyMessageStop,
  recordClaudeUsageDelta,
  recordClaudeUsageFinal,
} from "../../providers/claudeProxyEmit";
import {
  getActiveSnapshot,
  resetSessionState,
  setActiveSession,
} from "../../sessionState";

describe("claudeProxyEmit", () => {
  beforeEach(() => {
    vi.mocked(emit).mockClear();
    resetSessionState();
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

  // Phase 1 retrospective review (#301) — recordClaudeUsageDelta /
  // recordClaudeUsageFinal unify the wire emit and the sessionState
  // accumulator update so proxy/server.ts only owns one helper call per
  // SSE event instead of reaching into sessionState directly.

  it("recordClaudeUsageDelta emits a delta event AND accumulates session-state tokens", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-rec",
      ctx_estimate: 0,
    });

    recordClaudeUsageDelta({
      requestId: "req-rec",
      sessionId: "sess-rec",
      deltaOutputTokens: 10,
      cumulativeOutputTokens: 30,
      deltaCostUsd: 0.0005,
      cumulativeCostUsd: 0.001,
      ts: 1700000000000,
    });

    expect(emit).toHaveBeenCalledWith({
      type: "proxy.sse.message_delta",
      ts: 1700000000000,
      request_id: "req-rec",
      delta_output_tokens: 10,
      cumulative_output_tokens: 30,
      cumulative_cost_usd: 0.001,
    });
    expect(getActiveSnapshot().current_session).toMatchObject({
      output_tokens_total: 10,
      cost_usd_total: 0.0005,
    });
  });

  it("recordClaudeUsageDelta still emits even when accumulator drops on session_id mismatch", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-current",
      ctx_estimate: 0,
    });

    recordClaudeUsageDelta({
      requestId: "req-stale",
      sessionId: "sess-stale",
      deltaOutputTokens: 99,
      cumulativeOutputTokens: 99,
      deltaCostUsd: 1.0,
      cumulativeCostUsd: 1.0,
      ts: 1700000000001,
    });

    // Wire emit always fires — observability of upstream traffic does not
    // depend on whether sessionState owns this session id.
    expect(emit).toHaveBeenCalledTimes(1);
    // Accumulator dropped the mismatched delta — totals untouched.
    expect(getActiveSnapshot().current_session).toMatchObject({
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  it("recordClaudeUsageFinal emits a stop event AND tops up session-state tokens", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-final",
      ctx_estimate: 0,
    });

    recordClaudeUsageFinal({
      requestId: "req-final",
      sessionId: "sess-final",
      topUpOutputTokens: 5,
      finalOutputTokens: 100,
      topUpCostUsd: 0.0001,
      finalCostUsd: 0.005,
      ts: 1800000000000,
    });

    expect(emit).toHaveBeenCalledWith({
      type: "proxy.sse.message_stop",
      ts: 1800000000000,
      request_id: "req-final",
      final_output_tokens: 100,
      final_cost_usd: 0.005,
    });
    expect(getActiveSnapshot().current_session).toMatchObject({
      output_tokens_total: 5,
      cost_usd_total: 0.0001,
    });
  });
});

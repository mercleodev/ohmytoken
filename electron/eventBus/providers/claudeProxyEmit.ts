// P1-3 Claude proxy emit helpers (gate doc §8). Packages parsed token + cost
// values from the proxy SSE intercept (`electron/proxy/server.ts`
// `processSseEvents`) into the canonical `proxy.sse.message_delta` /
// `proxy.sse.message_stop` HudEvent shapes and forwards them through
// `client.emit()`. The helper layer keeps the proxy server.ts free from the
// event-bus shape so the bus contract (events.ts) can evolve independently;
// callers still own try/catch around emit so SSE passthrough is never broken
// by a downstream emit failure.
//
// Token + cost are emitted from the same site because `events.ts` bundles
// `cumulative_cost_usd` / `final_cost_usd` into the same variants — see
// gate doc §8 lineage note (P1-4 absorbed into P1-3 on 2026-04-27).
//
// Phase 1 retrospective review (#301) — `recordClaudeUsageDelta` /
// `recordClaudeUsageFinal` unify the wire emit and the sessionState
// accumulator update so proxy/server.ts no longer reaches into the event-bus
// module-global state directly. The emit helpers below stay public because
// other callers (and tests) still pin the wire shape; the unified helpers
// own the per-call ordering.

import { emit } from "../client";
import { accumulateActiveSessionTokens } from "../sessionState";

export function emitClaudeProxyMessageDelta(args: {
  requestId: string;
  deltaOutputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCostUsd: number;
  ts?: number;
}): void {
  emit({
    type: "proxy.sse.message_delta",
    ts: args.ts ?? Date.now(),
    request_id: args.requestId,
    delta_output_tokens: args.deltaOutputTokens,
    cumulative_output_tokens: args.cumulativeOutputTokens,
    cumulative_cost_usd: args.cumulativeCostUsd,
  });
}

export function emitClaudeProxyMessageStop(args: {
  requestId: string;
  finalOutputTokens: number;
  finalCostUsd: number;
  ts?: number;
}): void {
  emit({
    type: "proxy.sse.message_stop",
    ts: args.ts ?? Date.now(),
    request_id: args.requestId,
    final_output_tokens: args.finalOutputTokens,
    final_cost_usd: args.finalCostUsd,
  });
}

export function recordClaudeUsageDelta(args: {
  requestId: string;
  sessionId: string;
  deltaOutputTokens: number;
  cumulativeOutputTokens: number;
  deltaCostUsd: number;
  cumulativeCostUsd: number;
  ts?: number;
}): void {
  emitClaudeProxyMessageDelta({
    requestId: args.requestId,
    deltaOutputTokens: args.deltaOutputTokens,
    cumulativeOutputTokens: args.cumulativeOutputTokens,
    cumulativeCostUsd: args.cumulativeCostUsd,
    ts: args.ts,
  });
  accumulateActiveSessionTokens({
    session_id: args.sessionId,
    output_tokens_delta: args.deltaOutputTokens,
    cost_usd_delta: args.deltaCostUsd,
  });
}

export function recordClaudeUsageFinal(args: {
  requestId: string;
  sessionId: string;
  topUpOutputTokens: number;
  finalOutputTokens: number;
  topUpCostUsd: number;
  finalCostUsd: number;
  ts?: number;
}): void {
  emitClaudeProxyMessageStop({
    requestId: args.requestId,
    finalOutputTokens: args.finalOutputTokens,
    finalCostUsd: args.finalCostUsd,
    ts: args.ts,
  });
  accumulateActiveSessionTokens({
    session_id: args.sessionId,
    output_tokens_delta: args.topUpOutputTokens,
    cost_usd_delta: args.topUpCostUsd,
  });
}

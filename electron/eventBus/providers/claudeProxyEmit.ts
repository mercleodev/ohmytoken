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

import { emit } from "../client";

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

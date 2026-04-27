export type Provider = "claude" | "codex" | "gemini";

// Wire shape of the snapshot frame's `current_session` payload. Lives here
// (next to HudEvent) so the bus contract is a single source of truth.
// `electron/eventBus/server.ts` re-exports for backward compatibility.
//
// `output_tokens_total` / `cost_usd_total` were added by P1-5 and are kept
// optional + zero-default so pre-P1-5 snapshot readers (the older statusline
// reader, mid-flight CLI builds) keep narrowing successfully. Phase 1
// retrospective (#301) flagged the optional shape as a follow-up — promoting
// to required is deferred until all readers in the monorepo are on the
// post-P1-5 build.
export interface SnapshotPayload {
  current_session:
    | {
        provider: string;
        session_id: string;
        ctx_estimate: number;
        output_tokens_total?: number;
        cost_usd_total?: number;
      }
    | null;
}

export type Severity = "info" | "warn" | "critical";

export type GuardrailCode =
  | "cache.explosion"
  | "compaction.imminent"
  | "quota.threshold"
  | "daily.cost.threshold"
  | "session.long"
  | "file.read.duplicate"
  | "file.huge";

export type HudEvent =
  | {
      type: "proxy.sse.message_start";
      ts: number;
      provider: Provider;
      model: string;
      request_id: string;
      cache?: { read?: number; create?: number };
    }
  | {
      type: "proxy.sse.message_delta";
      ts: number;
      request_id: string;
      delta_output_tokens: number;
      cumulative_output_tokens: number;
      cumulative_cost_usd: number;
    }
  | {
      type: "proxy.sse.message_stop";
      ts: number;
      request_id: string;
      final_output_tokens: number;
      final_cost_usd: number;
    }
  | {
      type: "proxy.sse.first_token";
      ts: number;
      request_id: string;
      ttft_ms: number;
    }
  | {
      type: "proxy.tool_use.start";
      ts: number;
      request_id: string;
      tool_name: string;
      input_summary: string;
    }
  | {
      type: "proxy.tool_use.stop";
      ts: number;
      request_id: string;
      tool_name: string;
      duration_ms: number;
    }
  | {
      type: "proxy.throughput";
      ts: number;
      up_bps: number;
      down_bps: number;
    }
  | {
      type: "prompt.scan.written";
      ts: number;
      request_id: string;
      prompt_id: number;
      session_id: string;
      injected_file_count: number;
    }
  | {
      type: "session.provider.active";
      ts: number;
      provider: Provider;
      session_id: string;
    }
  | {
      type: "guardrail.flag";
      ts: number;
      request_id?: string;
      code: GuardrailCode;
      severity: Severity;
      message: string;
    }
  | {
      type: "memory.hot_flash";
      ts: number;
      provider: Provider;
      session_id: string;
      loaded_entries: string[];
      total_entries: number;
    }
  | {
      type: "settings.changed";
      ts: number;
      keys: string[];
    };

export type HudEventType = HudEvent["type"];

export const HUD_EVENT_TYPES = [
  "proxy.sse.message_start",
  "proxy.sse.message_delta",
  "proxy.sse.message_stop",
  "proxy.sse.first_token",
  "proxy.tool_use.start",
  "proxy.tool_use.stop",
  "proxy.throughput",
  "prompt.scan.written",
  "session.provider.active",
  "guardrail.flag",
  "memory.hot_flash",
  "settings.changed",
] as const satisfies readonly HudEventType[];

// Compile-time guard: if the union gains a new member and HUD_EVENT_TYPES is
// not updated, this assignment fails typecheck (extra tuple element has no
// matching union member, or missing element leaves the union incomplete).
type _UnionCoversCatalog =
  (typeof HUD_EVENT_TYPES)[number] extends HudEventType ? true : never;
type _CatalogCoversUnion =
  HudEventType extends (typeof HUD_EVENT_TYPES)[number] ? true : never;
const _catalogIsComplete: _UnionCoversCatalog & _CatalogCoversUnion = true;
void _catalogIsComplete;

export function isHudEventType(value: unknown): value is HudEventType {
  return (
    typeof value === "string" &&
    (HUD_EVENT_TYPES as readonly string[]).includes(value)
  );
}

const WILDCARD_SUFFIX = ".*";

export function matchEventType(
  pattern: string,
  type: HudEventType,
): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith(WILDCARD_SUFFIX)) {
    const prefix = pattern.slice(0, -WILDCARD_SUFFIX.length);
    if (prefix.length === 0 || prefix.includes("*")) {
      return false;
    }
    return type.startsWith(`${prefix}.`);
  }

  if (pattern.includes("*")) {
    return false;
  }

  return pattern === type;
}

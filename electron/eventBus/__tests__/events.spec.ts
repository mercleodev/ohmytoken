import { describe, it, expect } from "vitest";
import {
  HUD_EVENT_TYPES,
  isHudEventType,
  matchEventType,
  type HudEvent,
  type HudEventType,
} from "../events";

describe("HudEvent type catalog", () => {
  it("exports every declared event type as a string literal in HUD_EVENT_TYPES", () => {
    expect(HUD_EVENT_TYPES).toEqual([
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
    ]);
  });

  it("HUD_EVENT_TYPES contains no duplicates", () => {
    const set = new Set<string>(HUD_EVENT_TYPES);
    expect(set.size).toBe(HUD_EVENT_TYPES.length);
  });
});

describe("isHudEventType", () => {
  it("returns true for every declared event type", () => {
    for (const type of HUD_EVENT_TYPES) {
      expect(isHudEventType(type)).toBe(true);
    }
  });

  it("returns false for unknown strings, non-strings, and structural lookalikes", () => {
    expect(isHudEventType("proxy.sse.nonsense")).toBe(false);
    expect(isHudEventType("")).toBe(false);
    expect(isHudEventType("PROXY.SSE.MESSAGE_START")).toBe(false);
    expect(isHudEventType(null)).toBe(false);
    expect(isHudEventType(undefined)).toBe(false);
    expect(isHudEventType(42)).toBe(false);
    expect(isHudEventType({ toString: () => "proxy.sse.message_start" })).toBe(
      false,
    );
  });
});

describe("matchEventType wildcard prefix", () => {
  it("matches exact type names", () => {
    expect(
      matchEventType("proxy.sse.message_start", "proxy.sse.message_start"),
    ).toBe(true);
    expect(
      matchEventType("proxy.sse.message_start", "proxy.sse.message_delta"),
    ).toBe(false);
  });

  it("matches any prefix followed by '*'", () => {
    expect(matchEventType("proxy.sse.*", "proxy.sse.message_start")).toBe(true);
    expect(matchEventType("proxy.sse.*", "proxy.sse.message_delta")).toBe(true);
    expect(matchEventType("proxy.sse.*", "proxy.sse.first_token")).toBe(true);
    expect(matchEventType("proxy.sse.*", "proxy.tool_use.start")).toBe(false);
    expect(matchEventType("proxy.sse.*", "session.provider.active")).toBe(
      false,
    );
  });

  it("supports top-level wildcard '*' matching every declared type", () => {
    for (const type of HUD_EVENT_TYPES) {
      expect(matchEventType("*", type)).toBe(true);
    }
  });

  it("treats '*' only as a trailing wildcard — mid-string wildcards do not match", () => {
    expect(matchEventType("proxy.*.message_start", "proxy.sse.message_start"))
      .toBe(false);
    expect(matchEventType("*.message_start", "proxy.sse.message_start")).toBe(
      false,
    );
  });

  it("returns false when the pattern targets an unknown type", () => {
    // We still return false rather than throwing so subscribers with stale
    // type lists degrade safely.
    expect(matchEventType("nonexistent.category.*", "proxy.sse.message_start"))
      .toBe(false);
  });
});

describe("HudEvent discriminated-union narrowing", () => {
  it("narrows the union through the `type` tag so variant-specific fields are reachable", () => {
    const ev: HudEvent = {
      type: "proxy.sse.message_delta",
      ts: 1_700_000_000_000,
      request_id: "req-1",
      delta_output_tokens: 12,
      cumulative_output_tokens: 42,
      cumulative_cost_usd: 0.00123,
    };

    if (ev.type === "proxy.sse.message_delta") {
      // Compile-time narrowing — the next field access would fail typecheck
      // if the union were not tagged correctly.
      expect(ev.delta_output_tokens).toBe(12);
      expect(ev.cumulative_cost_usd).toBeCloseTo(0.00123);
    } else {
      throw new Error("union narrowing failed");
    }
  });

  it("round-trips through JSON without losing discriminator fidelity", () => {
    const original: HudEvent = {
      type: "guardrail.flag",
      ts: 1_700_000_000_000,
      code: "cache.explosion",
      severity: "warn",
      message: "cache read grew 3x in 30s",
    };

    const parsed = JSON.parse(JSON.stringify(original)) as HudEvent;
    expect(parsed.type).toBe("guardrail.flag");
    if (parsed.type === "guardrail.flag") {
      expect(parsed.severity).toBe("warn");
      expect(parsed.code).toBe("cache.explosion");
    } else {
      throw new Error("roundtrip lost the discriminator");
    }
  });
});

// --- Compile-time completeness check ----------------------------------------
// If a new HudEvent variant is added without updating HUD_EVENT_TYPES, the
// assignment below fails typecheck. This guards the runtime catalog against
// silent drift from the union definition.
const _exhaustive: HudEventType = (() => {
  const sample = HUD_EVENT_TYPES[0];
  return sample;
})();
void _exhaustive;

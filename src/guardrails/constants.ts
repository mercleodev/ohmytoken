// ---------------------------------------------------------------------------
// Guardrail threshold defaults (Section 14 of design doc)
// ---------------------------------------------------------------------------

// Context utilization
export const CONTEXT_WARN_PCT = 0.80;
export const CONTEXT_CRITICAL_PCT = 0.90;
export const STEEP_GROWTH_PCT = 0.08;

// Session length
export const LONG_SESSION_TURNS = 12;
export const VERY_LONG_SESSION_TURNS = 20;

// Cache ratios
export const CACHE_WARNING_PCT = 0.85;
export const CACHE_CRITICAL_PCT = 0.95;
export const CACHE_MIN_TURNS = 4; // Early turns have high cache read from system prompt — skip

// Output efficiency
export const LOW_OUTPUT_RATIO = 0.01;

// MCP thresholds
export const MCP_OVERUSE_RATIO = 0.60;
export const MCP_OVERUSE_CALLS = 10;
export const MCP_LARGE_RESULT_AVG_TOKENS = 2000;

// Injected files
export const LOW_VALUE_INJECTED_SHARE = 0.20;

// Compaction
export const COMPACTION_THRASH_COUNT = 2;
export const COMPACTION_DROP_PCT = 0.20;

// ---------------------------------------------------------------------------
// Model context limits — centralized mapping
// Replaces scattered hardcoded values in NotificationCard.tsx and scan/shared.ts
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude 4.x
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-5-20250929': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // Claude 3.x
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  // OpenAI / Codex
  'o4-mini': 200_000,
  'o3': 258_400,
  'gpt-5.3-codex': 258_400,
  'codex-mini': 200_000,
  'gpt-4o': 128_000,
  // Gemini
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
};

export const DEFAULT_CONTEXT_LIMIT = 200_000;

export function getContextLimit(model: string, observedMax?: number): number {
  const staticLimit = MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
  // Auto-promote: if observed tokens exceed the static limit, bump to next tier
  if (observedMax && observedMax > staticLimit) {
    if (observedMax > 500_000) return 1_000_000;
    if (observedMax > 200_000) return 500_000;
  }
  return staticLimit;
}

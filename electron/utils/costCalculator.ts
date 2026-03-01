/**
 * Shared cost calculation for AI provider API usage.
 * Supports Claude (Anthropic) and Codex/OpenAI models.
 * Used by main.ts (proxy + history detail), historyImporter, and backfill parsers.
 */

/**
 * Calculate cost for Claude (Anthropic) models.
 * input_tokens from API is the non-cached portion (cache miss).
 */
export const calculateCost = (
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number,
): number => {
  // Pricing per 1M tokens (USD)
  const isOpus = model.includes("opus");
  const isHaiku = model.includes("haiku");
  const inputRate = isOpus ? 15 : isHaiku ? 0.8 : 3;
  const outputRate = isOpus ? 75 : isHaiku ? 4 : 15;
  const cacheReadRate = isOpus ? 1.5 : isHaiku ? 0.08 : 0.3;
  const cacheCreateRate = isOpus ? 18.75 : isHaiku ? 1 : 3.75;
  // Do NOT subtract cacheRead/cacheCreation — that would produce negative costs
  return (
    (input / 1_000_000) * inputRate +
    (output / 1_000_000) * outputRate +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheCreation / 1_000_000) * cacheCreateRate
  );
};

/**
 * Calculate cost for Codex / OpenAI models.
 * Codex is subscription-based — costs shown are API-equivalent estimates.
 *
 * Codex input_tokens INCLUDES cached portion, so we subtract cached
 * to get non-cached input for pricing.
 */
export const calculateCodexCost = (
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
): number => {
  // OpenAI pricing per 1M tokens (USD) — as of 2026-02
  const isO4Mini = model.includes("o4-mini");
  const inputRate = isO4Mini ? 0.4 : 2; // o3/gpt-5 default
  const outputRate = isO4Mini ? 1.6 : 8;
  const cachedRate = isO4Mini ? 0.1 : 0.5;

  // Clamp cached tokens: upstream delta can be negative after Codex context compaction
  const safeCached = Math.max(0, cachedInputTokens);
  const nonCachedInput = Math.max(0, inputTokens - safeCached);
  return (
    (nonCachedInput / 1_000_000) * inputRate +
    (outputTokens / 1_000_000) * outputRate +
    (safeCached / 1_000_000) * cachedRate
  );
};

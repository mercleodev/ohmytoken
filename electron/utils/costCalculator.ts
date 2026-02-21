/**
 * Shared cost calculation for Claude API usage.
 * Used by main.ts (proxy + history detail) and historyImporter (batch import).
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
  // input_tokens from API is already the non-cached portion (cache miss)
  // Do NOT subtract cacheRead/cacheCreation — that would produce negative costs
  return (
    (input / 1_000_000) * inputRate +
    (output / 1_000_000) * outputRate +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheCreation / 1_000_000) * cacheCreateRate
  );
};

import { ModelPricing } from './types';

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6-20250514': {
    input_per_1m: 15.0,
    output_per_1m: 75.0,
    cache_create_per_1m: 18.75,
    cache_read_per_1m: 1.5,
  },
  'claude-sonnet-4-5-20250929': {
    input_per_1m: 3.0,
    output_per_1m: 15.0,
    cache_create_per_1m: 3.75,
    cache_read_per_1m: 0.3,
  },
  'claude-haiku-4-5-20251001': {
    input_per_1m: 0.8,
    output_per_1m: 4.0,
    cache_create_per_1m: 1.0,
    cache_read_per_1m: 0.08,
  },
  'claude-sonnet-4-5-20250514': {
    input_per_1m: 3.0,
    output_per_1m: 15.0,
    cache_create_per_1m: 3.75,
    cache_read_per_1m: 0.3,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  input_per_1m: 3.0,
  output_per_1m: 15.0,
  cache_create_per_1m: 3.75,
  cache_read_per_1m: 0.3,
};

const getPricing = (model: string): ModelPricing => {
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Match by keyword in model name
  if (model.includes('opus')) {
    return MODEL_PRICING['claude-opus-4-6-20250514'];
  }
  if (model.includes('haiku')) {
    return MODEL_PRICING['claude-haiku-4-5-20251001'];
  }
  if (model.includes('sonnet')) {
    return MODEL_PRICING['claude-sonnet-4-5-20250929'];
  }

  return DEFAULT_PRICING;
};

export const calculateCost = (
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number
): number => {
  const pricing = getPricing(model);

  const inputCost = (inputTokens / 1_000_000) * pricing.input_per_1m;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_per_1m;
  const cacheCreateCost = (cacheCreationTokens / 1_000_000) * pricing.cache_create_per_1m;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cache_read_per_1m;

  return inputCost + outputCost + cacheCreateCost + cacheReadCost;
};

/**
 * Evidence Engine Configuration — defaults, validation, and merge logic.
 *
 * All numeric defaults are derived from referenced papers.
 * Users can override via Store (JSON config).
 */

import type { EvidenceEngineConfig, SignalConfig } from './types';

const ENGINE_VERSION = '1.0.0';

const defaultSignal = (
  signalId: string,
  weight: number,
  params: Record<string, number | string | boolean> = {},
): SignalConfig => ({
  signalId,
  enabled: true,
  weight,
  params,
});

export const DEFAULT_ENGINE_CONFIG: EvidenceEngineConfig = {
  version: ENGINE_VERSION,
  enabled: true,

  signals: {
    'category-prior': defaultSignal('category-prior', 1.0, {
      prior_global: 25,
      prior_project: 50,
      prior_rules: 45,
      prior_memory: 25,
      prior_skill: 10,
      max_score: 30,
    }),
    'text-overlap': defaultSignal('text-overlap', 1.0, {
      k: 128,
      ngram_size: 3,
      max_score: 25,
    }),
    'instruction-compliance': defaultSignal('instruction-compliance', 1.0, {
      max_score: 20,
    }),
    'tool-reference': defaultSignal('tool-reference', 1.0, {
      direct_score: 15,
      indirect_scale: 0.53,
      max_score: 15,
    }),
    'position-effect': defaultSignal('position-effect', 1.0, {
      max_score: 5,
      primacy_score: 5,
      recency_score: 5,
      middle_score: 1,
      edge_ratio: 0.2,
    }),
    'token-proportion': defaultSignal('token-proportion', 1.0, {
      multiplier: 50,
      max_score: 5,
    }),
    'session-history': defaultSignal('session-history', 1.0, {
      decay_factor: 0.8,
      max_bonus: 10,
    }),
  },

  fusion_method: 'weighted_sum',

  thresholds: {
    confirmed_min: 0.45,
    likely_min: 0.2,
  },
};

/**
 * Validate and clamp a single param against its bounds.
 */
export const clampNumber = (value: number, min?: number, max?: number): number => {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
};

/**
 * Deep-merge user config over defaults, preserving unset fields.
 */
export const mergeConfig = (
  userConfig?: Partial<EvidenceEngineConfig>,
): EvidenceEngineConfig => {
  if (!userConfig) return { ...DEFAULT_ENGINE_CONFIG };

  const merged: EvidenceEngineConfig = {
    version: userConfig.version ?? DEFAULT_ENGINE_CONFIG.version,
    enabled: userConfig.enabled ?? DEFAULT_ENGINE_CONFIG.enabled,
    fusion_method: userConfig.fusion_method ?? DEFAULT_ENGINE_CONFIG.fusion_method,
    thresholds: {
      confirmed_min:
        userConfig.thresholds?.confirmed_min ??
        DEFAULT_ENGINE_CONFIG.thresholds.confirmed_min,
      likely_min:
        userConfig.thresholds?.likely_min ??
        DEFAULT_ENGINE_CONFIG.thresholds.likely_min,
    },
    signals: { ...DEFAULT_ENGINE_CONFIG.signals },
  };

  // Merge each signal config
  if (userConfig.signals) {
    for (const [id, userSignal] of Object.entries(userConfig.signals)) {
      const base = DEFAULT_ENGINE_CONFIG.signals[id];
      if (!base) {
        // Unknown signal from user config — preserve as-is
        merged.signals[id] = userSignal;
        continue;
      }
      merged.signals[id] = {
        signalId: id,
        enabled: userSignal.enabled ?? base.enabled,
        weight: userSignal.weight ?? base.weight,
        params: { ...base.params, ...userSignal.params },
      };
    }
  }

  return merged;
};

/**
 * Validate thresholds: confirmed_min must be > likely_min, both in [0, 1].
 */
export const validateConfig = (
  config: EvidenceEngineConfig,
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  const { confirmed_min, likely_min } = config.thresholds;
  if (confirmed_min < 0 || confirmed_min > 1) {
    errors.push(`confirmed_min must be in [0, 1], got ${confirmed_min}`);
  }
  if (likely_min < 0 || likely_min > 1) {
    errors.push(`likely_min must be in [0, 1], got ${likely_min}`);
  }
  if (confirmed_min <= likely_min) {
    errors.push(
      `confirmed_min (${confirmed_min}) must be > likely_min (${likely_min})`,
    );
  }

  for (const [id, sc] of Object.entries(config.signals)) {
    if (sc.weight < 0 || sc.weight > 1) {
      errors.push(`Signal "${id}" weight must be in [0, 1], got ${sc.weight}`);
    }
  }

  return { valid: errors.length === 0, errors };
};

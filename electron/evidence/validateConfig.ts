import type { EvidenceEngineConfig } from './types';

type ValidationResult = { ok: true } | { ok: false; error: string };

// Nested-partial so callers can validate just a subset of thresholds without
// having to supply every field. Future threshold additions stay non-breaking
// for partial validators (e.g. settings UI previewing a single edit).
type ValidatableConfig = Omit<Partial<EvidenceEngineConfig>, 'thresholds'> & {
  thresholds?: Partial<EvidenceEngineConfig['thresholds']>;
};

export function validateEvidenceConfig(config: ValidatableConfig): ValidationResult {
  if (config.signals) {
    for (const [id, signal] of Object.entries(config.signals)) {
      if (typeof signal.weight === 'number') {
        if (signal.weight < 0 || signal.weight > 1) {
          return { ok: false, error: `Signal '${id}' weight must be in [0, 1], got ${signal.weight}` };
        }
      }
    }
  }

  if (config.thresholds) {
    const { confirmed_min_raw, likely_min_raw } = config.thresholds;
    if (typeof confirmed_min_raw === 'number' && typeof likely_min_raw === 'number') {
      if (confirmed_min_raw < likely_min_raw) {
        return {
          ok: false,
          error: `confirmed_min_raw (${confirmed_min_raw}) must be >= likely_min_raw (${likely_min_raw})`,
        };
      }
    }
  }

  return { ok: true };
}

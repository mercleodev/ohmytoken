import type { EvidenceEngineConfig } from './types';

type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateEvidenceConfig(config: Partial<EvidenceEngineConfig>): ValidationResult {
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
    const { confirmed_min, likely_min } = config.thresholds;
    if (typeof confirmed_min === 'number' && typeof likely_min === 'number') {
      if (confirmed_min < likely_min) {
        return {
          ok: false,
          error: `confirmed_min (${confirmed_min}) must be >= likely_min (${likely_min})`,
        };
      }
    }
  }

  return { ok: true };
}

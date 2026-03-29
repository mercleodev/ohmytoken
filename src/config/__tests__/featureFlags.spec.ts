import { describe, it, expect } from 'vitest';
import { FEATURE_FLAGS } from '../featureFlags';

describe('FEATURE_FLAGS', () => {
  it('exposes GUARDRAILS flag', () => {
    expect(typeof FEATURE_FLAGS.GUARDRAILS).toBe('boolean');
  });

  it('GUARDRAILS is true in dev mode', () => {
    // vitest runs in dev-like mode (import.meta.env.DEV = true)
    expect(FEATURE_FLAGS.GUARDRAILS).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { validateEvidenceConfig } from '../validateConfig';

describe('validateEvidenceConfig', () => {
  it('accepts a valid config', () => {
    const result = validateEvidenceConfig({
      signals: {
        toolLoop: { signalId: 'toolLoop', enabled: true, weight: 0.8, params: {} },
      },
      thresholds: { confirmed_min: 0.8, likely_min: 0.5 },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts weight = 0', () => {
    expect(validateEvidenceConfig({ signals: { s: { signalId: 's', enabled: true, weight: 0, params: {} } } }).ok).toBe(true);
  });

  it('accepts weight = 1', () => {
    expect(validateEvidenceConfig({ signals: { s: { signalId: 's', enabled: true, weight: 1, params: {} } } }).ok).toBe(true);
  });

  it('rejects negative weight (EVIDENCE-BUG-001)', () => {
    const result = validateEvidenceConfig({
      signals: { bad: { signalId: 'bad', enabled: true, weight: -1, params: {} } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/weight/);
  });

  it('rejects weight > 1', () => {
    const result = validateEvidenceConfig({
      signals: { bad: { signalId: 'bad', enabled: true, weight: 1.5, params: {} } },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects confirmed_min < likely_min (EVIDENCE-BUG-002)', () => {
    const result = validateEvidenceConfig({
      thresholds: { confirmed_min: 0.3, likely_min: 0.7 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/confirmed_min/);
  });

  it('accepts confirmed_min === likely_min', () => {
    expect(validateEvidenceConfig({ thresholds: { confirmed_min: 0.5, likely_min: 0.5 } }).ok).toBe(true);
  });

  it('accepts partial config with only signals', () => {
    expect(validateEvidenceConfig({ signals: {} }).ok).toBe(true);
  });

  it('accepts partial config with only thresholds', () => {
    expect(validateEvidenceConfig({ thresholds: { confirmed_min: 0.9, likely_min: 0.4 } }).ok).toBe(true);
  });

  it('accepts empty partial config', () => {
    expect(validateEvidenceConfig({}).ok).toBe(true);
  });
});

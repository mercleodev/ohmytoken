import type { GuardrailAssessment } from '../../../guardrails/types';

// ── Visibility ──

export const shouldShowGuardrailSummary = (
  assessment: GuardrailAssessment | undefined,
): boolean => {
  if (!assessment) return false;
  if (assessment.primary) return true;
  if (assessment.summary.sessionHealth !== 'healthy') return true;
  return false;
};

// ── Health styling ──

type HealthStyle = { color: string; label: string; bg: string };

const HEALTH_STYLES: Record<GuardrailAssessment['summary']['sessionHealth'], HealthStyle> = {
  healthy: { color: '#30D158', label: 'Healthy', bg: 'rgba(48, 209, 88, 0.1)' },
  watch: { color: '#FF9500', label: 'Watch', bg: 'rgba(255, 149, 0, 0.1)' },
  risky: { color: '#FF3B30', label: 'Risky', bg: 'rgba(255, 59, 48, 0.1)' },
};

export const getHealthStyle = (
  health: GuardrailAssessment['summary']['sessionHealth'],
): HealthStyle => HEALTH_STYLES[health];

// ── Evidence formatting ──

const MAX_EVIDENCE_BULLETS = 5;

export const formatEvidenceBullets = (evidence: string[]): string[] =>
  evidence.slice(0, MAX_EVIDENCE_BULLETS);

// ── Low-value file summary ──

type LowValueSummary = { tokens: number; note: string };

export const getLowValueFileSummary = (
  assessment: GuardrailAssessment | undefined,
): LowValueSummary[] => {
  if (!assessment) return [];

  const rec = assessment.all.find((r) => r.id === 'low-value-injected-files');
  if (!rec?.estimatedSavings) return [];

  return [{
    tokens: rec.estimatedSavings.tokens ?? 0,
    note: rec.estimatedSavings.note,
  }];
};

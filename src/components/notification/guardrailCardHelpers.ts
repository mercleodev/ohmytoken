import type { GuardrailSeverity, GuardrailAssessment, GuardrailRecommendation } from '../../guardrails/types';

// ── Severity styling ──

const SEVERITY_COLORS: Record<GuardrailSeverity, string> = {
  info: '#007AFF',
  warning: '#FF9500',
  critical: '#FF3B30',
};

const SEVERITY_ICONS: Record<GuardrailSeverity, string> = {
  info: 'ℹ',
  warning: '⚠',
  critical: '🔴',
};

export const getSeverityColor = (severity: GuardrailSeverity): string =>
  SEVERITY_COLORS[severity];

export const getSeverityIcon = (severity: GuardrailSeverity): string =>
  SEVERITY_ICONS[severity];

// ── Savings formatting ──

const formatTokensShort = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
};

export const formatSavings = (
  savings: GuardrailRecommendation['estimatedSavings'],
): string | null => {
  if (!savings) return null;

  const parts: string[] = [];
  if (savings.tokens != null) parts.push(`~${formatTokensShort(savings.tokens)} tok`);
  if (savings.costUsd != null) parts.push(`~$${savings.costUsd.toFixed(3)}`);

  const prefix = parts.length > 0 ? parts.join(' / ') + ' — ' : '';
  return prefix + savings.note;
};

// ── Visible recommendations ──

const MAX_SECONDARY_VISIBLE = 2;

export const getVisibleRecommendations = (
  assessment: GuardrailAssessment | undefined,
): { primary: GuardrailRecommendation | null; secondary: GuardrailRecommendation[] } => {
  if (!assessment) return { primary: null, secondary: [] };

  return {
    primary: assessment.primary,
    secondary: assessment.secondary.slice(0, MAX_SECONDARY_VISIBLE),
  };
};

// ── Health label ──

const HEALTH_LABELS: Record<GuardrailAssessment['summary']['sessionHealth'], string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  risky: 'Risky',
};

export const getHealthLabel = (
  assessment: GuardrailAssessment | undefined,
): string | null => {
  if (!assessment) return null;
  return HEALTH_LABELS[assessment.summary.sessionHealth];
};

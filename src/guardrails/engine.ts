import type {
  GuardrailContext,
  GuardrailRule,
  GuardrailAssessment,
  GuardrailRecommendation,
  GuardrailSeverity,
} from './types';

// ---------------------------------------------------------------------------
// Severity ordering for ranking
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<GuardrailSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

// ---------------------------------------------------------------------------
// Ranking comparator: severity → confidence → rule array order (tiebreaker)
// ---------------------------------------------------------------------------

function rankRecommendations(recs: GuardrailRecommendation[]): GuardrailRecommendation[] {
  return [...recs].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });
}

// ---------------------------------------------------------------------------
// Session health derivation
// ---------------------------------------------------------------------------

function deriveHealth(recs: GuardrailRecommendation[]): 'healthy' | 'watch' | 'risky' {
  if (recs.length === 0) return 'healthy';
  const hasCritical = recs.some((r) => r.severity === 'critical');
  if (hasCritical) return 'risky';
  return 'watch';
}

// ---------------------------------------------------------------------------
// Engine entry point
// ---------------------------------------------------------------------------

const MAX_SECONDARY = 2;

export function evaluate(
  ctx: GuardrailContext,
  rules: GuardrailRule[],
): GuardrailAssessment {
  const all: GuardrailRecommendation[] = [];

  for (const rule of rules) {
    const rec = rule.evaluate(ctx);
    if (rec) all.push(rec);
  }

  const ranked = rankRecommendations(all);
  const primary = ranked.length > 0 ? ranked[0] : null;
  const secondary = ranked.slice(1, 1 + MAX_SECONDARY);

  return {
    generatedAt: new Date().toISOString(),
    primary,
    secondary,
    all: ranked,
    summary: {
      sessionHealth: deriveHealth(ranked),
      topRiskIds: ranked.map((r) => r.id),
    },
  };
}

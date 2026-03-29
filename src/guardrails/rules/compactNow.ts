import type { GuardrailRule, GuardrailContext, GuardrailRecommendation } from '../types';
import { CONTEXT_WARN_PCT, CONTEXT_CRITICAL_PCT, STEEP_GROWTH_PCT } from '../constants';

/**
 * compact-now: fires when context is approaching the model limit.
 *
 * Trigger:
 *  - current context >= 80% of model limit
 *  - OR last-turn growth >= 8% of model limit
 *  - OR projected next turn would exceed 90%
 */
export const compactNowRule: GuardrailRule = {
  id: 'compact-now',
  evaluate(ctx: GuardrailContext): GuardrailRecommendation | null {
    const { contextLimit, turnMetrics } = ctx;
    const { currentContextPct, currentContextTokens } = ctx.derived;
    const len = turnMetrics.length;

    if (len === 0 || contextLimit === 0) return null;

    // Growth between last two turns
    let growthPct = 0;
    if (len >= 2) {
      const prev = turnMetrics[len - 2].total_context_tokens;
      const curr = turnMetrics[len - 1].total_context_tokens;
      growthPct = prev > 0 ? (curr - prev) / contextLimit : 0;
    }

    // Projected next turn
    const projectedPct = currentContextPct + growthPct;

    const shouldFire =
      currentContextPct >= CONTEXT_WARN_PCT ||
      growthPct >= STEEP_GROWTH_PCT ||
      projectedPct >= CONTEXT_CRITICAL_PCT;

    if (!shouldFire) return null;

    // Dynamic confidence
    let confidence = 0.50;
    if (currentContextPct >= CONTEXT_CRITICAL_PCT) confidence = 0.85;
    else if (currentContextPct >= 0.85) confidence = 0.70;
    else if (currentContextPct >= CONTEXT_WARN_PCT) confidence = 0.60;

    if (growthPct >= STEEP_GROWTH_PCT) confidence = Math.min(confidence + 0.10, 1.0);
    if (projectedPct >= CONTEXT_CRITICAL_PCT) confidence = Math.min(confidence + 0.05, 1.0);

    const severity = currentContextPct >= CONTEXT_CRITICAL_PCT ? 'critical' as const : 'warning' as const;

    const evidence: string[] = [];
    evidence.push(`Context at ${(currentContextPct * 100).toFixed(0)}% of ${(contextLimit / 1000).toFixed(0)}K limit`);
    if (growthPct >= STEEP_GROWTH_PCT) {
      evidence.push(`Last turn grew ${(growthPct * 100).toFixed(1)}% of context limit`);
    }
    if (projectedPct >= CONTEXT_CRITICAL_PCT && currentContextPct < CONTEXT_CRITICAL_PCT) {
      evidence.push(`Projected next turn: ${(projectedPct * 100).toFixed(0)}% — approaching critical zone`);
    }

    return {
      id: 'compact-now',
      severity,
      title: 'Compact Soon',
      reason: 'Context is approaching the model limit and recent growth is steep.',
      action: 'Run /compact after the current response or before the next exploratory turn.',
      confidence,
      evidence,
      estimatedSavings: {
        note: `Current context: ${(currentContextTokens / 1000).toFixed(0)}K tokens. Compacting typically reclaims 40-60% of context.`,
      },
    };
  },
};

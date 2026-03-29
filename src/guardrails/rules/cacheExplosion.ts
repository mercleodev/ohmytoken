import type { GuardrailRule, GuardrailContext, GuardrailRecommendation } from '../types';
import { CACHE_WARNING_PCT, CACHE_CRITICAL_PCT } from '../constants';

/**
 * cache-explosion: fires when cache read dominates total tokens.
 *
 * Trigger:
 *  - sessionCacheReadPct >= 85% (warning)
 *  - sessionCacheReadPct >= 95% (critical)
 */
export const cacheExplosionRule: GuardrailRule = {
  id: 'cache-explosion',
  evaluate(ctx: GuardrailContext): GuardrailRecommendation | null {
    const { sessionCacheReadPct, turnCount } = ctx.derived;
    const { turnMetrics } = ctx;

    if (sessionCacheReadPct < CACHE_WARNING_PCT) return null;

    // Dynamic confidence
    let confidence = 0.70;
    if (sessionCacheReadPct >= CACHE_CRITICAL_PCT) confidence = 0.90;

    // Bonus: check if cache read trend is rising over last 3 turns
    if (turnMetrics.length >= 3) {
      const last3 = turnMetrics.slice(-3);
      const ratios = last3.map((t) => {
        const total = t.cache_read_tokens + t.cache_create_tokens + t.input_tokens + t.output_tokens;
        return total > 0 ? t.cache_read_tokens / total : 0;
      });
      const isRising = ratios.length >= 2 && ratios[ratios.length - 1] > ratios[0];
      if (isRising) confidence = Math.min(confidence + 0.05, 1.0);
    }

    const severity = sessionCacheReadPct >= CACHE_CRITICAL_PCT ? 'critical' as const : 'warning' as const;

    const evidence: string[] = [];
    evidence.push(`Cache read is ${(sessionCacheReadPct * 100).toFixed(0)}% of total session tokens`);
    if (turnCount > 0) {
      evidence.push(`Over ${turnCount} turns`);
    }

    return {
      id: 'cache-explosion',
      severity,
      title: 'Cache Read Is Dominating',
      reason: 'Most tokens are going into rereading previous context rather than producing new work.',
      action: 'Do not continue the same thread. Compact or move the next step into a clean session.',
      confidence,
      evidence,
      estimatedSavings: {
        note: 'Reducing the next 5 turns into a new session can cut cache read dramatically.',
      },
    };
  },
};

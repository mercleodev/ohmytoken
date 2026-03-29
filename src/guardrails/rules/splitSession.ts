import type { GuardrailRule, GuardrailContext, GuardrailRecommendation } from '../types';
import { LONG_SESSION_TURNS, VERY_LONG_SESSION_TURNS, CACHE_WARNING_PCT } from '../constants';

/**
 * split-session: fires when session is long and cache-heavy.
 *
 * Trigger:
 *  - turnCount >= 12 AND sessionCacheReadPct >= 70%
 *  - OR turnCount >= 20 regardless of cache ratio
 */
const CACHE_SPLIT_PCT = 0.70;

export const splitSessionRule: GuardrailRule = {
  id: 'split-session',
  evaluate(ctx: GuardrailContext): GuardrailRecommendation | null {
    const { turnCount, sessionCacheReadPct, sessionCostUsd } = ctx.derived;

    const longAndCacheHeavy = turnCount >= LONG_SESSION_TURNS && sessionCacheReadPct >= CACHE_SPLIT_PCT;
    const veryLong = turnCount >= VERY_LONG_SESSION_TURNS;

    if (!longAndCacheHeavy && !veryLong) return null;

    // Dynamic confidence
    let confidence = 0.50;
    if (veryLong) confidence = 0.80;
    else if (longAndCacheHeavy) confidence = 0.60;

    if (sessionCacheReadPct >= CACHE_WARNING_PCT) confidence = Math.min(confidence + 0.10, 1.0);

    const severity = veryLong ? 'warning' as const : 'info' as const;

    const evidence: string[] = [];
    evidence.push(`Session is ${turnCount} turns long`);
    evidence.push(`Cache read is ${(sessionCacheReadPct * 100).toFixed(0)}% of total tokens`);
    if (sessionCostUsd > 0) {
      evidence.push(`Session cost so far: $${sessionCostUsd.toFixed(2)}`);
    }

    return {
      id: 'split-session',
      severity,
      title: 'Split The Session',
      reason: 'The current thread is long enough that previous context is becoming the main cost driver.',
      action: 'Finish this task, summarize the outcome, and start the next subtask in a fresh session.',
      confidence,
      evidence,
      estimatedSavings: {
        note: 'Starting a fresh session typically reduces cache read significantly.',
      },
    };
  },
};

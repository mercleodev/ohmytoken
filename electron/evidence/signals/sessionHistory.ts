/**
 * Signal 7: Session History
 *
 * Bonus based on how this file was scored in previous requests within the session.
 * bonus = min(avg_prev_scores × decay_factor, max_bonus)
 *
 * Papers:
 *   Xu et al. (2022) "Beyond Goldfish Memory: Long-Term Open-Domain Conversation" ACL
 *   Maharana et al. (2024) "LoCoMo" arXiv:2402.17753
 */

import type { SignalPlugin } from './types';

export const sessionHistorySignal: SignalPlugin = {
  id: 'session-history',
  name: 'Session History',
  version: '1.0.0',
  papers: [
    {
      authors: 'Xu et al.',
      title: 'Beyond Goldfish Memory: Long-Term Open-Domain Conversation',
      venue: 'ACL',
      year: 2022,
    },
    {
      authors: 'Maharana et al.',
      title: 'LoCoMo: Long-Context Conversation Understanding with LLMs',
      venue: 'arXiv',
      year: 2024,
      identifier: 'arXiv:2402.17753',
    },
  ],
  paramDefs: [
    { key: 'decay_factor', description: 'Exponential decay applied to historical avg', type: 'number', default: 0.8, min: 0, max: 1 },
    { key: 'max_bonus', description: 'Maximum bonus score', type: 'number', default: 10, min: 0, max: 20 },
  ],
  maxScore: 10,

  compute(input, params) {
    const decayFactor = Number(params.decay_factor ?? 0.8);
    const maxBonus = Number(params.max_bonus ?? 10);

    const prev = input.previousScores;

    if (!prev || prev.length === 0) {
      return {
        signalId: this.id,
        score: 0,
        maxScore: maxBonus,
        confidence: 0,
        detail: 'No previous scores in session',
      };
    }

    const avg = prev.reduce((sum, s) => sum + s, 0) / prev.length;
    const bonus = Math.min(avg * decayFactor, maxBonus);

    return {
      signalId: this.id,
      score: Math.round(bonus * 100) / 100,
      maxScore: maxBonus,
      confidence: Math.min(prev.length / 5, 1), // More history = more confident
      detail: `avg(${prev.length} prev)=${avg.toFixed(1)} × ${decayFactor} → bonus ${bonus.toFixed(1)}/${maxBonus}`,
    };
  },
};

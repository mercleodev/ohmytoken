/**
 * Signal 5: Position Effect
 *
 * U-curve scoring based on serial position in the system prompt.
 * Primacy (first 20%) and recency (last 20%) regions get higher scores.
 *
 * Papers:
 *   Liu et al. (2023) "Lost in the Middle" arXiv:2307.03172
 *   Murdock (1962) "The serial position effect of free recall" JEP
 */

import type { SignalPlugin } from './types';

export const positionEffectSignal: SignalPlugin = {
  id: 'position-effect',
  name: 'Position Effect',
  version: '1.0.0',
  papers: [
    {
      authors: 'Liu et al.',
      title: 'Lost in the Middle: How Language Models Use Long Contexts',
      venue: 'TACL',
      year: 2023,
      identifier: 'arXiv:2307.03172',
    },
    {
      authors: 'Murdock',
      title: 'The serial position effect of free recall',
      venue: 'Journal of Experimental Psychology',
      year: 1962,
    },
  ],
  paramDefs: [
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 5, min: 0, max: 20 },
    { key: 'primacy_score', description: 'Score for primacy region', type: 'number', default: 5, min: 0, max: 20 },
    { key: 'recency_score', description: 'Score for recency region', type: 'number', default: 5, min: 0, max: 20 },
    { key: 'middle_score', description: 'Score for middle region', type: 'number', default: 1, min: 0, max: 20 },
    { key: 'edge_ratio', description: 'Fraction of items at each edge', type: 'number', default: 0.2, min: 0.05, max: 0.5 },
  ],
  maxScore: 5,

  compute(input, params) {
    const maxScore = Number(params.max_score ?? 5);
    const primacyScore = Number(params.primacy_score ?? 5);
    const recencyScore = Number(params.recency_score ?? 5);
    const middleScore = Number(params.middle_score ?? 1);
    const edgeRatio = Number(params.edge_ratio ?? 0.2);

    const { index, total } = input.position;

    if (total <= 0) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'No files in context',
      };
    }

    if (total === 1) {
      // Single file gets max primacy score
      return {
        signalId: this.id,
        score: Math.min(primacyScore, maxScore),
        maxScore,
        confidence: 1,
        detail: 'Single file in context → primacy',
      };
    }

    // Normalized position in [0, 1]
    const normalizedPos = index / (total - 1);
    const primacyBound = edgeRatio;
    const recencyBound = 1 - edgeRatio;

    let score: number;
    let region: string;

    if (normalizedPos <= primacyBound) {
      score = primacyScore;
      region = 'primacy';
    } else if (normalizedPos >= recencyBound) {
      score = recencyScore;
      region = 'recency';
    } else {
      score = middleScore;
      region = 'middle';
    }

    score = Math.min(score, maxScore);

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: score / maxScore,
      detail: `Position ${index + 1}/${total} (${(normalizedPos * 100).toFixed(0)}%) → ${region} region → ${score}/${maxScore}`,
    };
  },
};

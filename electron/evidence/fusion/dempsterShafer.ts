/**
 * Dempster-Shafer Fusion — alternative evidence combination strategy.
 *
 * Uses Dempster's combination rule for combining independent evidence.
 * Each signal's confidence is treated as a basic probability assignment (BPA).
 *
 * Papers:
 *   Dempster (1967) "Upper and Lower Probabilities Induced by a Multivalued Mapping"
 *   Shafer (1976) "A Mathematical Theory of Evidence"
 */

import type { FusionStrategy } from './types';

/**
 * Basic Probability Assignment for a signal.
 * belief: probability that the file is genuinely relevant
 * disbelief: probability that the file is not relevant
 * uncertainty: remaining probability mass
 */
type BPA = {
  belief: number;
  disbelief: number;
  uncertainty: number;
};

/**
 * Convert a signal's normalized score (score/maxScore) and confidence
 * into a BPA (Basic Probability Assignment).
 */
const signalToBpa = (score: number, maxScore: number, weight: number): BPA => {
  if (maxScore === 0) return { belief: 0, disbelief: 0, uncertainty: 1 };

  const normalized = score / maxScore;
  // Weight scales how much of the probability mass is assigned (vs uncertain)
  const assigned = Math.min(weight, 1);

  return {
    belief: normalized * assigned,
    disbelief: (1 - normalized) * assigned * 0.5, // Conservative disbelief
    uncertainty: 1 - normalized * assigned - (1 - normalized) * assigned * 0.5,
  };
};

/**
 * Dempster's combination rule for two BPAs.
 */
const combineBpa = (a: BPA, b: BPA): BPA => {
  // Compute conflict
  const conflict = a.belief * b.disbelief + a.disbelief * b.belief;
  const normFactor = 1 - conflict;

  if (normFactor <= 0) {
    // Total conflict — return maximum uncertainty
    return { belief: 0, disbelief: 0, uncertainty: 1 };
  }

  const belief =
    (a.belief * b.belief +
      a.belief * b.uncertainty +
      a.uncertainty * b.belief) /
    normFactor;

  const disbelief =
    (a.disbelief * b.disbelief +
      a.disbelief * b.uncertainty +
      a.uncertainty * b.disbelief) /
    normFactor;

  const uncertainty =
    (a.uncertainty * b.uncertainty) / normFactor;

  return { belief, disbelief, uncertainty };
};

export const dempsterShaferFusion: FusionStrategy = {
  id: 'dempster_shafer',
  name: 'Dempster-Shafer',
  papers: [
    {
      authors: 'Dempster',
      title: 'Upper and Lower Probabilities Induced by a Multivalued Mapping',
      venue: 'The Annals of Mathematical Statistics',
      year: 1967,
    },
    {
      authors: 'Shafer',
      title: 'A Mathematical Theory of Evidence',
      venue: 'Princeton University Press',
      year: 1976,
    },
  ],

  combine({ signals, weights }) {
    if (signals.length === 0) {
      return { rawScore: 0, normalizedScore: 0, method: 'dempster_shafer' };
    }

    // Convert each signal to a BPA
    const bpas = signals.map((s) =>
      signalToBpa(s.score, s.maxScore, weights[s.signalId] ?? 1),
    );

    // Combine all BPAs using Dempster's rule
    let combined = bpas[0];
    for (let i = 1; i < bpas.length; i++) {
      combined = combineBpa(combined, bpas[i]);
    }

    // Raw score: sum of weighted scores (for display)
    let rawScore = 0;
    for (const s of signals) {
      rawScore += s.score * (weights[s.signalId] ?? 1);
    }

    return {
      rawScore: Math.round(rawScore * 100) / 100,
      normalizedScore: Math.round(combined.belief * 1000) / 1000,
      method: 'dempster_shafer',
    };
  },
};

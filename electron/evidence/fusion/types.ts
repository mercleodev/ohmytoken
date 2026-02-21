/**
 * FusionStrategy interface — combines multiple signal scores into a final score.
 */

import type { PaperReference, SignalResult } from '../types';
import type { SignalConfig } from '../types';

export type FusionInput = {
  signals: SignalResult[];
  weights: Record<string, number>; // signalId → weight
};

export type FusionOutput = {
  rawScore: number;
  normalizedScore: number; // 0..1
  method: string;
};

export type FusionStrategy = {
  id: string;
  name: string;
  papers: PaperReference[];
  combine: (input: FusionInput) => FusionOutput;
};

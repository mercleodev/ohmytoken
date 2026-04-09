import type { GuardrailRule } from '../types';
import { compactNowRule } from './compactNow';
import { toolLoopRule } from './toolLoop';
import { splitSessionRule } from './splitSession';
import { cacheExplosionRule } from './cacheExplosion';
import { lowValueInjectedFilesRule } from './lowValueInjectedFiles';
import { harnessCandidateRule } from './harnessCandidate';

/**
 * MVP rule set — ordered by priority (used as tiebreaker in ranking).
 * See design doc Section 7.4 for priority rationale.
 */
export const MVP_RULES: GuardrailRule[] = [
  compactNowRule,
  toolLoopRule,
  splitSessionRule,
  cacheExplosionRule,
  lowValueInjectedFilesRule,
  harnessCandidateRule,
];

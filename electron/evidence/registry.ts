/**
 * Signal Plugin Registry
 *
 * Central registration point for all signal plugins.
 * To add a new signal: import it and append to builtinSignals.
 */

import type { SignalPlugin } from './signals/types';
import { categoryPriorSignal } from './signals/categoryPrior';
import { tokenProportionSignal } from './signals/tokenProportion';
import { positionEffectSignal } from './signals/positionEffect';
import { toolReferenceSignal } from './signals/toolReference';
import { textOverlapSignal } from './signals/textOverlap';
import { instructionComplianceSignal } from './signals/instructionCompliance';
import { sessionHistorySignal } from './signals/sessionHistory';

/**
 * All built-in signal plugins, ordered by computational cost (cheap first).
 */
export const builtinSignals: SignalPlugin[] = [
  categoryPriorSignal,
  tokenProportionSignal,
  positionEffectSignal,
  toolReferenceSignal,
  textOverlapSignal,
  instructionComplianceSignal,
  sessionHistorySignal,
];

/**
 * Lookup a signal by id.
 */
export const getSignalById = (id: string): SignalPlugin | undefined =>
  builtinSignals.find((s) => s.id === id);

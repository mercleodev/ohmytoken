/**
 * SignalPlugin interface — every scoring signal implements this contract.
 *
 * Adding a new signal requires:
 *   1. Create a new file implementing SignalPlugin
 *   2. Register it in registry.ts
 *   3. Add default params in config.ts
 */

import type { PaperReference, ParamDef, SignalInput, SignalResult } from '../types';

export type SignalPlugin = {
  /** Unique identifier (kebab-case) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semver — bump when formula changes */
  version: string;
  /** Referenced papers (required, at least one) */
  papers: PaperReference[];
  /** Tunable parameter schema */
  paramDefs: ParamDef[];
  /** Maximum raw score this signal can produce */
  maxScore: number;
  /** Pure computation — no side effects */
  compute: (
    input: SignalInput,
    params: Record<string, number | string | boolean>,
  ) => SignalResult;
};

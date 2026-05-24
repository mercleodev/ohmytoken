/**
 * EvidenceEngine — orchestrates signal plugins and fusion strategies
 * to produce an EvidenceReport for each PromptScan.
 */

import type {
  EvidenceEngineConfig,
  EvidenceReport,
  FileEvidenceScore,
  EvidenceClassification,
  SignalInput,
  SignalResult,
  UserEvidenceConfig,
} from './types';
import type { SignalPlugin } from './signals/types';
import type { FusionStrategy } from './fusion/types';
import { builtinSignals } from './registry';
import { weightedSumFusion } from './fusion/weightedSum';
import { dempsterShaferFusion } from './fusion/dempsterShafer';
import { mergeConfig } from './config';

const ENGINE_VERSION = '1.1.0';

type ScanData = SignalInput['scan'];

type FileData = {
  path: string;
  category: 'global' | 'project' | 'rules' | 'memory' | 'skill';
  estimated_tokens: number;
  content?: string;
};

type ScoreOptions = {
  /** File contents keyed by path (from systemParser) */
  fileContents?: Record<string, string>;
  /** Previous normalized scores per file path (for session history) */
  previousScores?: Record<string, number[]>;
};

/**
 * Select the fusion strategy by id.
 */
const getFusionStrategy = (method: string): FusionStrategy => {
  if (method === 'dempster_shafer') return dempsterShaferFusion;
  return weightedSumFusion;
};

type AckVerdict = 'USED' | 'NOT_APPLICABLE' | null;

/**
 * Classify a file based on its raw score and the strongest signal it carried.
 *
 * Priority (matches code order — `!hasEvidenceSignal` short-circuits BEFORE
 * the high-compliance shortcut to preserve the #353 priors-only contract):
 *   1. USED ack token              → confirmed (LLM self-declared engagement)
 *   2. NOT_APPLICABLE ack          → likely (LLM acknowledged + judged irrelevant)
 *   3. Direct tool reference       → confirmed (Read/Edit/Write/Glob/Grep hit the file)
 *   4. No evidence signal          → unverified (priors-only — see #353)
 *   5. High instruction compliance → confirmed (#374 — assistant followed every
 *                                    rule directive even without an ack token
 *                                    or a coincidental tool basename mention)
 *   6. Raw-score thresholds        → confirmed/likely/unverified
 *
 * The raw score is used (not normalized) because the weighted-sum normalizer's
 * "active-signal-only denominator" perversely scored files with *more* evidence
 * lower than files with less. See #359.
 *
 * Exported for direct pure-function testing in classify.spec.ts.
 */
export const classify = (
  rawScore: number,
  hasEvidenceSignal: boolean,
  hasDirectToolReference: boolean,
  ackVerdict: AckVerdict,
  hasHighInstructionCompliance: boolean,
  thresholds: {
    confirmed_min_raw: number;
    likely_min_raw: number;
    high_compliance_confidence_min: number;
  },
): EvidenceClassification => {
  if (ackVerdict === 'USED') return 'confirmed';
  if (ackVerdict === 'NOT_APPLICABLE') return 'likely';
  if (hasDirectToolReference) return 'confirmed';
  if (!hasEvidenceSignal) return 'unverified';
  if (hasHighInstructionCompliance) return 'confirmed';
  if (rawScore >= thresholds.confirmed_min_raw) return 'confirmed';
  if (rawScore >= thresholds.likely_min_raw) return 'likely';
  return 'unverified';
};

export class EvidenceEngine {
  private config: EvidenceEngineConfig;
  private signals: SignalPlugin[];
  private fusion: FusionStrategy;

  constructor(userConfig?: UserEvidenceConfig) {
    this.config = mergeConfig(userConfig);
    this.signals = this.resolveSignals();
    this.fusion = getFusionStrategy(this.config.fusion_method);
  }

  private hasEvidenceSignal(signals: SignalResult[]): boolean {
    return this.signals.some(
      (plugin, i) => plugin.kind === 'evidence' && signals[i].score > 0,
    );
  }

  private hasDirectToolReference(signals: SignalResult[]): boolean {
    const ref = signals.find((s) => s.signalId === 'tool-reference');
    return ref ? ref.confidence === 1 : false;
  }

  private ackVerdict(signals: SignalResult[]): AckVerdict {
    const ack = signals.find((s) => s.signalId === 'decision-gate-ack');
    if (!ack || ack.score === 0) return null;
    return ack.confidence === 1 ? 'USED' : 'NOT_APPLICABLE';
  }

  /**
   * Issue #374: the assistant clearly followed every directive in the rule
   * file. instruction-compliance.confidence >= threshold => confirmed,
   * regardless of whether the LLM happened to name the file in tool input.
   *
   * Treats missing/NaN/undefined confidence as 0 (no promotion). The
   * compliance signal scores > 0 only when the file has at least one
   * extractable directive, so this never fires for non-rule files.
   */
  private hasHighInstructionCompliance(signals: SignalResult[]): boolean {
    const sig = signals.find((s) => s.signalId === 'instruction-compliance');
    if (!sig) return false;
    const confidence = typeof sig.confidence === 'number' && Number.isFinite(sig.confidence)
      ? sig.confidence
      : 0;
    return confidence >= this.config.thresholds.high_compliance_confidence_min;
  }

  /**
   * Filter builtin signals to only enabled ones.
   */
  private resolveSignals(): SignalPlugin[] {
    return builtinSignals.filter((s) => {
      const sc = this.config.signals[s.id];
      return sc ? sc.enabled : true;
    });
  }

  /**
   * Update configuration (e.g., after user changes settings).
   */
  updateConfig(userConfig: UserEvidenceConfig): void {
    this.config = mergeConfig(userConfig);
    this.signals = this.resolveSignals();
    this.fusion = getFusionStrategy(this.config.fusion_method);
  }

  /**
   * Get current configuration (for UI/persistence).
   */
  getConfig(): EvidenceEngineConfig {
    return { ...this.config };
  }

  /**
   * Score all injected files in a PromptScan.
   */
  score(scan: ScanData, options: ScoreOptions = {}): EvidenceReport {
    const { fileContents = {}, previousScores = {} } = options;
    const files = scan.injected_files;

    const fileScores: FileEvidenceScore[] = files.map((f, index) => {
      const fileData: FileData = {
        path: f.path,
        category: f.category as FileData['category'],
        estimated_tokens: f.estimated_tokens,
        content: fileContents[f.path],
      };

      const input: SignalInput = {
        file: fileData,
        scan,
        position: { index, total: files.length },
        previousScores: previousScores[f.path],
      };

      // Compute each enabled signal
      const signals: SignalResult[] = [];
      for (const plugin of this.signals) {
        const sc = this.config.signals[plugin.id];
        const params = sc?.params ?? {};
        const result = plugin.compute(input, params);
        signals.push(result);
      }

      // Build weight map
      const weights: Record<string, number> = {};
      for (const s of signals) {
        const sc = this.config.signals[s.signalId];
        weights[s.signalId] = sc?.weight ?? 1;
      }

      // Fuse signals
      const fused = this.fusion.combine({ signals, weights });

      return {
        filePath: f.path,
        category: f.category,
        signals,
        rawScore: fused.rawScore,
        normalizedScore: fused.normalizedScore,
        classification: classify(
          fused.rawScore,
          this.hasEvidenceSignal(signals),
          this.hasDirectToolReference(signals),
          this.ackVerdict(signals),
          this.hasHighInstructionCompliance(signals),
          this.config.thresholds,
        ),
      };
    });

    return {
      request_id: scan.request_id,
      timestamp: new Date().toISOString(),
      engine_version: ENGINE_VERSION,
      fusion_method: this.config.fusion_method,
      files: fileScores,
      thresholds: { ...this.config.thresholds },
    };
  }

  /**
   * Re-score a single file (useful for testing/debugging).
   */
  scoreFile(
    file: FileData,
    scan: ScanData,
    position: { index: number; total: number },
    previousScores?: number[],
  ): FileEvidenceScore {
    const input: SignalInput = {
      file,
      scan,
      position,
      previousScores,
    };

    const signals: SignalResult[] = [];
    for (const plugin of this.signals) {
      const sc = this.config.signals[plugin.id];
      const params = sc?.params ?? {};
      signals.push(plugin.compute(input, params));
    }

    const weights: Record<string, number> = {};
    for (const s of signals) {
      const sc = this.config.signals[s.signalId];
      weights[s.signalId] = sc?.weight ?? 1;
    }

    const fused = this.fusion.combine({ signals, weights });

    return {
      filePath: file.path,
      category: file.category,
      signals,
      rawScore: fused.rawScore,
      normalizedScore: fused.normalizedScore,
      classification: classify(
        fused.rawScore,
        this.hasEvidenceSignal(signals),
        this.hasDirectToolReference(signals),
        this.ackVerdict(signals),
        this.hasHighInstructionCompliance(signals),
        this.config.thresholds,
      ),
    };
  }
}

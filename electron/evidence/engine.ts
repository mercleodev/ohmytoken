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
} from './types';
import type { SignalPlugin } from './signals/types';
import type { FusionStrategy } from './fusion/types';
import { builtinSignals } from './registry';
import { weightedSumFusion } from './fusion/weightedSum';
import { dempsterShaferFusion } from './fusion/dempsterShafer';
import { mergeConfig } from './config';

const ENGINE_VERSION = '1.0.0';

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
 * Priority:
 *   1. USED ack token        → confirmed (LLM self-declared engagement)
 *   2. NOT_APPLICABLE ack    → likely (LLM acknowledged + judged irrelevant)
 *   3. Direct tool reference → confirmed (Read/Edit/Write/Glob/Grep hit the file)
 *   4. No evidence signal    → unverified (priors-only — see #353)
 *   5. Raw-score thresholds  → confirmed/likely/unverified
 *
 * The raw score is used (not normalized) because the weighted-sum normalizer's
 * "active-signal-only denominator" perversely scored files with *more* evidence
 * lower than files with less. See #359.
 */
const classify = (
  rawScore: number,
  hasEvidenceSignal: boolean,
  hasDirectToolReference: boolean,
  ackVerdict: AckVerdict,
  thresholds: { confirmed_min_raw: number; likely_min_raw: number },
): EvidenceClassification => {
  if (ackVerdict === 'USED') return 'confirmed';
  if (ackVerdict === 'NOT_APPLICABLE') return 'likely';
  if (hasDirectToolReference) return 'confirmed';
  if (!hasEvidenceSignal) return 'unverified';
  if (rawScore >= thresholds.confirmed_min_raw) return 'confirmed';
  if (rawScore >= thresholds.likely_min_raw) return 'likely';
  return 'unverified';
};

export class EvidenceEngine {
  private config: EvidenceEngineConfig;
  private signals: SignalPlugin[];
  private fusion: FusionStrategy;

  constructor(userConfig?: Partial<EvidenceEngineConfig>) {
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
  updateConfig(userConfig: Partial<EvidenceEngineConfig>): void {
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
        this.config.thresholds,
      ),
    };
  }
}

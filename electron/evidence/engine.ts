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
import { DEFAULT_ENGINE_CONFIG, mergeConfig } from './config';

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

/**
 * Classify a normalized score into C/L/U.
 */
const classify = (
  normalizedScore: number,
  thresholds: { confirmed_min: number; likely_min: number },
): EvidenceClassification => {
  if (normalizedScore >= thresholds.confirmed_min) return 'confirmed';
  if (normalizedScore >= thresholds.likely_min) return 'likely';
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
        classification: classify(fused.normalizedScore, this.config.thresholds),
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
      classification: classify(fused.normalizedScore, this.config.thresholds),
    };
  }
}

/**
 * Centralized helper for watcher paths: load detail → score (if no richer
 * report exists) → persist → emit to both main window and notification window.
 *
 * See docs/idea/notification-evidence-all-unverified.md §5.1 G1-3, §6 PR-3.
 *
 * Anti-downgrade rule (MVP): if a stored evidence_report already exists for
 * the request_id, do NOT rescore. The proxy path feeds fileContents, unlocking
 * content-dependent signals (instruction-compliance, text-overlap); watcher
 * paths cannot. Since PR-0 made insertEvidenceReport an upsert, a naive
 * watcher rescore would clobber the richer proxy report. Skipping when a
 * report exists is the simplest correct guard until G2 lands; see §10 Q5.
 *
 * Dependencies are injected so the helper is unit-testable without the
 * full Electron harness (G1-5 test seam).
 */

import type { EvidenceReport } from "./types";
import type { PromptScan, UsageLogEntry } from "../proxy/types";

export type EmitReason = "session" | "codex" | "history";

export type EmitScoredScanDeps = {
  reader: {
    getPromptDetail: (
      requestId: string,
    ) => { scan: PromptScan; usage: UsageLogEntry } | null;
    getEvidenceReport: (requestId: string) => EvidenceReport | null;
    getPromptIdByRequestId: (requestId: string) => number | null;
    getSessionFileScores: (sessionId: string) => Record<string, number[]>;
  };
  writer: {
    insertEvidenceReport: (
      promptId: number,
      report: EvidenceReport,
    ) => number | null;
  };
  engine: {
    score: (
      scan: PromptScan,
      opts: { previousScores: Record<string, number[]> },
    ) => EvidenceReport;
  } | null;
  sendToMain: (channel: string, data: unknown) => void;
  sendToNotification: (channel: string, data: unknown) => void;
  logger?: { error: (...args: unknown[]) => void };
};

export type EmitScoredScan = (requestId: string, reason: EmitReason) => void;

export const makeEmitScoredScan = (deps: EmitScoredScanDeps): EmitScoredScan => {
  const log = deps.logger ?? console;

  return (requestId, reason) => {
    const detail = deps.reader.getPromptDetail(requestId);
    if (!detail?.scan) return;

    // Anti-downgrade: prefer an already-persisted report over a fresh
    // watcher-path score.
    const existing =
      detail.scan.evidence_report ?? deps.reader.getEvidenceReport(requestId);

    if (existing) {
      detail.scan.evidence_report = existing;
    } else if (deps.engine) {
      try {
        const previousScores = deps.reader.getSessionFileScores(
          detail.scan.session_id,
        );
        const report = deps.engine.score(detail.scan, { previousScores });
        detail.scan.evidence_report = report;
        const promptId = deps.reader.getPromptIdByRequestId(requestId);
        if (promptId !== null) {
          deps.writer.insertEvidenceReport(promptId, report);
        }
      } catch (e) {
        log.error(`[emitScoredScan:${reason}] evidence scoring failed:`, e);
        // Fall through: still emit the scan without evidence_report so the
        // notification card renders something. PR-5 (pending state) handles
        // the "no report yet" UI; today this degrades to the legacy U bucket.
      }
    }

    const payload = { scan: detail.scan, usage: detail.usage ?? null };
    deps.sendToNotification("new-prompt-scan", payload);
    deps.sendToMain("new-prompt-scan", payload);
  };
};

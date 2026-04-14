/**
 * Factory that builds the full ProxyOptions object — including all evidence
 * hooks — used by both the initial proxy start and the settings-change
 * restart. Before this module, the restart call-site at electron/main.ts:835
 * re-invoked startProxyServer without evidenceEngine/getSystemContents/
 * getPreviousScores/onEvidenceScored, silently dropping the evidence path
 * after any port change.
 *
 * See docs/idea/notification-evidence-all-unverified.md §5.1 G1-4, §6 PR-4.
 */

import type { ProxyOptions } from "./server";
import type { PromptScan, UsageLogEntry } from "./types";
import type { EvidenceReport } from "../evidence/types";
import type { EvidenceEngine } from "../evidence/engine";

export type BuildProxyOptionsArgs = {
  port: number;
  upstream: string;
  resolveSessionId: () => string;

  // IPC delivery
  sendToMain: (channel: string, data: unknown) => void;
  sendToNotification: (channel: string, data: unknown) => void;

  // DB writes
  onProxyScanComplete: (scan: PromptScan, usage: UsageLogEntry) => void;
  persistEvidence: (requestId: string, report: EvidenceReport) => void;

  // Evidence hooks
  evidenceEngine: EvidenceEngine | null;
  parseSystemContents: (body: string) => Record<string, string>;
  getPreviousScores: (sessionId: string) => Record<string, number[]>;
};

export const buildProxyOptions = (args: BuildProxyOptionsArgs): ProxyOptions => ({
  port: args.port,
  upstream: args.upstream,
  resolveSessionId: args.resolveSessionId,
  onScanComplete: (scan, usage) => {
    args.sendToMain("new-prompt-scan", { scan, usage });
    args.sendToNotification("new-prompt-scan", { scan, usage });
    try {
      args.onProxyScanComplete(scan, usage);
    } catch (e) {
      console.error("[DB] proxy write error:", e);
    }
  },
  evidenceEngine: args.evidenceEngine ?? undefined,
  getSystemContents: (body: string) => args.parseSystemContents(body),
  getPreviousScores: args.getPreviousScores,
  onEvidenceScored: (scan) => {
    if (!scan.evidence_report) return;
    try {
      args.persistEvidence(scan.request_id, scan.evidence_report);
    } catch (e) {
      console.error("[Evidence] DB write error:", e);
    }
    const payload = {
      requestId: scan.request_id,
      report: scan.evidence_report,
    };
    args.sendToMain("evidence-scored", payload);
    args.sendToNotification("evidence-scored", payload);
  },
});

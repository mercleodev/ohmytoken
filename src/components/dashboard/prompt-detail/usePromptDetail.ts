import { useState, useEffect, useCallback } from "react";
import type { PromptScan, UsageLogEntry } from "../../../types";
import type { GuardrailAssessment } from "../../../guardrails/types";
import { buildContext } from "../../../guardrails/buildContext";
import { evaluate } from "../../../guardrails/engine";
import { MVP_RULES } from "../../../guardrails/rules";
import { FEATURE_FLAGS } from "../../../config/featureFlags";
import {
  CONTINUATION_PROMPT_MARKER,
  SESSION_SCAN_DEDUP_MS,
  COMPACTION_DROP_RATIO,
  MIN_COMPACTION_BASE_TOKENS,
  LOW_UTILIZATION_LOOKBACK,
} from "./constants";
import { buildInjectedEvidence } from "./evidence";

type UsePromptDetailReturn = {
  enrichedScan: PromptScan;
  sessionCompactions: number | null;
  guardrailAssessment: GuardrailAssessment | undefined;
  handleRescore: () => Promise<void>;
  lowUtilizationPaths: Set<string>;
};

/** Check if scan is missing detailed data that JSONL enrichment can provide */
const isIncompleteScan = (s: PromptScan): boolean => {
  // Case 1: batch import with tokens but no detailed breakdown
  const missingBreakdown =
    (s.context_estimate?.system_tokens ?? 0) === 0 &&
    (s.injected_files ?? []).length === 0 &&
    (s.context_estimate?.total_tokens ?? 0) > 0;

  // Case 2: has structure (turns/files) but missing API response metadata
  const missingApiMeta =
    (!s.model || s.model === "unknown") &&
    (s.context_estimate?.total_tokens ?? 0) === 0;

  // Case 3: has token data but missing tool_calls (e.g. from notification scan)
  const missingToolCalls =
    (s.tool_calls ?? []).length === 0 &&
    (s.context_estimate?.total_tokens ?? 0) > 0;

  return missingBreakdown || missingApiMeta || missingToolCalls;
};

export function usePromptDetail(scan: PromptScan, usage?: UsageLogEntry | null): UsePromptDetailReturn {
  const [enrichedScan, setEnrichedScan] = useState<PromptScan>(scan);
  const [sessionCompactions, setSessionCompactions] = useState<number | null>(null);
  const [guardrailAssessment, setGuardrailAssessment] = useState<GuardrailAssessment | undefined>();
  const [lowUtilizationPaths, setLowUtilizationPaths] = useState<Set<string>>(new Set());

  // Enrich incomplete batch-imported scans with full JSONL data
  useEffect(() => {
    if (!isIncompleteScan(scan)) return;
    let cancelled = false;

    const enrich = async () => {
      try {
        // Try history prompt detail (has JSONL fallback with full data)
        const ts = new Date(scan.timestamp).getTime();
        const detail = await window.api.getHistoryPromptDetail(scan.session_id, ts);
        if (cancelled || !detail?.scan) return;

        // Only replace if the enriched data is actually richer
        const enriched = detail.scan as PromptScan;
        const hasMoreData =
          (enriched.injected_files?.length ?? 0) > 0 ||
          (enriched.context_estimate?.system_tokens ?? 0) > 0 ||
          (enriched.model != null && enriched.model !== "unknown") ||
          (enriched.context_estimate?.total_tokens ?? 0) > 0 ||
          (enriched.tool_calls?.length ?? 0) > 0;
        if (hasMoreData) {
          setEnrichedScan((prev) => ({
            ...enriched,
            evidence_report: prev.evidence_report,
          }));
        }
      } catch {
        /* enrichment is best-effort */
      }
    };

    enrich();
    return () => { cancelled = true; };
  }, [scan.request_id, scan.session_id, scan.timestamp]);

  // Fetch evidence report if not already attached; auto-rescore if missing
  useEffect(() => {
    if (scan.evidence_report) {
      setEnrichedScan((prev) => ({ ...prev, evidence_report: scan.evidence_report }));
      return;
    }
    let cancelled = false;

    const loadOrRescore = async () => {
      const existing = await window.api?.getEvidenceReport?.(scan.request_id).catch(() => null);
      if (cancelled) return;
      if (existing) {
        setEnrichedScan({ ...scan, evidence_report: existing });
        return;
      }
      const report = await window.api?.rescoreEvidence?.(scan.request_id).catch(() => null);
      if (cancelled || !report) return;
      setEnrichedScan({ ...scan, evidence_report: report });
    };

    loadOrRescore();

    const unsub = window.api?.onEvidenceScored?.((data) => {
      if (data.requestId === scan.request_id) {
        setEnrichedScan((prev) => ({ ...prev, evidence_report: data.report }));
      }
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [scan.request_id, scan.evidence_report]);

  // Count context compactions in session up to this scan
  useEffect(() => {
    let isActive = true;

    const loadCompactionCount = async () => {
      try {
        if (!scan.session_id) {
          if (isActive) setSessionCompactions(0);
          return;
        }

        const targetTimestampMs = new Date(scan.timestamp).getTime();
        if (!Number.isFinite(targetTimestampMs)) {
          if (isActive) setSessionCompactions(0);
          return;
        }

        const sessionScans = await window.api.getSessionScans(scan.session_id);
        const sorted = [...sessionScans].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

        const dedupedUntilTarget: PromptScan[] = [];
        for (const item of sorted) {
          const itemTimestampMs = new Date(item.timestamp).getTime();
          if (!Number.isFinite(itemTimestampMs)) continue;
          if (itemTimestampMs > targetTimestampMs) continue;

          const prev = dedupedUntilTarget[dedupedUntilTarget.length - 1];
          if (prev) {
            const prevTimestampMs = new Date(prev.timestamp).getTime();
            const samePrompt =
              (prev.user_prompt || "").trim() === (item.user_prompt || "").trim();
            if (
              samePrompt &&
              Math.abs(itemTimestampMs - prevTimestampMs) < SESSION_SCAN_DEDUP_MS
            ) {
              continue;
            }
          }

          dedupedUntilTarget.push(item);
        }

        let count = 0;
        for (let i = 0; i < dedupedUntilTarget.length; i++) {
          const current = dedupedUntilTarget[i];
          const previous = dedupedUntilTarget[i - 1];
          const hasContinuationMarker = (current.user_prompt || "").includes(
            CONTINUATION_PROMPT_MARKER,
          );
          const previousTokens = previous?.context_estimate?.total_tokens ?? 0;
          const currentTokens = current.context_estimate?.total_tokens ?? 0;
          const hasSignificantDrop =
            previousTokens >= MIN_COMPACTION_BASE_TOKENS &&
            currentTokens > 0 &&
            currentTokens < previousTokens * COMPACTION_DROP_RATIO;

          if (hasContinuationMarker || hasSignificantDrop) {
            count += 1;
          }
        }

        if (isActive) setSessionCompactions(count);

        // Compute low-utilization files
        const currentIdx = dedupedUntilTarget.length - 1;
        if (currentIdx >= 1) {
          const lookbackScans = dedupedUntilTarget.slice(
            Math.max(0, currentIdx - LOW_UTILIZATION_LOOKBACK + 1),
            currentIdx + 1,
          );
          if (lookbackScans.length >= 2) {
            const currentFiles = scan.injected_files ?? [];
            const lowUtil = new Set<string>();
            for (const file of currentFiles) {
              const unverifiedInAll = lookbackScans.every((s) => {
                const evidence = buildInjectedEvidence(s);
                const isPresent = (s.injected_files ?? []).some((f) => f.path === file.path);
                const isUnverified = evidence.unverified.some((e) => e.path === file.path);
                return isPresent && isUnverified;
              });
              if (unverifiedInAll) lowUtil.add(file.path);
            }
            if (isActive) setLowUtilizationPaths(lowUtil);
          }
        }
      } catch {
        if (isActive) setSessionCompactions(0);
      }
    };

    loadCompactionCount();

    return () => {
      isActive = false;
    };
  }, [scan.request_id, scan.session_id, scan.timestamp]);

  // Compute guardrail assessment via batch IPC
  useEffect(() => {
    if (!FEATURE_FLAGS.GUARDRAILS) return;
    if (!scan.session_id) return;
    let cancelled = false;

    const computeAssessment = async () => {
      try {
        const batch = await window.api.getGuardrailContext(scan.session_id);
        if (cancelled) return;
        const ctx = buildContext(scan, usage ?? null, batch.turnMetrics, batch.mcpAnalysis, batch.harnessCandidates);
        const assessment = evaluate(ctx, MVP_RULES);
        setGuardrailAssessment(assessment);
      } catch {
        // Best-effort: guardrail summary won't show if IPC fails
      }
    };

    computeAssessment();
    return () => { cancelled = true; };
  }, [scan.request_id, scan.session_id, usage]);

  const handleRescore = useCallback(async () => {
    const report = await window.api?.rescoreEvidence?.(scan.request_id);
    if (report) {
      setEnrichedScan((prev) => ({ ...prev, evidence_report: report }));
    }
  }, [scan.request_id]);

  return { enrichedScan, sessionCompactions, guardrailAssessment, handleRescore, lowUtilizationPaths };
}

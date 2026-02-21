import { useState, useEffect, useCallback } from "react";
import type { PromptScan } from "../../../types";
import {
  CONTINUATION_PROMPT_MARKER,
  SESSION_SCAN_DEDUP_MS,
  COMPACTION_DROP_RATIO,
  MIN_COMPACTION_BASE_TOKENS,
} from "./constants";

type UsePromptDetailReturn = {
  enrichedScan: PromptScan;
  sessionCompactions: number | null;
  handleRescore: () => Promise<void>;
};

export function usePromptDetail(scan: PromptScan): UsePromptDetailReturn {
  const [enrichedScan, setEnrichedScan] = useState<PromptScan>(scan);
  const [sessionCompactions, setSessionCompactions] = useState<number | null>(null);

  // Fetch evidence report if not already attached; auto-rescore if missing
  useEffect(() => {
    if (scan.evidence_report) {
      setEnrichedScan(scan);
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
      } catch {
        if (isActive) setSessionCompactions(0);
      }
    };

    loadCompactionCount();

    return () => {
      isActive = false;
    };
  }, [scan.request_id, scan.session_id, scan.timestamp]);

  const handleRescore = useCallback(async () => {
    const report = await window.api?.rescoreEvidence?.(scan.request_id);
    if (report) {
      setEnrichedScan((prev) => ({ ...prev, evidence_report: report }));
    }
  }, [scan.request_id]);

  return { enrichedScan, sessionCompactions, handleRescore };
}

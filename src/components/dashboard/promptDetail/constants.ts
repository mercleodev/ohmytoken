import type { PromptScan, UsageLogEntry } from "../../../types";

export const CONTINUATION_PROMPT_MARKER =
  "This session is being continued from a previous conversation that ran out of context";
export const SESSION_SCAN_DEDUP_MS = 5_000;
export const COMPACTION_DROP_RATIO = 0.8;
export const MIN_COMPACTION_BASE_TOKENS = 30_000;
export const DIRECT_FILE_ACTIONS = new Set(["Read", "Write", "Edit"]);

export type EvidenceStatus = "confirmed" | "likely" | "unverified";

export type InjectedEvidenceItem = {
  path: string;
  category: "global" | "project" | "rules" | "memory" | "skill";
  estimated_tokens: number;
  status: EvidenceStatus;
  reason: string;
};

export type PromptDetailViewProps = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  onBack: () => void;
};

import type { SignalResult } from "../../../types";

export type EvidenceStatus = "confirmed" | "likely" | "unverified";

export type InjectedEvidenceItem = {
  path: string;
  category: "global" | "project" | "rules" | "memory" | "skill";
  estimated_tokens: number;
  status: EvidenceStatus;
  reason: string;
  normalizedScore?: number;
  signals?: SignalResult[];
};

import { lazy } from "react";
import type { EvidenceStatus } from "./types";

export const CONTINUATION_PROMPT_MARKER =
  "This session is being continued from a previous conversation that ran out of context";
export const SESSION_SCAN_DEDUP_MS = 5_000;
export const COMPACTION_DROP_RATIO = 0.8;
export const MIN_COMPACTION_BASE_TOKENS = 30_000;
export const DIRECT_FILE_ACTIONS = new Set(["Read", "Write", "Edit", "Glob", "Grep"]);
export const INDIRECT_FILE_TOOLS = new Set(["Bash", "exec_command", "ToolSearch"]);
export const LOW_UTILIZATION_LOOKBACK = 3;

export const EVIDENCE_STATUS_COLORS: Record<EvidenceStatus, string> = {
  confirmed: "#1f7a57",
  likely: "#d18f1d",
  unverified: "#9ca3af",
};

export const SIGNAL_COLORS: Record<string, string> = {
  "category-prior": "#8b5cf6",
  "text-overlap": "#3b82f6",
  "instruction-compliance": "#06b6d4",
  "tool-reference": "#f59e0b",
  "position-effect": "#ec4899",
  "token-proportion": "#10b981",
  "session-history": "#6366f1",
};

export const CONFIDENCE_LEVELS = [
  { min: 0.7, label: "High", color: "#1f7a57" },
  { min: 0.4, label: "Med", color: "#d18f1d" },
  { min: 0, label: "Low", color: "#9ca3af" },
] as const;

export const getConfidenceInfo = (confidence: number) =>
  CONFIDENCE_LEVELS.find((l) => confidence >= l.min) ?? CONFIDENCE_LEVELS[2];

export const getLanguage = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    sh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    rb: "ruby",
    swift: "swift",
  };
  return map[ext] || "text";
};

export const normalizeText = (value: string): string => value.trim().toLowerCase();

export const getFileName = (pathValue: string): string =>
  pathValue.split("/").filter(Boolean).pop() ?? pathValue;

export const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter/dist/esm/prism-async-light").then((mod) => ({
    default: mod.default,
  })),
);

export const syntaxThemePromise =
  import("react-syntax-highlighter/dist/esm/styles/prism/one-dark").then(
    (mod) => mod.default,
  );

import type { InjectedEvidenceItem } from "./types";

/**
 * Issue #372: when a file's stored `category` is `project` or `global`
 * (because CC injected it via nested_memory.type=Project|User), but its
 * filesystem path is unambiguously under `.claude/{rules,memory,skills}`,
 * the UI chip should reflect the path-derived semantic category. The stored
 * category remains the source of truth for engine prior-signal scoring;
 * this helper exists purely for renderer presentation.
 *
 * Resolution uses the LAST `/.claude/` boundary so paths with nested
 * `.claude/` segments (e.g. a fixture under `~/.claude/projects/...`) still
 * pick the closest enclosing kind.
 *
 * Pure, no I/O.
 */
type SemanticCategory = InjectedEvidenceItem["category"];

const SUBDIR_TO_CATEGORY: Array<[string, SemanticCategory]> = [
  ["/.claude/rules/", "rules"],
  ["/.claude/memory/", "memory"],
  ["/.claude/skills/", "skill"],
];

export const getSemanticCategory = (
  path: string,
  fallback: SemanticCategory,
): SemanticCategory => {
  if (!path) return fallback;
  for (const [needle, category] of SUBDIR_TO_CATEGORY) {
    if (path.lastIndexOf(needle) >= 0) return category;
  }
  return fallback;
};

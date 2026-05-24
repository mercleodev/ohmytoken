/**
 * Issue #370: JSONL `cwd` is recorded at session start and does not move
 * when the LLM operates on a different project mid-session. To recover
 * that project's `.claude/{rules,memory,skills}` files for the candidate
 * pool, we infer "extra roots" from any iterable of file paths whose
 * ancestry contains a `.claude/` segment.
 *
 * Pure helper, no I/O. The caller passes the derived roots to
 * `applyDiskScanCandidates` so existing dedup semantics apply.
 */

const CLAUDE_SEGMENT = "/.claude/";

export const deriveExtraRoots = (paths: Iterable<string>): string[] => {
  const roots = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    const idx = p.lastIndexOf(CLAUDE_SEGMENT);
    if (idx <= 0) continue;
    roots.add(p.slice(0, idx));
  }
  return [...roots];
};

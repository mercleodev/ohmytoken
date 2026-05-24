/**
 * Disk-only scanner for `.claude/{rules,memory,skills}` markdown candidates.
 *
 * Kept separate from `transcriptReader.ts` on purpose: that module is JSONL-
 * only and stateless on the filesystem; this module is filesystem-only and
 * never reads the transcript. No shared state.
 */
import fs from "node:fs";
import path from "node:path";
import { countTokens } from "../analyzer/tokenCounter";
import type { InjectedFile } from "../proxy/types";

type SubdirSpec = {
  rel: string;
  category: Extract<InjectedFile["category"], "rules" | "memory" | "skill">;
};

const SUBDIRS: SubdirSpec[] = [
  { rel: ".claude/rules", category: "rules" },
  { rel: ".claude/memory", category: "memory" },
  { rel: ".claude/skills", category: "skill" },
];

// Deepest observed skill layout is `.claude/skills/<skill>/references/<file>.md`
// (depth 3 from the SUBDIRS root). The +1 leaves headroom for one more nested
// section directory without revisiting the constant.
const MAX_DEPTH = 4;

const walkMd = (root: string, depth: number, out: string[]): void => {
  if (depth < 0) return;
  let entries: fs.Dirent[];
  try {
    // Best-effort scan: a permission glitch on a single directory must never
    // crash the Stop hook. We silently return what we could enumerate and let
    // the evidence engine's ack/unverified tier handle the gap.
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip dotfiles (editor droppings like .DS_Store, .swp) and dot-dirs by
    // convention: anything authored as `.draft.md` is treated as a non-injected
    // working file, matching how CC itself only injects non-hidden markdown.
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkMd(abs, depth - 1, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      // Symlinks: Dirent.isFile()/isDirectory() both return false for symlinks
      // under withFileTypes:true, so neither symlinked dirs nor files are
      // followed/emitted. This neutralizes the symlink-escape / path-traversal
      // risk for free; documented here so a future maintainer doesn't add
      // entry.isSymbolicLink() without considering the security trade-off.
      out.push(abs);
    }
  }
};

const buildEntry = (
  abs: string,
  category: InjectedFile["category"],
): InjectedFile | null => {
  let content: string;
  try {
    // Same best-effort contract as walkMd: a single unreadable file is
    // skipped silently so the rest of the scan still lands.
    content = fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
  return {
    path: abs,
    category,
    estimated_tokens: countTokens(content),
  };
};

/**
 * Scan `<rootDir>/.claude/{rules,memory,skills}` for `.md` files and
 * return one InjectedFile per discovered file with the matching category.
 *
 * Issue #363: Claude Code 2.x injects project + global rule files at the
 * wire-level API request layer but does NOT persist them in the local
 * JSONL transcript. The Stop-hook capture path therefore reconstructs
 * the candidate pool from disk so the evidence engine has something to
 * score against (ack tokens, raw-score signals).
 *
 * Error handling contract: directory/file read errors are intentionally
 * silenced. The scan returns whatever could be enumerated; the caller
 * cannot distinguish "no rules on disk" from "permission denied" — this
 * is by design so the Stop hook never throws on a transient OS error.
 */
export const collectDotClaudeFiles = (
  rootDir: string | undefined,
): InjectedFile[] => {
  if (!rootDir) return [];
  const out: InjectedFile[] = [];
  for (const { rel, category } of SUBDIRS) {
    const dir = path.join(rootDir, rel);
    const paths: string[] = [];
    walkMd(dir, MAX_DEPTH, paths);
    for (const abs of paths) {
      const entry = buildEntry(abs, category);
      if (entry) out.push(entry);
    }
  }
  return out;
};

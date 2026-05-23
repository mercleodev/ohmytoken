import fs from 'node:fs/promises';
import path from 'node:path';

export const RULE_ACK_CANARY_LINE_REGEX = /<!--\s*canary:CANARY-[A-Za-z0-9_-]+\s*-->/;

const CANARY_ID_REGEX = /<!--\s*canary:CANARY-([A-Za-z0-9_-]+)\s*-->/;

export const extractExistingCanary = (content: string): string | null => {
  const match = content.match(CANARY_ID_REGEX);
  return match ? match[1] : null;
};

export const proposedIdForPath = (filePath: string): string => {
  const base = path.basename(filePath);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

export const buildInsertedContent = (originalContent: string, id: string): string => {
  return `<!-- canary:CANARY-${id} -->\n${originalContent}`;
};

export type ProposedItem = { filePath: string; proposedId: string };

export const detectCollisions = (
  items: readonly ProposedItem[],
): Map<string, ProposedItem[]> => {
  const buckets = new Map<string, ProposedItem[]>();
  for (const item of items) {
    const list = buckets.get(item.proposedId) ?? [];
    list.push(item);
    buckets.set(item.proposedId, list);
  }
  for (const id of [...buckets.keys()]) {
    if ((buckets.get(id) ?? []).length < 2) buckets.delete(id);
  }
  return buckets;
};

export type ScannedRuleFile = {
  filePath: string;
  existingCanaryId: string | null;
  content: string;
};

const directoryExists = async (dir: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

export const scanRuleFiles = async (
  roots: readonly string[],
): Promise<ScannedRuleFile[]> => {
  const seen = new Set<string>();
  const out: ScannedRuleFile[] = [];

  for (const root of roots) {
    if (!(await directoryExists(root))) continue;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md')) continue;
      const filePath = path.join(root, entry.name);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      out.push({
        filePath,
        existingCanaryId: extractExistingCanary(content),
        content,
      });
    }
  }
  return out;
};

export type PlanEntry = {
  filePath: string;
  proposedId: string;
  willInsert: boolean;
  reasonSkipped: 'already-has-marker' | null;
  originalContent: string;
  nextContent: string;
  diff: string;
};

export type InsertPlan = {
  entries: PlanEntry[];
  duplicateIds: Map<string, ProposedItem[]>;
};

const buildDiff = (filePath: string, before: string, after: string): string => {
  const insertedLine = after.split('\n', 1)[0];
  return [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -1,1 +1,2 @@`,
    `+${insertedLine}`,
    ` ${before.split('\n', 1)[0]}`,
  ].join('\n');
};

export const buildPlan = (files: readonly ScannedRuleFile[]): InsertPlan => {
  const entries: PlanEntry[] = files.map((f) => {
    const proposedId = proposedIdForPath(f.filePath);
    if (f.existingCanaryId !== null) {
      return {
        filePath: f.filePath,
        proposedId,
        willInsert: false,
        reasonSkipped: 'already-has-marker',
        originalContent: f.content,
        nextContent: f.content,
        diff: '',
      };
    }
    const nextContent = buildInsertedContent(f.content, proposedId);
    return {
      filePath: f.filePath,
      proposedId,
      willInsert: true,
      reasonSkipped: null,
      originalContent: f.content,
      nextContent,
      diff: buildDiff(f.filePath, f.content, nextContent),
    };
  });

  const proposedItems = entries
    .filter((e) => e.willInsert)
    .map((e) => ({ filePath: e.filePath, proposedId: e.proposedId }));
  const duplicateIds = detectCollisions(proposedItems);

  return { entries, duplicateIds };
};

export type AppliedFile = {
  filePath: string;
  backupPath: string;
  proposedId: string;
};

export type SkippedFile = {
  filePath: string;
  reason: 'already-has-marker';
};

export type ApplyResult = {
  ok: boolean;
  applied: AppliedFile[];
  skipped: SkippedFile[];
  failedAt: { filePath: string; error: string } | null;
};

const restoreFromBackup = async (a: AppliedFile): Promise<void> => {
  const backup = await fs.readFile(a.backupPath, 'utf8');
  await fs.writeFile(a.filePath, backup, 'utf8');
  await fs.unlink(a.backupPath).catch(() => {});
};

export const applyPlan = async (plan: InsertPlan): Promise<ApplyResult> => {
  const applied: AppliedFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const entry of plan.entries) {
    if (!entry.willInsert) {
      skipped.push({ filePath: entry.filePath, reason: 'already-has-marker' });
      continue;
    }
    const backupPath = `${entry.filePath}.bak`;
    try {
      await fs.writeFile(backupPath, entry.originalContent, 'utf8');
      await fs.writeFile(entry.filePath, entry.nextContent, 'utf8');
      applied.push({
        filePath: entry.filePath,
        backupPath,
        proposedId: entry.proposedId,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const a of applied) {
        await restoreFromBackup(a).catch(() => {});
      }
      await fs.unlink(backupPath).catch(() => {});
      return {
        ok: false,
        applied: [],
        skipped,
        failedAt: { filePath: entry.filePath, error },
      };
    }
  }

  return { ok: true, applied, skipped, failedAt: null };
};

export type RollbackResult = {
  restored: AppliedFile[];
  failed: { filePath: string; error: string }[];
};

export const rollbackApply = async (
  applyResult: ApplyResult,
): Promise<RollbackResult> => {
  const restored: AppliedFile[] = [];
  const failed: { filePath: string; error: string }[] = [];
  for (const a of applyResult.applied) {
    try {
      await restoreFromBackup(a);
      restored.push(a);
    } catch (err) {
      failed.push({
        filePath: a.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { restored, failed };
};

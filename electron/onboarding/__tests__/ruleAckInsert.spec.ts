import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractExistingCanary,
  buildInsertedContent,
  proposedIdForPath,
  detectCollisions,
  scanRuleFiles,
  buildPlan,
  applyPlan,
  rollbackApply,
  RULE_ACK_CANARY_LINE_REGEX,
} from '../ruleAckInsert';

describe('extractExistingCanary', () => {
  it('returns null when no canary marker exists', () => {
    expect(extractExistingCanary('# title\n\nbody')).toBeNull();
  });

  it('extracts id from a canary html comment', () => {
    expect(extractExistingCanary('<!-- canary:CANARY-tailwind -->\nbody')).toBe('tailwind');
  });

  it('matches when the marker is mid-file', () => {
    expect(
      extractExistingCanary('intro\n\n<!-- canary:CANARY-fsd -->\nrest'),
    ).toBe('fsd');
  });

  it('accepts ids with hyphens and underscores', () => {
    expect(extractExistingCanary('<!-- canary:CANARY-tail_wind-v2 -->')).toBe('tail_wind-v2');
  });

  it('rejects ids with invalid characters', () => {
    expect(extractExistingCanary('<!-- canary:CANARY-tailwind! -->')).toBeNull();
  });
});

describe('proposedIdForPath', () => {
  it('returns basename without .md extension', () => {
    expect(proposedIdForPath('/proj/.claude/rules/tailwind.md')).toBe('tailwind');
  });

  it('handles nested basenames', () => {
    expect(proposedIdForPath('/x/y/data-fetching.md')).toBe('data-fetching');
  });

  it('preserves case', () => {
    expect(proposedIdForPath('/x/CamelCase.md')).toBe('CamelCase');
  });
});

describe('buildInsertedContent', () => {
  it('prepends a canary line on its own row with a trailing newline', () => {
    expect(buildInsertedContent('# title\nbody', 'tailwind')).toBe(
      '<!-- canary:CANARY-tailwind -->\n# title\nbody',
    );
  });

  it('the inserted line matches the canary regex', () => {
    const out = buildInsertedContent('body', 'fsd');
    expect(RULE_ACK_CANARY_LINE_REGEX.test(out.split('\n')[0])).toBe(true);
  });
});

describe('detectCollisions', () => {
  it('flags duplicate proposed ids across scoped roots', () => {
    const items = [
      { filePath: '/proj/.claude/rules/tailwind.md', proposedId: 'tailwind' },
      { filePath: '/global/.claude/rules/tailwind.md', proposedId: 'tailwind' },
      { filePath: '/proj/.claude/rules/fsd.md', proposedId: 'fsd' },
    ];
    const collisions = detectCollisions(items);
    expect(collisions.get('tailwind')?.length).toBe(2);
    expect(collisions.has('fsd')).toBe(false);
  });

  it('returns an empty map when there are no collisions', () => {
    const items = [
      { filePath: '/a/x.md', proposedId: 'x' },
      { filePath: '/b/y.md', proposedId: 'y' },
    ];
    expect(detectCollisions(items).size).toBe(0);
  });
});

const makeTmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'omt-rule-ack-'));

const writeRule = (root: string, name: string, content: string): string => {
  fs.mkdirSync(root, { recursive: true });
  const p = path.join(root, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
};

describe('scanRuleFiles', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpRoot();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns an empty array when no rules dir exists', async () => {
    const result = await scanRuleFiles([path.join(tmp, 'does-not-exist')]);
    expect(result).toEqual([]);
  });

  it('lists *.md files only from each given root (non-recursive)', async () => {
    const root = path.join(tmp, 'rules');
    writeRule(root, 'tailwind.md', 'body');
    writeRule(root, 'fsd.md', 'body');
    writeRule(root, 'ignore.txt', 'body');

    const result = await scanRuleFiles([root]);
    const names = result.map((r) => path.basename(r.filePath)).sort();
    expect(names).toEqual(['fsd.md', 'tailwind.md']);
  });

  it('marks files that already contain a canary marker', async () => {
    const root = path.join(tmp, 'rules');
    writeRule(root, 'tailwind.md', '<!-- canary:CANARY-tailwind -->\nbody');
    writeRule(root, 'fsd.md', 'plain body');

    const result = await scanRuleFiles([root]);
    const tailwind = result.find((r) => r.filePath.endsWith('tailwind.md'));
    const fsd = result.find((r) => r.filePath.endsWith('fsd.md'));
    expect(tailwind!.existingCanaryId).toBe('tailwind');
    expect(fsd!.existingCanaryId).toBeNull();
  });

  it('deduplicates files that appear in multiple roots', async () => {
    const root = path.join(tmp, 'rules');
    writeRule(root, 'tailwind.md', 'body');
    const result = await scanRuleFiles([root, root]);
    expect(result.length).toBe(1);
  });
});

describe('buildPlan', () => {
  it('produces one entry per scanned file with proposed id and diff', () => {
    const plan = buildPlan([
      { filePath: '/a/.claude/rules/tailwind.md', existingCanaryId: null, content: 'body' },
      { filePath: '/a/.claude/rules/fsd.md', existingCanaryId: null, content: '# fsd\n' },
    ]);
    expect(plan.entries.length).toBe(2);
    const tw = plan.entries.find((e) => e.filePath.endsWith('tailwind.md'))!;
    expect(tw.proposedId).toBe('tailwind');
    expect(tw.willInsert).toBe(true);
    expect(tw.diff).toContain('<!-- canary:CANARY-tailwind -->');
  });

  it('marks files with an existing canary as willInsert=false', () => {
    const plan = buildPlan([
      { filePath: '/a/x.md', existingCanaryId: 'x', content: '<!-- canary:CANARY-x -->\nbody' },
    ]);
    expect(plan.entries[0].willInsert).toBe(false);
    expect(plan.entries[0].reasonSkipped).toBe('already-has-marker');
  });

  it('records duplicate-id warnings', () => {
    const plan = buildPlan([
      { filePath: '/proj/.claude/rules/tailwind.md', existingCanaryId: null, content: 'a' },
      { filePath: '/global/.claude/rules/tailwind.md', existingCanaryId: null, content: 'b' },
    ]);
    expect(plan.duplicateIds.get('tailwind')?.length).toBe(2);
  });
});

describe('applyPlan and rollbackApply', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpRoot();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes .md.bak and prepends canary line atomically per entry', async () => {
    const filePath = writeRule(tmp, 'tailwind.md', 'original\nbody');
    const plan = buildPlan([
      { filePath, existingCanaryId: null, content: 'original\nbody' },
    ]);
    const result = await applyPlan(plan);
    expect(result.applied.length).toBe(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      '<!-- canary:CANARY-tailwind -->\noriginal\nbody',
    );
    expect(fs.readFileSync(`${filePath}.bak`, 'utf8')).toBe('original\nbody');
  });

  it('skips entries with existing canary markers', async () => {
    const filePath = writeRule(
      tmp,
      'x.md',
      '<!-- canary:CANARY-x -->\nbody',
    );
    const plan = buildPlan([
      { filePath, existingCanaryId: 'x', content: '<!-- canary:CANARY-x -->\nbody' },
    ]);
    const result = await applyPlan(plan);
    expect(result.applied.length).toBe(0);
    expect(result.skipped.length).toBe(1);
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });

  it('rolls back when a later write fails (atomic-abort)', async () => {
    const goodPath = writeRule(tmp, 'good.md', 'good-body');
    const badPath = path.join(tmp, 'sub-that-vanishes', 'bad.md');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, 'bad-body', 'utf8');
    // make the dir read-only so write fails
    fs.chmodSync(path.dirname(badPath), 0o500);

    const plan = buildPlan([
      { filePath: goodPath, existingCanaryId: null, content: 'good-body' },
      { filePath: badPath, existingCanaryId: null, content: 'bad-body' },
    ]);
    const result = await applyPlan(plan);

    // restore perms so afterEach can clean up
    fs.chmodSync(path.dirname(badPath), 0o700);

    expect(result.ok).toBe(false);
    // good.md must be restored to its pre-apply content
    expect(fs.readFileSync(goodPath, 'utf8')).toBe('good-body');
    expect(fs.existsSync(`${goodPath}.bak`)).toBe(false);
  });

  it('rollbackApply restores files from .md.bak', async () => {
    const filePath = writeRule(tmp, 'tailwind.md', 'original\nbody');
    const plan = buildPlan([
      { filePath, existingCanaryId: null, content: 'original\nbody' },
    ]);
    const result = await applyPlan(plan);
    expect(result.ok).toBe(true);

    const rollback = await rollbackApply(result);
    expect(rollback.restored.length).toBe(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('original\nbody');
    expect(fs.existsSync(`${filePath}.bak`)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { getSemanticCategory } from '../semanticCategory';
import type { InjectedEvidenceItem } from '../types';

// Issue #372: when a file's stored category is `project` (because CC injected
// it via nested_memory.type=Project) but its path is unambiguously under
// `.claude/rules`, the chip should reflect the path-derived semantic
// category. The stored category remains untouched.
describe('getSemanticCategory', () => {
  it('returns "rules" for paths under <root>/.claude/rules/', () => {
    expect(
      getSemanticCategory('/proj/web/.claude/rules/tailwind.md', 'project'),
    ).toBe('rules');
  });

  it('returns "memory" for paths under <root>/.claude/memory/', () => {
    expect(
      getSemanticCategory('/proj/web/.claude/memory/decisions.md', 'project'),
    ).toBe('memory');
  });

  it('returns "skill" for paths under <root>/.claude/skills/', () => {
    expect(
      getSemanticCategory(
        '/u/.claude/skills/build-fix/SKILL.md',
        'global',
      ),
    ).toBe('skill');
  });

  it('falls back to the stored category when no .claude/{rules,memory,skills} segment matches', () => {
    expect(
      getSemanticCategory('/proj/web/CLAUDE.md', 'project'),
    ).toBe('project');
    expect(
      getSemanticCategory('/u/.claude/CLAUDE.md', 'global'),
    ).toBe('global');
  });

  it('uses the LAST .claude/ boundary so nested fixture trees still resolve', () => {
    // Edge case mirrors deriveExtraRoots: paths whose ancestry contains
    // multiple `.claude/` segments resolve via the rightmost one.
    expect(
      getSemanticCategory(
        '/u/.claude/projects/work/.claude/rules/a.md',
        'project',
      ),
    ).toBe('rules');
  });

  it('returns the fallback category for an empty path', () => {
    expect(getSemanticCategory('', 'project')).toBe('project');
  });

  it('accepts any InjectedEvidenceItem["category"] as fallback', () => {
    const categories: InjectedEvidenceItem['category'][] = [
      'global',
      'project',
      'rules',
      'memory',
      'skill',
    ];
    for (const c of categories) {
      // No `.claude/{rules,memory,skills}` segment -> fallback wins
      expect(getSemanticCategory('/random/file.md', c)).toBe(c);
    }
  });
});

import { InjectedFile } from './types';
import { countTokens } from '../analyzer/tokenCounter';

const CONTENTS_PATTERN = /Contents of ([^\n(]+?)(?:\s*\([^)]*\))?:\n/g;

const classifyCategory = (filePath: string): InjectedFile['category'] => {
  const lower = filePath.toLowerCase();
  if (lower.includes('/rules/')) return 'rules';
  if (lower.includes('/memory/')) return 'memory';
  if (lower.includes('/skills/') || lower.includes('/skill')) return 'skill';
  if (lower.includes('claude.md')) {
    // project CLAUDE.md vs global CLAUDE.md
    if (lower.includes('/prj/') || lower.includes('/projects/') || lower.includes('checked into the codebase')) {
      return 'project';
    }
    return 'global';
  }
  return 'project';
};

const extractSystemText = (system: unknown): string => {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text: string }).text);
        }
        return '';
      })
      .join('\n');
  }
  return '';
};

export const parseSystemField = (system: unknown): InjectedFile[] => {
  const text = extractSystemText(system);
  if (!text) return [];

  const files: InjectedFile[] = [];
  const matches = [...text.matchAll(CONTENTS_PATTERN)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const filePath = match[1].trim();
    const startIdx = match.index! + match[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const content = text.slice(startIdx, endIdx).trim();

    // File path-based classification takes priority; parenthesized text is only used as fallback when path alone is ambiguous (e.g., CLAUDE.md)
    const fullMatch = match[0];
    let category = classifyCategory(filePath);
    // rules/memory/skill are precisely classified by path, so don't override
    if (category !== 'rules' && category !== 'memory' && category !== 'skill') {
      if (fullMatch.includes("user's private global instructions")) {
        category = 'global';
      } else if (fullMatch.includes('project instructions')) {
        category = 'project';
      }
    }

    files.push({
      path: filePath,
      category,
      estimated_tokens: countTokens(content),
    });
  }

  return files;
};

/**
 * Parse system field and return both InjectedFile list AND per-file content.
 * Used by the evidence scoring engine for text-overlap and compliance analysis.
 */
export const parseSystemFieldWithContent = (
  system: unknown,
): { files: InjectedFile[]; contents: Record<string, string> } => {
  const text = extractSystemText(system);
  if (!text) return { files: [], contents: {} };

  const files: InjectedFile[] = [];
  const contents: Record<string, string> = {};
  const matches = [...text.matchAll(CONTENTS_PATTERN)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const filePath = match[1].trim();
    const startIdx = match.index! + match[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const content = text.slice(startIdx, endIdx).trim();

    const fullMatch = match[0];
    let category = classifyCategory(filePath);
    if (category !== 'rules' && category !== 'memory' && category !== 'skill') {
      if (fullMatch.includes("user's private global instructions")) {
        category = 'global';
      } else if (fullMatch.includes('project instructions')) {
        category = 'project';
      }
    }

    files.push({
      path: filePath,
      category,
      estimated_tokens: countTokens(content),
    });

    contents[filePath] = content;
  }

  return { files, contents };
};

export const estimateSystemTokens = (system: unknown): number => {
  const text = extractSystemText(system);
  return countTokens(text);
};

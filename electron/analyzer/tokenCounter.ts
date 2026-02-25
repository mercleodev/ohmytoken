/**
 * Token Counter Module
 *
 * Module for counting tokens in text.
 * Designed with a plugin architecture for easy algorithm swapping.
 */

// Token counter plugin type
export type TokenCounterPlugin = {
  name: string;
  count: (text: string) => number;
  countAsync?: (text: string) => Promise<number>;
};

// Simple token counter (approximation - 4 chars ≈ 1 token)
export const simpleTokenCounter: TokenCounterPlugin = {
  name: 'simple',
  count: (text: string): number => {
    // For Claude, roughly 4 chars = 1 token (English baseline)
    // Korean uses more tokens, so estimate 2.5 chars = 1 token
    const koreanChars = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
    const otherChars = text.length - koreanChars;

    return Math.ceil(koreanChars / 2.5 + otherChars / 4);
  },
};

// Precise token counter (cl100k_base-based - GPT-4/Claude compatible)
// Use tiktoken-node or a similar library for actual implementation
export const preciseTokenCounter: TokenCounterPlugin = {
  name: 'precise',
  count: (text: string): number => {
    // TODO(#124): Integrate tiktoken library
    // Currently using improved approximation — accurate enough for v0.1.0

    // 1. Word count based on whitespace/newlines
    const words = text.split(/\s+/).filter(w => w.length > 0);

    // 2. Special character count (usually separate tokens)
    const specialChars = (text.match(/[{}()[\]<>:;,."'`~!@#$%^&*+=|\\/?-]/g) || []).length;

    // 3. Korean character handling
    const koreanChars = (text.match(/[\uAC00-\uD7A3]/g) || []).length;

    // 4. Detect code blocks (code requires more tokens)
    const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;

    // Approximate calculation
    let tokens = 0;
    tokens += words.length * 1.3; // ~1.3 tokens per word on average
    tokens += specialChars * 0.5; // Special characters
    tokens += koreanChars * 0.4;  // Extra tokens for Korean characters
    tokens += codeBlocks * 10;    // Code block overhead

    return Math.ceil(tokens);
  },
};

// Currently active counter
let currentCounter: TokenCounterPlugin = preciseTokenCounter;

// Set token counter
export const setTokenCounter = (counter: TokenCounterPlugin): void => {
  currentCounter = counter;
};

// Get token counter
export const getTokenCounter = (): TokenCounterPlugin => {
  return currentCounter;
};

// Count tokens
export const countTokens = (text: string): number => {
  return currentCounter.count(text);
};

// Count tokens in a file
export const countFileTokens = async (filePath: string): Promise<number> => {
  const fs = await import('fs');
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return countTokens(content);
};

// Count tokens in multiple files
export const countMultipleFileTokens = async (
  filePaths: string[]
): Promise<{ [path: string]: number }> => {
  const results: { [path: string]: number } = {};

  for (const filePath of filePaths) {
    results[filePath] = await countFileTokens(filePath);
  }

  return results;
};

// Token analysis by text section
export type SectionTokenAnalysis = {
  section: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: number;
  percentage: number;
};

export const analyzeTextSections = (
  text: string,
): SectionTokenAnalysis[] => {
  const lines = text.split('\n');
  const sections: SectionTokenAnalysis[] = [];
  const totalTokens = countTokens(text);

  type CurrentSection = {
    name: string;
    startLine: number;
    lines: string[];
  };

  let currentSection: CurrentSection | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const isHeader = /^##?\s+.+$/.test(line);

    if (isHeader) {
      // Save the previous section
      if (currentSection !== null) {
        const content = currentSection.lines.join('\n');
        const tokens = countTokens(content);
        sections.push({
          section: currentSection.name,
          startLine: currentSection.startLine,
          endLine: index - 1,
          content,
          tokens,
          percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
        });
      }

      // Start a new section
      currentSection = {
        name: line.replace(/^#+\s*/, ''),
        startLine: index,
        lines: [line],
      };
    } else if (currentSection !== null) {
      currentSection.lines.push(line);
    }
  }

  // Save the last section
  if (currentSection !== null) {
    const content = currentSection.lines.join('\n');
    const tokens = countTokens(content);
    sections.push({
      section: currentSection.name,
      startLine: currentSection.startLine,
      endLine: lines.length - 1,
      content,
      tokens,
      percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
    });
  }

  // Sort by token count
  return sections.sort((a, b) => b.tokens - a.tokens);
};

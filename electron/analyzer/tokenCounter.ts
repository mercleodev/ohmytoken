/**
 * Token Counter Module
 *
 * Module for counting tokens in text.
 * Uses tiktoken (cl100k_base) for accurate BPE token counting.
 * Falls back to heuristic approximation if tiktoken fails to load.
 */
import { encodingForModel } from 'js-tiktoken';
import type { Tiktoken } from 'js-tiktoken';

// Token counter plugin type
export type TokenCounterPlugin = {
  name: string;
  count: (text: string) => number;
  countAsync?: (text: string) => Promise<number>;
};

// Lazy-initialized tiktoken encoder
let _encoder: Tiktoken | null = null;
let _encoderFailed = false;

const getEncoder = (): Tiktoken | null => {
  if (_encoder) return _encoder;
  if (_encoderFailed) return null;
  try {
    _encoder = encodingForModel('gpt-4');
    return _encoder;
  } catch (err) {
    _encoderFailed = true;
    console.warn('[TokenCounter] tiktoken init failed, using heuristic fallback:', err);
    return null;
  }
};

// Heuristic fallback (word-based approximation)
const heuristicCount = (text: string): number => {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const specialChars = (text.match(/[{}()[\]<>:;,."'`~!@#$%^&*+=|\\/?-]/g) || []).length;
  const koreanChars = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  let tokens = 0;
  tokens += words.length * 1.3;
  tokens += specialChars * 0.5;
  tokens += koreanChars * 0.4;
  tokens += codeBlocks * 10;
  return Math.ceil(tokens);
};

// Simple token counter (character-based approximation)
export const simpleTokenCounter: TokenCounterPlugin = {
  name: 'simple',
  count: (text: string): number => {
    const koreanChars = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
    const otherChars = text.length - koreanChars;
    return Math.ceil(koreanChars / 2.5 + otherChars / 4);
  },
};

// Precise token counter (tiktoken cl100k_base with heuristic fallback)
export const preciseTokenCounter: TokenCounterPlugin = {
  name: 'precise',
  count: (text: string): number => {
    const enc = getEncoder();
    if (enc) {
      return enc.encode(text).length;
    }
    return heuristicCount(text);
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

/**
 * Prompt Optimizer Module
 *
 * Manages prompt optimization algorithms via a plugin architecture.
 * Applies research-based optimization techniques:
 * - LLMLingua: Token-level compression
 * - Relevance Filtering: Usage frequency-based filtering
 * - Instruction Referencing: Deduplicating repeated instructions
 * - Cache Optimization: Cache efficiency optimization
 */

import { countTokens, analyzeTextSections, SectionTokenAnalysis } from './tokenCounter';
import { ParsedMessage } from './logParser';

// Optimization suggestion type
export type OptimizationSuggestion = {
  id: string;
  type: 'remove' | 'compress' | 'relocate' | 'merge' | 'reference';
  target: string;
  targetLine?: number;
  description: string;
  originalTokens: number;
  estimatedTokens: number;
  savings: number;
  savingsPercent: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  autoFixable: boolean;
  suggestedReplacement?: string;
};

// Optimization result
export type OptimizationResult = {
  originalTokens: number;
  optimizedTokens: number;
  totalSavings: number;
  savingsPercent: number;
  suggestions: OptimizationSuggestion[];
  optimizedContent?: string;
};

// Optimizer plugin type
export type OptimizerPlugin = {
  name: string;
  description: string;
  analyze: (content: string, context?: OptimizerContext) => OptimizationSuggestion[];
  apply?: (content: string, suggestion: OptimizationSuggestion) => string;
};

// Optimizer context (usage frequency, etc.)
export type OptimizerContext = {
  usageFrequency?: Map<string, number>; // Usage frequency per section
  conversationLogs?: ParsedMessage[];   // Conversation logs
  cacheStats?: {
    hitRate: number;
    missedSections: string[];
  };
};

// ============================================================
// Plugin 1: Duplicate Remover
// ============================================================
export const duplicateRemoverPlugin: OptimizerPlugin = {
  name: 'duplicate-remover',
  description: 'Detect and remove duplicate content',

  analyze: (content: string): OptimizationSuggestion[] => {
    const suggestions: OptimizationSuggestion[] = [];
    const lines = content.split('\n');
    const seen = new Map<string, number>();

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length < 20) return; // Skip short lines

      const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');

      if (seen.has(normalized)) {
        const originalLine = seen.get(normalized)!;
        const tokens = countTokens(line);

        suggestions.push({
          id: `dup-${index}`,
          type: 'remove',
          target: trimmed.slice(0, 50) + '...',
          targetLine: index + 1,
          description: `Duplicate of line ${originalLine + 1}`,
          originalTokens: tokens,
          estimatedTokens: 0,
          savings: tokens,
          savingsPercent: 100,
          priority: 'high',
          autoFixable: true,
        });
      } else {
        seen.set(normalized, index);
      }
    });

    return suggestions;
  },
};

// ============================================================
// Plugin 2: Verbose Compressor
// ============================================================
const VERBOSE_PATTERNS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
  {
    pattern: /\uBC18\uB4DC\uC2DC\s+(.+?)\uD558\uC138\uC694\.?\s+\uC808\uB300\s+(.+?)\uD558\uC9C0\s+\uB9C8\uC138\uC694/g,
    replacement: '$1 required, $2 forbidden',
    description: 'Compress repeated emphasis (Korean)',
  },
  {
    pattern: /\uB2E4\uC74C\uACFC\s+\uAC19\uC740\s+\uD615\uC2DD\uC73C\uB85C/g,
    replacement: 'Format:',
    description: 'Compress format description (Korean)',
  },
  {
    pattern: /\uC608\uB97C\s*\uB4E4\uC5B4[\uC11C\uBA74]?/g,
    replacement: 'e.g.:',
    description: 'Compress example expression (Korean)',
  },
  {
    pattern: /\uC911\uC694\uD55C\s+\uC810\uC740/g,
    replacement: 'Important:',
    description: 'Compress emphasis expression',
  },
  {
    pattern: /\uC544\uB798\uC640\s+\uAC19\uC774/g,
    replacement: '',
    description: 'Remove unnecessary expression',
  },
];

export const verboseCompressorPlugin: OptimizerPlugin = {
  name: 'verbose-compressor',
  description: 'Compress verbose expressions into concise form',

  analyze: (content: string): OptimizationSuggestion[] => {
    const suggestions: OptimizationSuggestion[] = [];

    VERBOSE_PATTERNS.forEach((vp, idx) => {
      const matches = content.match(vp.pattern);
      if (matches) {
        matches.forEach((match, matchIdx) => {
          const originalTokens = countTokens(match);
          const replacement = match.replace(vp.pattern, vp.replacement);
          const newTokens = countTokens(replacement);

          if (originalTokens > newTokens) {
            suggestions.push({
              id: `verbose-${idx}-${matchIdx}`,
              type: 'compress',
              target: match,
              description: vp.description,
              originalTokens,
              estimatedTokens: newTokens,
              savings: originalTokens - newTokens,
              savingsPercent: ((originalTokens - newTokens) / originalTokens) * 100,
              priority: 'medium',
              autoFixable: true,
              suggestedReplacement: replacement,
            });
          }
        });
      }
    });

    return suggestions;
  },

  apply: (content: string, suggestion: OptimizationSuggestion): string => {
    if (suggestion.suggestedReplacement !== undefined) {
      return content.replace(suggestion.target, suggestion.suggestedReplacement);
    }
    return content;
  },
};

// ============================================================
// Plugin 3: Relevance Filter (usage frequency-based filtering)
// ============================================================
export const relevanceFilterPlugin: OptimizerPlugin = {
  name: 'relevance-filter',
  description: 'Detect sections with low usage frequency',

  analyze: (content: string, context?: OptimizerContext): OptimizationSuggestion[] => {
    const suggestions: OptimizationSuggestion[] = [];
    const sections = analyzeTextSections(content);
    const usageFrequency = context?.usageFrequency || new Map();

    sections.forEach((section) => {
      const frequency = usageFrequency.get(section.section) || 0;

      // Sections with many tokens but zero usage frequency
      if (section.tokens > 100 && frequency === 0) {
        suggestions.push({
          id: `relevance-${section.startLine}`,
          type: 'remove',
          target: section.section,
          targetLine: section.startLine + 1,
          description: `Usage frequency 0, consuming ${section.tokens} tokens`,
          originalTokens: section.tokens,
          estimatedTokens: 0,
          savings: section.tokens,
          savingsPercent: 100,
          priority: section.tokens > 500 ? 'critical' : 'high',
          autoFixable: false, // Requires manual review
        });
      }
      // Sections with low usage frequency relative to token count
      else if (section.tokens > 200 && frequency < 3) {
        const efficiency = frequency / section.tokens;
        if (efficiency < 0.01) {
          suggestions.push({
            id: `relevance-low-${section.startLine}`,
            type: 'compress',
            target: section.section,
            targetLine: section.startLine + 1,
            description: `Usage frequency ${frequency} times, low efficiency`,
            originalTokens: section.tokens,
            estimatedTokens: Math.ceil(section.tokens * 0.3), // Target 70% compression
            savings: Math.ceil(section.tokens * 0.7),
            savingsPercent: 70,
            priority: 'medium',
            autoFixable: false,
          });
        }
      }
    });

    return suggestions;
  },
};

// ============================================================
// Plugin 4: Code Example Minimizer
// ============================================================
export const codeExampleMinimizerPlugin: OptimizerPlugin = {
  name: 'code-example-minimizer',
  description: 'Compress long code examples to minimum essentials',

  analyze: (content: string): OptimizationSuggestion[] => {
    const suggestions: OptimizationSuggestion[] = [];
    const codeBlockRegex = /```[\s\S]*?```/g;
    let match;
    let idx = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const codeBlock = match[0];
      const tokens = countTokens(codeBlock);
      const lines = codeBlock.split('\n').length;

      // Code blocks with more than 10 lines or 200 tokens
      if (lines > 10 || tokens > 200) {
        suggestions.push({
          id: `code-${idx}`,
          type: 'compress',
          target: codeBlock.slice(0, 100) + '...',
          description: `${lines} lines, ${tokens} tokens code block - keep essentials only`,
          originalTokens: tokens,
          estimatedTokens: Math.ceil(tokens * 0.4),
          savings: Math.ceil(tokens * 0.6),
          savingsPercent: 60,
          priority: tokens > 500 ? 'high' : 'medium',
          autoFixable: false,
        });
      }
      idx++;
    }

    return suggestions;
  },
};

// ============================================================
// Plugin 5: Cache Optimizer
// ============================================================
export const cacheOptimizerPlugin: OptimizerPlugin = {
  name: 'cache-optimizer',
  description: 'Suggest content relocation for cache efficiency',

  analyze: (content: string): OptimizationSuggestion[] => {
    const suggestions: OptimizationSuggestion[] = [];
    const sections = analyzeTextSections(content);

    // Dynamic content at the top degrades cache efficiency
    const dynamicPatterns = [
      /\uC624\uB298 \uB0A0\uC9DC/,
      /\uD604\uC7AC \uBE0C\uB79C\uCE58/,
      /git status/,
      /\uCD5C\uADFC \uCEE4\uBC0B/,
    ];

    sections.forEach((section, idx) => {
      const isDynamic = dynamicPatterns.some(p => p.test(section.content));

      if (isDynamic && idx < sections.length / 2) {
        suggestions.push({
          id: `cache-relocate-${idx}`,
          type: 'relocate',
          target: section.section,
          targetLine: section.startLine + 1,
          description: 'Moving dynamic content to the bottom improves cache efficiency',
          originalTokens: section.tokens,
          estimatedTokens: section.tokens, // Token count stays the same but cache efficiency improves
          savings: 0,
          savingsPercent: 0,
          priority: 'medium',
          autoFixable: false,
        });
      }
    });

    return suggestions;
  },
};

// ============================================================
// Plugin registry
// ============================================================
const pluginRegistry: Map<string, OptimizerPlugin> = new Map([
  ['duplicate-remover', duplicateRemoverPlugin],
  ['verbose-compressor', verboseCompressorPlugin],
  ['relevance-filter', relevanceFilterPlugin],
  ['code-example-minimizer', codeExampleMinimizerPlugin],
  ['cache-optimizer', cacheOptimizerPlugin],
]);

// Register plugin
export const registerPlugin = (plugin: OptimizerPlugin): void => {
  pluginRegistry.set(plugin.name, plugin);
};

// Unregister plugin
export const unregisterPlugin = (name: string): boolean => {
  return pluginRegistry.delete(name);
};

// Get all plugins
export const getPlugins = (): OptimizerPlugin[] => {
  return Array.from(pluginRegistry.values());
};

// ============================================================
// Main optimization function
// ============================================================
export const analyzeAndOptimize = (
  content: string,
  context?: OptimizerContext,
  enabledPlugins?: string[]
): OptimizationResult => {
  const originalTokens = countTokens(content);
  let allSuggestions: OptimizationSuggestion[] = [];

  // Run only enabled plugins
  const plugins = enabledPlugins
    ? enabledPlugins.map(name => pluginRegistry.get(name)).filter(Boolean) as OptimizerPlugin[]
    : Array.from(pluginRegistry.values());

  for (const plugin of plugins) {
    const suggestions = plugin.analyze(content, context);
    allSuggestions.push(...suggestions);
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  allSuggestions.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.savings - a.savings; // Same priority: sort by savings
  });

  // Calculate total savings
  const totalSavings = allSuggestions.reduce((sum, s) => sum + s.savings, 0);
  const optimizedTokens = Math.max(0, originalTokens - totalSavings);

  return {
    originalTokens,
    optimizedTokens,
    totalSavings,
    savingsPercent: originalTokens > 0 ? (totalSavings / originalTokens) * 100 : 0,
    suggestions: allSuggestions,
  };
};

// Apply auto-fixes
export const applyAutoFixes = (
  content: string,
  suggestions: OptimizationSuggestion[]
): string => {
  let result = content;
  const autoFixable = suggestions.filter(s => s.autoFixable);

  for (const suggestion of autoFixable) {
    const plugin = pluginRegistry.get(suggestion.id.split('-')[0]);
    if (plugin?.apply) {
      result = plugin.apply(result, suggestion);
    } else if (suggestion.suggestedReplacement !== undefined) {
      result = result.replace(suggestion.target, suggestion.suggestedReplacement);
    }
  }

  return result;
};

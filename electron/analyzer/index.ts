/**
 * Token Analyzer Module
 *
 * Analyzes and visualizes token usage in real time, like an MRI/CT scan
 *
 * Module structure:
 * - logParser.ts: JSONL log parsing
 * - tokenCounter.ts: Token counting (tiktoken-based)
 * - optimizer.ts: Prompt optimization algorithms (plugin-based)
 * - realTimeWatcher.ts: Real-time file watcher
 * - visualizer.ts: Visualization data generation
 */

export * from './logParser';
export * from './tokenCounter';
export * from './optimizer';
export * from './realTimeWatcher';

// Token analysis result type
export type TokenBreakdown = {
  claudeMd: {
    global: number;
    project: number;
    total: number;
    percentage: number;
  };
  userInput: {
    tokens: number;
    percentage: number;
  };
  context: {
    conversationHistory: number;
    toolResults: number;
    total: number;
    percentage: number;
  };
  response: {
    thinking: number;
    output: number;
    total: number;
    percentage: number;
  };
  cache: {
    creation: number;
    read: number;
    hitRate: number;
  };
  total: number;
  timestamp: string;
};

// Real-time scan event
export type ScanEvent = {
  type: 'request' | 'response' | 'cache_hit' | 'cache_miss';
  timestamp: string;
  breakdown: TokenBreakdown;
  suggestion?: string;
};

// Optimization suggestion
export type OptimizationSuggestion = {
  id: string;
  type: 'remove' | 'compress' | 'relocate' | 'cache';
  target: string;
  description: string;
  estimatedSavings: number;
  priority: 'high' | 'medium' | 'low';
};

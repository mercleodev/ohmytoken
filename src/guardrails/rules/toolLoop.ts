import type { GuardrailRule, GuardrailContext, GuardrailRecommendation } from '../types';

/**
 * tool-loop: fires when repeated tool calls occur with no progress.
 *
 * Trigger:
 *  - redundantPatterns detected by MCP analysis
 *  - OR a single tool dominates tool_summary with high count and flat output
 */
const DOMINANT_TOOL_MIN_CALLS = 5;
const DOMINANT_TOOL_SHARE = 0.50;

export const toolLoopRule: GuardrailRule = {
  id: 'tool-loop',
  evaluate(ctx: GuardrailContext): GuardrailRecommendation | null {
    const { mcpAnalysis, scan } = ctx;
    const { latestOutputTokens } = ctx.derived;

    const redundantCount = mcpAnalysis?.redundantPatterns?.length ?? 0;
    const toolSummary = scan.tool_summary ?? {};

    // Check for dominant single tool
    const toolEntries = Object.entries(toolSummary);
    const totalToolCalls = toolEntries.reduce((sum, [, count]) => sum + count, 0);
    let dominantTool: { name: string; count: number; share: number } | null = null;

    if (totalToolCalls >= DOMINANT_TOOL_MIN_CALLS) {
      for (const [name, count] of toolEntries) {
        const share = count / totalToolCalls;
        if (count >= DOMINANT_TOOL_MIN_CALLS && share >= DOMINANT_TOOL_SHARE) {
          if (!dominantTool || count > dominantTool.count) {
            dominantTool = { name, count, share };
          }
        }
      }
    }

    const hasDominantWithFlatOutput = dominantTool !== null && latestOutputTokens < 200;
    const shouldFire = redundantCount > 0 || hasDominantWithFlatOutput;

    if (!shouldFire) return null;

    // Dynamic confidence
    let confidence = 0.60;
    if (redundantCount >= 3) confidence = 0.80;
    else if (redundantCount > 0) confidence = 0.70;

    if (hasDominantWithFlatOutput) confidence = Math.min(confidence + 0.10, 1.0);

    const evidence: string[] = [];
    if (redundantCount > 0) {
      const patterns = mcpAnalysis!.redundantPatterns;
      for (const p of patterns.slice(0, 3)) {
        evidence.push(`${p.toolName}: ${p.description} (${p.count}x)`);
      }
    }
    if (dominantTool) {
      evidence.push(`"${dominantTool.name}" called ${dominantTool.count} times (${(dominantTool.share * 100).toFixed(0)}% of all tool calls)`);
    }

    return {
      id: 'tool-loop',
      severity: redundantCount >= 3 ? 'warning' : 'info',
      title: 'Repeated Tool Loop Detected',
      reason: 'The session is repeating the same kind of tool work without clear progress.',
      action: 'Cache the result, batch the operation, or extract the repeated flow into a script.',
      confidence,
      evidence,
    };
  },
};

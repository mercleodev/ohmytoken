/**
 * Build the corpus of LLM-side text to compare against file content.
 *
 * On tool-only turns the assistant produces no text at all — the model's
 * intent is expressed entirely through tool-call inputs (Bash commands,
 * Grep patterns, Read paths, etc). Text-overlap that looks only at
 * `assistant_response` misses every such turn. Including tool input
 * summaries restores the signal for coding sessions. See #355.
 */

type ToolCallSummary = { index: number; name: string; input_summary: string };

export const effectiveAssistantText = (
  assistantResponse: string | undefined,
  toolCalls: readonly ToolCallSummary[] | undefined,
): string => {
  const parts: string[] = [];
  if (assistantResponse && assistantResponse.length > 0) parts.push(assistantResponse);
  if (toolCalls) {
    for (const tc of toolCalls) {
      if (tc.input_summary) parts.push(tc.input_summary);
    }
  }
  return parts.join('\n');
};

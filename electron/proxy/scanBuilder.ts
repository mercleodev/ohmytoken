import { PromptScan } from './types';
import { parseSystemField, estimateSystemTokens } from './systemParser';
import { analyzeMessages } from './messagesAnalyzer';
import { countTokens } from '../analyzer/tokenCounter';

export const buildPromptScan = (
  rawBody: string,
  requestId: string,
  sessionId: string
): PromptScan | null => {
  try {
    const parsed = JSON.parse(rawBody);

    // Parse system field
    const injectedFiles = parseSystemField(parsed.system);
    const totalInjectedTokens = injectedFiles.reduce((sum, f) => sum + f.estimated_tokens, 0);
    const systemTokens = estimateSystemTokens(parsed.system);

    // Analyze messages
    const analysis = analyzeMessages(parsed.messages);

    // Estimate tools definition tokens
    const toolsDefinitionTokens = Array.isArray(parsed.tools)
      ? countTokens(JSON.stringify(parsed.tools))
      : 0;

    const totalContextTokens = systemTokens + analysis.messages_tokens + toolsDefinitionTokens;

    return {
      request_id: requestId,
      session_id: sessionId,
      timestamp: new Date().toISOString(),

      user_prompt: analysis.user_prompt,
      user_prompt_tokens: analysis.user_prompt_tokens,
      assistant_response: analysis.assistant_response || undefined,

      injected_files: injectedFiles,
      total_injected_tokens: totalInjectedTokens,

      tool_calls: analysis.tool_calls,
      tool_summary: analysis.tool_summary,

      agent_calls: analysis.agent_calls,

      context_estimate: {
        system_tokens: systemTokens,
        messages_tokens: analysis.messages_tokens,
        messages_tokens_breakdown: analysis.messages_tokens_breakdown,
        tools_definition_tokens: toolsDefinitionTokens,
        total_tokens: totalContextTokens,
      },

      model: parsed.model || 'unknown',
      max_tokens: parsed.max_tokens || 0,
      conversation_turns: analysis.conversation_turns,
      user_messages_count: analysis.user_messages_count,
      assistant_messages_count: analysis.assistant_messages_count,
      tool_result_count: analysis.tool_result_count,
    };
  } catch {
    return null;
  }
};

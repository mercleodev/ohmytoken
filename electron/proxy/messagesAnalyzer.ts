import { ToolCall, AgentCall } from './types';
import { countTokens } from '../analyzer/tokenCounter';

type MessageBlock = {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  content?: unknown;
  [key: string]: unknown;
};

type Message = {
  role: string;
  content: string | MessageBlock[] | unknown;
};

type MessagesTokensBreakdown = {
  user_text_tokens: number;
  assistant_tokens: number;
  tool_result_tokens: number;
};

type MessagesAnalysis = {
  user_prompt: string;
  user_prompt_tokens: number;
  assistant_response: string;
  tool_calls: ToolCall[];
  tool_summary: Record<string, number>;
  agent_calls: AgentCall[];
  messages_tokens: number;
  messages_tokens_breakdown: MessagesTokensBreakdown;
  conversation_turns: number;
  user_messages_count: number;
  assistant_messages_count: number;
  tool_result_count: number;
};

const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const TASK_NOTIFICATION_PATTERN = /<task-notification>[\s\S]*?<\/task-notification>/g;

const cleanUserPrompt = (content: string): string =>
  content
    .replace(SYSTEM_REMINDER_PATTERN, '')
    .replace(TASK_NOTIFICATION_PATTERN, '')
    .trim();

const summarizeInput = (input: Record<string, unknown> | undefined): string => {
  if (!input) return '';

  // Summarize by priority of key fields
  const summaryFields = ['file_path', 'pattern', 'command', 'query', 'prompt', 'url', 'selector', 'description'];
  for (const field of summaryFields) {
    if (input[field] && typeof input[field] === 'string') {
      return String(input[field]).slice(0, 500);
    }
  }

  // Fall back to full JSON summary
  const json = JSON.stringify(input);
  return json.slice(0, 500);
};

const extractUserPromptFromContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return cleanUserPrompt(content);
  }

  if (Array.isArray(content)) {
    // Extract only text blocks from array (exclude tool_result)
    const textParts = content
      .filter((block) => {
        if (typeof block === 'string') return true;
        if (block && typeof block === 'object') {
          const b = block as MessageBlock;
          return b.type === 'text' && typeof b.text === 'string';
        }
        return false;
      })
      .map((block) => {
        if (typeof block === 'string') return block;
        return String((block as MessageBlock).text || '');
      });

    return cleanUserPrompt(textParts.join('\n'));
  }

  return '';
};

const estimateContentTokens = (content: unknown): number => {
  if (typeof content === 'string') return countTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => {
      if (typeof block === 'string') return sum + countTokens(block);
      if (block && typeof block === 'object') {
        return sum + countTokens(JSON.stringify(block));
      }
      return sum;
    }, 0);
  }
  return 0;
};

const estimateToolResultTokens = (content: unknown): number => {
  if (!content) return 0;
  if (typeof content === 'string') return countTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => {
      if (typeof block === 'string') return sum + countTokens(block);
      if (block && typeof block === 'object' && block.text) return sum + countTokens(String(block.text));
      return sum;
    }, 0);
  }
  return countTokens(JSON.stringify(content));
};

const extractAssistantText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && (b as MessageBlock).type === 'text' && typeof (b as MessageBlock).text === 'string')
      .map((b) => String((b as MessageBlock).text || ''))
      .join('\n')
      .trim();
  }
  return '';
};

export const analyzeMessages = (messages: unknown): MessagesAnalysis => {
  const breakdown: MessagesTokensBreakdown = {
    user_text_tokens: 0,
    assistant_tokens: 0,
    tool_result_tokens: 0,
  };

  const result: MessagesAnalysis = {
    user_prompt: '',
    user_prompt_tokens: 0,
    assistant_response: '',
    tool_calls: [],
    tool_summary: {},
    agent_calls: [],
    messages_tokens: 0,
    messages_tokens_breakdown: breakdown,
    conversation_turns: 0,
    user_messages_count: 0,
    assistant_messages_count: 0,
    tool_result_count: 0,
  };

  if (!Array.isArray(messages)) return result;

  let toolIndex = 0;
  let agentIndex = 0;
  let lastUserPrompt = '';

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Message;

    const msgTokens = estimateContentTokens(m.content);
    result.messages_tokens += msgTokens;

    if (m.role === 'user') {
      result.user_messages_count++;

      if (Array.isArray(m.content)) {
        const blocks = m.content as MessageBlock[];
        let hasToolResult = false;

        for (const block of blocks) {
          if (block.type === 'tool_result') {
            hasToolResult = true;
            breakdown.tool_result_tokens += estimateToolResultTokens(block.content);
          } else if (block.type === 'text') {
            breakdown.user_text_tokens += countTokens(String(block.text || ''));
          }
        }

        if (hasToolResult) {
          result.tool_result_count++;
        } else {
          lastUserPrompt = extractUserPromptFromContent(m.content);
        }
      } else {
        breakdown.user_text_tokens += msgTokens;
        lastUserPrompt = extractUserPromptFromContent(m.content);
      }
    }

    if (m.role === 'assistant') {
      result.assistant_messages_count++;
      result.conversation_turns++;
      breakdown.assistant_tokens += msgTokens;

      // Extract tool_use blocks
      if (Array.isArray(m.content)) {
        for (const block of m.content as MessageBlock[]) {
          if (block.type === 'tool_use' && block.name) {
            const name = block.name;
            const input = block.input as Record<string, unknown> | undefined;

            result.tool_calls.push({
              index: toolIndex++,
              name,
              input_summary: summarizeInput(input),
            });

            result.tool_summary[name] = (result.tool_summary[name] || 0) + 1;

            // Detect Task (agent) calls
            if (name === 'Task' && input) {
              const subagentType = input.subagent_type ? String(input.subagent_type) : 'unknown';
              const description = input.description ? String(input.description).slice(0, 100) : '';

              result.agent_calls.push({
                index: agentIndex++,
                subagent_type: subagentType,
                description,
              });
            }
          }
        }
      }
    }
  }

  // Use the last user message as the original prompt
  result.user_prompt = lastUserPrompt;
  result.user_prompt_tokens = countTokens(lastUserPrompt);

  // Extract last assistant response text (for preview)
  for (let i = (messages as Message[]).length - 1; i >= 0; i--) {
    const m = (messages as Message[])[i];
    if (m?.role === 'assistant' && m.content) {
      const text = extractAssistantText(m.content);
      if (text) {
        result.assistant_response = text.slice(0, 500);
        break;
      }
    }
  }

  return result;
};

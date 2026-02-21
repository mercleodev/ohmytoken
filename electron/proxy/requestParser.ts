import { RequestMeta } from './types';

export const parseRequestMeta = (body: string): RequestMeta => {
  try {
    const parsed = JSON.parse(body);

    return {
      model: parsed.model || 'unknown',
      max_tokens: parsed.max_tokens || 0,
      messages_count: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
      tools_count: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
      has_system: parsed.system !== undefined && parsed.system !== null,
      stream: parsed.stream !== false,
    };
  } catch {
    return {
      model: 'unknown',
      max_tokens: 0,
      messages_count: 0,
      tools_count: 0,
      has_system: false,
      stream: true,
    };
  }
};
